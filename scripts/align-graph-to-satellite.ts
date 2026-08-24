/**
 * Measure destination polygons against Esri World Imagery (read-only).
 *
 * Usage:
 *   npx tsx scripts/align-graph-to-satellite.ts
 *
 * Writes backups/satellite-offset-report.json. Does not UPDATE the database.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { Client } from "pg";
const ESRI_EXPORT =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export";
const METERS_PER_DEG_LAT = 111_320;
const PAD_M = 18;
const SEARCH_M = 12;
const STEP_M = 1.5;
const IMG = 384;

type Ring = Array<[number, number]>;

type DestRow = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  polygon: string;
  is_parking_lot: boolean;
};

function lngMeters(lat: number) {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

function shiftGeoJson(value: unknown, dLng: number, dLat: number): unknown {
  if (Array.isArray(value)) {
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      return [value[0] + dLng, value[1] + dLat, ...value.slice(2)];
    }
    return value.map((v) => shiftGeoJson(v, dLng, dLat));
  }
  if (value && typeof value === "object") {
    const obj = value as { geometry?: unknown; coordinates?: unknown };
    if (obj.geometry) {
      return { ...obj, geometry: shiftGeoJson(obj.geometry, dLng, dLat) };
    }
    if (obj.coordinates) {
      return { ...obj, coordinates: shiftGeoJson(obj.coordinates, dLng, dLat) };
    }
  }
  return value;
}

function ringsFromPolygonText(text: string): Ring[] {
  const parsed = JSON.parse(text) as {
    type?: string;
    geometry?: { type?: string; coordinates?: unknown };
    coordinates?: unknown;
  };
  const geom = parsed.geometry ?? parsed;
  const coords = geom.coordinates as unknown;
  if (!coords) return [];
  if (geom.type === "MultiPolygon") {
    return (coords as Ring[][]).map((poly) => poly[0]!).filter(Boolean);
  }
  return [(coords as Ring[])[0]!].filter(Boolean);
}

function bboxOfRings(rings: Ring[]) {
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLng, minLat, maxLng, maxLat };
}

function decodePng(buf: Buffer): { width: number; height: number; gray: Float32Array } {
  if (buf[0] !== 0x89 || buf.toString("ascii", 1, 4) !== "PNG") {
    throw new Error(`not PNG (got ${buf.subarray(0, 8).toString("hex")})`);
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idats: Buffer[] = [];
  while (offset + 12 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error("png bit depth");
      colorType = data[9];
      if (data[12] !== 0) throw new Error("png interlaced");
    } else if (type === "IDAT") {
      idats.push(Buffer.from(data));
    } else if (type === "IEND") break;
    offset += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bpp) throw new Error(`png color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idats));
  const stride = width * bpp;
  const rows: Buffer[] = [];
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p]!;
    const src = raw.subarray(p + 1, p + 1 + stride);
    const out = Buffer.alloc(stride);
    const prev = rows[y - 1];
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp]! : 0;
      const b = prev ? prev[i]! : 0;
      const c = prev && i >= bpp ? prev[i - bpp]! : 0;
      const x = src[i]!;
      let v = 0;
      if (filter === 0) v = x;
      else if (filter === 1) v = (x + a) & 255;
      else if (filter === 2) v = (x + b) & 255;
      else if (filter === 3) v = (x + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pr = a + b - c;
        const pa = Math.abs(pr - a);
        const pb = Math.abs(pr - b);
        const pc = Math.abs(pr - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (x + pred) & 255;
      } else throw new Error(`png filter ${filter}`);
      out[i] = v;
    }
    rows.push(out);
    p += 1 + stride;
  }
  const gray = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = rows[y]!;
    for (let x = 0; x < width; x++) {
      const i = x * bpp;
      gray[y * width + x] = 0.299 * row[i]! + 0.587 * row[i + 1]! + 0.114 * row[i + 2]!;
    }
  }
  return { width, height, gray };
}

function sobelMag(gray: Float32Array, w: number, h: number) {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1]! -
        2 * gray[i - 1]! -
        gray[i + w - 1]! +
        gray[i - w + 1]! +
        2 * gray[i + 1]! +
        gray[i + w + 1]!;
      const gy =
        -gray[i - w - 1]! -
        2 * gray[i - w]! -
        gray[i - w + 1]! +
        gray[i + w - 1]! +
        2 * gray[i + w]! +
        gray[i + w + 1]!;
      mag[i] = Math.abs(gx) + Math.abs(gy);
    }
  }
  return mag;
}

function outlinePixels(rings: Ring[], toPx: (lng: number, lat: number) => [number, number]) {
  const pts: Array<[number, number]> = [];
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const [x0, y0] = toPx(ring[i - 1]![0], ring[i - 1]![1]);
      const [x1, y1] = toPx(ring[i]![0], ring[i]![1]);
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let s = 0; s <= n; s++) {
        pts.push([Math.round(x0 + ((x1 - x0) * s) / n), Math.round(y0 + ((y1 - y0) * s) / n)]);
      }
    }
  }
  return pts;
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

async function fetchExport(bbox: {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}) {
  const params = new URLSearchParams({
    bbox: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
    bboxSR: "4326",
    imageSR: "4326",
    size: `${IMG},${IMG}`,
    format: "png32",
    transparent: "false",
    f: "image",
  });
  const res = await fetch(`${ESRI_EXPORT}?${params}`);
  if (!res.ok) throw new Error(`esri ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function selfCheck() {
  const shifted = shiftGeoJson(
    { type: "Point", coordinates: [-76.5, 42.42] },
    0.001,
    -0.002,
  ) as { coordinates: number[] };
  if (shifted.coordinates[0] !== -76.499 || shifted.coordinates[1] !== 42.418) {
    throw new Error("shiftGeoJson self-check failed");
  }
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc000000301010018dd8d180000000049454e44ae426082",
    "hex",
  );
  const { width, height, gray } = decodePng(png);
  if (width !== 1 || height !== 1 || gray[0] === undefined) {
    throw new Error("png self-check failed");
  }
}

async function main() {
  selfCheck();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const client = new Client({ connectionString: url });
  await client.connect();

  const destRes = await client.query<DestRow>(
    `SELECT id, name, lat, lng, polygon, is_parking_lot
     FROM destination
     WHERE polygon IS NOT NULL AND polygon <> '' AND NOT is_parking_lot`,
  );

  const samples: Array<{
    id: number;
    name: string;
    eastM: number;
    northM: number;
    score: number;
  }> = [];

  for (const dest of destRes.rows) {
    let rings: Ring[] = [];
    try {
      rings = ringsFromPolygonText(dest.polygon);
    } catch {
      continue;
    }
    if (!rings.length) continue;
    const raw = bboxOfRings(rings);
    const midLat = (raw.minLat + raw.maxLat) / 2;
    const mLng = lngMeters(midLat);
    const areaM2 =
      (raw.maxLng - raw.minLng) * mLng * (raw.maxLat - raw.minLat) * METERS_PER_DEG_LAT;
    if (areaM2 < 250) continue;

    const bbox = {
      minLng: raw.minLng - PAD_M / mLng,
      minLat: raw.minLat - PAD_M / METERS_PER_DEG_LAT,
      maxLng: raw.maxLng + PAD_M / mLng,
      maxLat: raw.maxLat + PAD_M / METERS_PER_DEG_LAT,
    };

    let png: Buffer;
    try {
      png = await fetchExport(bbox);
    } catch (err) {
      console.warn(`skip ${dest.name}: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    let decoded: { width: number; height: number; gray: Float32Array };
    try {
      decoded = decodePng(png);
    } catch (err) {
      console.warn(`skip ${dest.name}: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    const mag = sobelMag(decoded.gray, decoded.width, decoded.height);
    const toPx = (lng: number, lat: number): [number, number] => [
      ((lng - bbox.minLng) / (bbox.maxLng - bbox.minLng)) * (decoded.width - 1),
      (1 - (lat - bbox.minLat) / (bbox.maxLat - bbox.minLat)) * (decoded.height - 1),
    ];
    const outline = outlinePixels(rings, toPx);
    if (outline.length < 40) continue;

    const pxPerEast = ((decoded.width - 1) / (bbox.maxLng - bbox.minLng)) / mLng;
    const pxPerNorth =
      ((decoded.height - 1) / (bbox.maxLat - bbox.minLat)) / METERS_PER_DEG_LAT;

    let best = { eastM: 0, northM: 0, score: -1 };
    for (let eastM = -SEARCH_M; eastM <= SEARCH_M; eastM += STEP_M) {
      for (let northM = -SEARCH_M; northM <= SEARCH_M; northM += STEP_M) {
        const dx = eastM * pxPerEast;
        const dy = -northM * pxPerNorth;
        let score = 0;
        let n = 0;
        for (const [x, y] of outline) {
          const xi = Math.round(x + dx);
          const yi = Math.round(y + dy);
          if (xi < 1 || yi < 1 || xi >= decoded.width - 1 || yi >= decoded.height - 1)
            continue;
          score += mag[yi * decoded.width + xi]!;
          n++;
        }
        if (n < 30) continue;
        const mean = score / n;
        if (mean > best.score) best = { eastM, northM, score: mean };
      }
    }
    samples.push({
      id: dest.id,
      name: dest.name,
      eastM: best.eastM,
      northM: best.northM,
      score: best.score,
    });
    console.log(
      `${dest.name}: east ${best.eastM.toFixed(1)} m, north ${best.northM.toFixed(1)} m`,
    );
  }

  if (!samples.length) {
    console.log("No buildings could be registered against satellite.");
    await client.end();
    return;
  }

  const eastMed = median(samples.map((s) => s.eastM));
  const northMed = median(samples.map((s) => s.northM));
  const magMed = Math.hypot(eastMed, northMed);
  const agree = samples.filter(
    (s) => Math.hypot(s.eastM - eastMed, s.northM - northMed) <= 2.5,
  ).length;
  const agreePct = agree / samples.length;

  console.log(
    `\nmedian shift: east ${eastMed.toFixed(2)} m, north ${northMed.toFixed(2)} m (${magMed.toFixed(2)} m)`,
  );
  console.log(
    `buildings ${samples.length}; within 2.5 m of median: ${(agreePct * 100).toFixed(0)}%`,
  );

  const systematic = magMed >= 1.25 && agreePct >= 0.55;
  const midLat = 42.422;
  const dLng = eastMed / lngMeters(midLat);
  const dLat = northMed / METERS_PER_DEG_LAT;
  const report = {
    createdAt: new Date().toISOString(),
    buildings: samples.length,
    eastMed,
    northMed,
    magMed,
    agreePct,
    systematic,
    dLng,
    dLat,
    samples,
  };
  writeFileSync("backups/satellite-offset-report.json", JSON.stringify(report, null, 2));
  console.log("wrote backups/satellite-offset-report.json");
  if (!systematic) {
    console.log(
      "No systematic campus-wide offset — leaving node/edge coordinates unchanged.",
    );
  } else {
    console.log(`degrees: dLng ${dLng.toExponential(4)}, dLat ${dLat.toExponential(4)}`);
    console.log("Systematic offset found. Apply in a separate step.");
  }
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
