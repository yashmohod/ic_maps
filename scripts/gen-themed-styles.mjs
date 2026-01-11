import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const inPath = path.join(
  ROOT,
  "public/styles/osm-bright/style-local.base.json",
);
const outLight = path.join(
  ROOT,
  "public/styles/osm-bright/style-local-light.json",
);
const outDark = path.join(
  ROOT,
  "public/styles/osm-bright/style-local-dark.json",
);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}
function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function setPaint(layer, key, value) {
  layer.paint = layer.paint ?? {};
  layer.paint[key] = value;
}
function setLayout(layer, key, value) {
  layer.layout = layer.layout ?? {};
  layer.layout[key] = value;
}

// Small helpers so we can theme without hand-editing every layer.
function idHas(layer, s) {
  return typeof layer?.id === "string" && layer.id.includes(s);
}
function idStarts(layer, s) {
  return typeof layer?.id === "string" && layer.id.startsWith(s);
}

function applyTheme(style, theme) {
  style.name = theme.styleName;

  for (const layer of style.layers ?? []) {
    const id = layer.id;

    // --- Background ---
    if (layer.type === "background" && id === "background") {
      setPaint(layer, "background-color", theme.bg);
      continue;
    }

    // --- Land / Landuse / Landcover ---
    if (id === "landuse-residential") {
      // Keep the stops shape, just recolor
      setPaint(layer, "fill-color", {
        base: 1,
        stops: [
          [12, theme.residential12],
          [16, theme.residential16],
        ],
      });
      continue;
    }
    if (id === "landuse-commercial") {
      setPaint(layer, "fill-color", theme.commercial);
      continue;
    }
    if (id === "landuse-industrial") {
      setPaint(layer, "fill-color", theme.industrial);
      continue;
    }
    if (id === "landuse-cemetery") {
      setPaint(layer, "fill-color", theme.cemetery);
      continue;
    }
    if (id === "landuse-hospital") {
      setPaint(layer, "fill-color", theme.hospital);
      continue;
    }
    if (id === "landuse-school") {
      setPaint(layer, "fill-color", theme.school);
      continue;
    }
    if (id === "landuse-railway") {
      setPaint(layer, "fill-color", theme.railLanduse);
      continue;
    }
    if (id === "landcover-grass" || id === "landcover-grass-park") {
      setPaint(layer, "fill-color", theme.park);
      continue;
    }
    if (id === "landcover-wood") {
      setPaint(layer, "fill-color", theme.wood);
      setPaint(layer, "fill-opacity", theme.woodOpacity);
      setPaint(layer, "fill-outline-color", theme.woodOutline);
      continue;
    }
    if (id === "landcover-sand") {
      setPaint(layer, "fill-color", theme.sand);
      continue;
    }

    // --- Water ---
    if (id === "water" || id === "water-intermittent") {
      setPaint(layer, "fill-color", theme.water);
      if (id === "water-intermittent")
        setPaint(layer, "fill-opacity", theme.waterIntermittentOpacity);
      continue;
    }
    if (id === "water-offset") {
      setPaint(layer, "fill-color", theme.water);
      continue;
    }
    if (idStarts(layer, "waterway")) {
      // waterway lines: tunnel/river/stream/canal/other
      if (layer.type === "line") {
        setPaint(layer, "line-color", theme.waterway);
      }
      continue;
    }

    // --- Buildings ---
    if (id === "building") {
      setPaint(layer, "fill-color", {
        base: 1,
        stops: [
          [15.5, theme.building15_5],
          [16, theme.building16],
        ],
      });
      continue;
    }
    if (id === "building-top") {
      setPaint(layer, "fill-color", theme.buildingTop);
      setPaint(layer, "fill-outline-color", theme.buildingOutline);
      continue;
    }

    // --- Roads (tunnel/highway/bridge) ---
    // Heuristic: casings vs main strokes
    const isCasing = idHas(layer, "casing");
    const isMotorway = idHas(layer, "motorway");
    const isTrunkPrimary = idHas(layer, "trunk") || idHas(layer, "primary");
    const isSecondaryTertiary =
      idHas(layer, "secondary") || idHas(layer, "tertiary");
    const isMinor =
      idHas(layer, "minor") || idHas(layer, "service") || idHas(layer, "track");
    const isPath = idHas(layer, "path") || idHas(layer, "steps");

    if (
      (idStarts(layer, "tunnel-") ||
        idStarts(layer, "highway-") ||
        idStarts(layer, "bridge-")) &&
      layer.type === "line"
    ) {
      if (isCasing) {
        setPaint(layer, "line-color", theme.roadCasing);
      } else if (isMotorway) {
        setPaint(layer, "line-color", theme.roadMotorway);
      } else if (isTrunkPrimary) {
        setPaint(layer, "line-color", theme.roadPrimary);
      } else if (isSecondaryTertiary) {
        setPaint(layer, "line-color", theme.roadSecondary);
      } else if (isMinor) {
        setPaint(layer, "line-color", theme.roadMinor);
      } else if (isPath) {
        setPaint(layer, "line-color", theme.roadPath);
      }
      continue;
    }

    // --- Road areas / piers ---
    if (id === "road_area_pier" && layer.type === "fill") {
      setPaint(layer, "fill-color", theme.pierFill);
      continue;
    }
    if (id === "road_pier" && layer.type === "line") {
      setPaint(layer, "line-color", theme.pierFill);
      continue;
    }
    if (id === "highway-area" && layer.type === "fill") {
      setPaint(layer, "fill-color", theme.roadArea);
      setPaint(layer, "fill-outline-color", theme.roadAreaOutline);
      continue;
    }

    // --- Boundaries ---
    if (idStarts(layer, "boundary-") && layer.type === "line") {
      setPaint(layer, "line-color", theme.boundary);
      continue;
    }

    // --- Labels (water / POI / places / roads) ---
    if (
      (idStarts(layer, "waterway-name") || idStarts(layer, "water-name")) &&
      layer.type === "symbol"
    ) {
      setPaint(layer, "text-color", theme.labelWater);
      setPaint(layer, "text-halo-color", theme.labelHalo);
      continue;
    }
    if (
      (idStarts(layer, "poi-") || idStarts(layer, "airport-label")) &&
      layer.type === "symbol"
    ) {
      setPaint(layer, "text-color", theme.labelPoi);
      setPaint(layer, "text-halo-color", theme.labelHalo);
      continue;
    }
    if (idStarts(layer, "place-") && layer.type === "symbol") {
      setPaint(layer, "text-color", theme.labelPlace);
      setPaint(layer, "text-halo-color", theme.labelHalo);
      continue;
    }
    if (idStarts(layer, "highway-name") && layer.type === "symbol") {
      setPaint(layer, "text-color", theme.labelRoad);
      setPaint(layer, "text-halo-color", theme.labelHalo);
      continue;
    }
  }

  return style;
}

