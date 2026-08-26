/** Full arrow (shaft + head), tip up. Shared by map markers and PNG export. */
export const MYMAPS_ARROW_PATH = "M12 2 L22 18 H16 V46 H8 V18 H2 Z";
export const MYMAPS_ARROW_VIEW_W = 24;
export const MYMAPS_ARROW_VIEW_H = 48;

export function arrowPixelSize(size: number): { width: number; height: number } {
  const height = Math.max(16, Math.round(size));
  const width = Math.max(10, Math.round((height * MYMAPS_ARROW_VIEW_W) / MYMAPS_ARROW_VIEW_H));
  return { width, height };
}
