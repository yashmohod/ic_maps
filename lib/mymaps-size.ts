/** Node marker diameter in CSS pixels (matches on-map circle size). */
export const MYMAPS_NODE_SIZE_DEFAULT = 14;
export const MYMAPS_NODE_SIZE_MIN = 8;
export const MYMAPS_NODE_SIZE_MAX = 40;

export const MYMAPS_ARROW_SIZE_DEFAULT = 28;
export const MYMAPS_ARROW_SIZE_MIN = 16;
export const MYMAPS_ARROW_SIZE_MAX = 64;

export function clampNodeSize(n: number): number {
  if (!Number.isFinite(n)) return MYMAPS_NODE_SIZE_DEFAULT;
  return Math.min(
    MYMAPS_NODE_SIZE_MAX,
    Math.max(MYMAPS_NODE_SIZE_MIN, Math.round(n)),
  );
}

export function clampArrowSize(n: number): number {
  if (!Number.isFinite(n)) return MYMAPS_ARROW_SIZE_DEFAULT;
  return Math.min(
    MYMAPS_ARROW_SIZE_MAX,
    Math.max(MYMAPS_ARROW_SIZE_MIN, Math.round(n)),
  );
}

export function normArrowBearing(b: number): number {
  if (!Number.isFinite(b)) return 0;
  return ((b % 360) + 360) % 360;
}