// “Website-ish” space palette: purple/cyan/amber.
// Adjust these 20-ish values to match your exact site colors.
const LIGHT = {
  styleName: "Campus Light (Nebula)",
  bg: "#F7F4FF",

  residential12: "hsla(255, 55%, 92%, 0.35)",
  residential16: "hsla(255, 55%, 92%, 0.18)",
  commercial: "hsla(330, 70%, 90%, 0.18)",
  industrial: "hsla(45, 90%, 88%, 0.20)",
  cemetery: "#E2F0EA",
  hospital: "hsla(340, 70%, 92%, 0.55)",
  school: "hsla(265, 70%, 92%, 0.55)",
  railLanduse: "hsla(255, 55%, 92%, 0.25)",

  park: "#CDEFE0",
  wood: "#45C4A6",
  woodOpacity: 0.1,
  woodOutline: "rgba(0,0,0,0.03)",
  sand: "#F6EBC3",

  water: "#9AD7FF",
  waterway: "#7CC7FF",
  waterIntermittentOpacity: 0.65,

  building15_5: "#ECE6FF",
  building16: "#D8D0FF",
  buildingTop: "#ECE6FF",
  buildingOutline: "#C7BEFF",

  roadCasing: "#BFC0D9",
  roadMotorway: "#F6B86B",
  roadPrimary: "#C4B5FD",
  roadSecondary: "#E9D5FF",
  roadMinor: "#FFFFFF",
  roadPath: "#D6D3D1",

  roadArea: "rgba(200, 200, 230, 0.35)",
  roadAreaOutline: "rgba(170, 170, 210, 0.60)",
  pierFill: "#F7F4FF",

  boundary: "#9AA3C7",

  labelHalo: "rgba(247,244,255,0.85)",
  labelWater: "#2E7CC6",
  labelPoi: "#3B3355",
  labelPlace: "#1F1B2E",
  labelRoad: "#433A5C",
};

const DARK = {
  styleName: "Campus Dark (Nebula)",
  bg: "#070814",

  residential12: "hsla(255, 35%, 22%, 0.45)",
  residential16: "hsla(255, 35%, 22%, 0.25)",
  commercial: "hsla(330, 55%, 25%, 0.28)",
  industrial: "hsla(45, 70%, 25%, 0.22)",
  cemetery: "hsla(160, 35%, 18%, 0.55)",
  hospital: "hsla(340, 45%, 22%, 0.55)",
  school: "hsla(265, 45%, 22%, 0.55)",
  railLanduse: "hsla(255, 35%, 22%, 0.30)",

  park: "#0F2A24",
  wood: "#2DD4BF",
  woodOpacity: 0.09,
  woodOutline: "rgba(255,255,255,0.03)",
  sand: "#3A2E1B",

  water: "#0B2F4F",
  waterway: "#22D3EE",
  waterIntermittentOpacity: 0.55,

  building15_5: "#1A2140",
  building16: "#121A33",
  buildingTop: "#1A2140",
  buildingOutline: "#2C3A6B",

  roadCasing: "#334155",
  roadMotorway: "#F59E0B",
  roadPrimary: "#C084FC",
  roadSecondary: "#A78BFA",
  roadMinor: "#1F2937",
  roadPath: "#475569",

  roadArea: "rgba(30, 41, 59, 0.55)",
  roadAreaOutline: "rgba(51, 65, 85, 0.75)",
  pierFill: "#070814",

  boundary: "#64748B",

  labelHalo: "rgba(7,8,20,0.80)",
  labelWater: "#7DD3FC",
  labelPoi: "#E5E7EB",
  labelPlace: "#EDE9FE",
  labelRoad: "#EDE9FE",
};

function main() {
  const base = readJson(inPath);

  const light = applyTheme(clone(base), LIGHT);
  const dark = applyTheme(clone(base), DARK);

  writeJson(outLight, light);
  writeJson(outDark, dark);

  console.log("Wrote:");
  console.log(" -", path.relative(ROOT, outLight));
  console.log(" -", path.relative(ROOT, outDark));
}

main();
