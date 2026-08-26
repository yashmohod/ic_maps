import {
  MYMAPS_ARROW_PATH,
  MYMAPS_ARROW_VIEW_H,
  MYMAPS_ARROW_VIEW_W,
  arrowPixelSize,
} from "@/lib/mymaps-arrow-shape";

/** Wait until MapLibre finishes painting the current view. */
export function waitForMapIdle(map: {
  once: (type: "idle", listener: () => void) => unknown;
  triggerRepaint: () => void;
}): Promise<void> {
  return new Promise((resolve) => {
    map.once("idle", () => resolve());
    map.triggerRepaint();
  });
}

type ProjectableMap = {
  getCanvas: () => HTMLCanvasElement;
  project: (lngLat: [number, number]) => { x: number; y: number };
};

export type MapExportOverlays = {
  nodes: Array<{ lat: number; lng: number; color: string; size?: number }>;
  points: Array<{ lat: number; lng: number }>;
  texts: Array<{
    lat: number;
    lng: number;
    text: string;
    font_size: number;
  }>;
  arrows?: Array<{
    lat: number;
    lng: number;
    bearing: number;
    color: string;
    size?: number;
  }>;
};

function inView(
  x: number,
  y: number,
  w: number,
  h: number,
  pad: number,
): boolean {
  return x >= -pad && y >= -pad && x <= w + pad && y <= h + pad;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawFullArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bearingDeg: number,
  size: number,
  color: string,
) {
  const { width, height } = arrowPixelSize(size);
  const rad = (bearingDeg * Math.PI) / 180;
  // Tip of the path is at (12, 2) in the viewBox — pin that to (x, y).
  const tipX = MYMAPS_ARROW_VIEW_W / 2;
  const tipY = 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rad);
  ctx.scale(width / MYMAPS_ARROW_VIEW_W, height / MYMAPS_ARROW_VIEW_H);
  ctx.translate(-tipX, -tipY);
  const path = new Path2D(MYMAPS_ARROW_PATH);
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ffffff";
  ctx.lineJoin = "round";
  ctx.stroke(path);
  ctx.restore();
}

/**
 * Snapshot MapLibre WebGL layers (basemap, paths, areas) plus HTML overlays
 * (nodes / points / texts / arrows) by projecting lat/lng onto a composite canvas.
 */
export async function captureMapContainerPng(
  container: HTMLElement,
  map: ProjectableMap,
  overlays: MapExportOverlays,
): Promise<string> {
  const mapCanvas = map.getCanvas();
  const rect = container.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const pixelRatio = Math.min(
    2,
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
  );

  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(width * pixelRatio));
  out.height = Math.max(1, Math.round(height * pixelRatio));
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Could not create export canvas");

  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.drawImage(mapCanvas, 0, 0, width, height);

  for (const p of overlays.points) {
    const { x, y } = map.project([p.lng, p.lat]);
    if (!inView(x, y, width, height, 24)) continue;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#1a5276";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }

  for (const n of overlays.nodes) {
    const { x, y } = map.project([n.lng, n.lat]);
    if (!inView(x, y, width, height, 40)) continue;
    const radius = Math.max(4, (n.size ?? 14) / 2);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = n.color || "#35D5A4";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }

  for (const a of overlays.arrows ?? []) {
    const { x, y } = map.project([a.lng, a.lat]);
    if (!inView(x, y, width, height, 48)) continue;
    drawFullArrow(
      ctx,
      x,
      y,
      a.bearing,
      a.size ?? 28,
      a.color || "#35D5A4",
    );
  }

  for (const t of overlays.texts) {
    const { x, y } = map.project([t.lng, t.lat]);
    if (!inView(x, y, width, height, 80)) continue;

    const fontSize = Math.max(10, Math.min(48, t.font_size || 14));
    const lines = t.text.split("\n");
    const lineHeight = fontSize * 1.25;
    ctx.font = `500 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const textW = Math.max(
      0,
      ...lines.map((line) => ctx.measureText(line).width),
    );
    const padX = 6;
    const padY = 4;
    const maxW = 12 * 16;
    const boxW = Math.min(textW + padX * 2, maxW);
    const boxH = lines.length * lineHeight + padY * 2;

    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 1;
    roundRect(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    const top = y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, x, top + i * lineHeight, maxW - padX * 2);
    });
  }

  return out.toDataURL("image/png");
}
