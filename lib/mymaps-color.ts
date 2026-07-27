import { z } from "zod";

/** Default draw color (IC Teal). */
export const MYMAPS_DEFAULT_COLOR = "#35D5A4";

/** Preset swatches for the draw-mode palette. */
export const MYMAPS_COLOR_PALETTE = [
  "#35D5A4", // IC Teal
  "#003c71", // IC Navy
  "#1a5276", // lighter navy
  "#dc2626", // red
  "#ea580c", // orange
  "#ca8a04", // gold
  "#7c3aed", // violet
  "#0f766e", // teal dark
] as const;

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v);
}

/** Normalize to #RRGGBB or fall back to default. */
export function normalizeHexColor(
  v: unknown,
  fallback = MYMAPS_DEFAULT_COLOR,
): string {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  if (HEX_RE.test(s)) return s;
  if (/^[0-9A-Fa-f]{6}$/.test(s)) return `#${s}`;
  return fallback;
}

export const hexColorSchema = z
  .string()
  .regex(HEX_RE, "Expected #RRGGBB")
  .optional()
  .default(MYMAPS_DEFAULT_COLOR);
