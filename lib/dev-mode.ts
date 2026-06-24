/** Single DEV_Mode env flag — server reads process.env.DEV_Mode directly. */

const TRUTHY = new Set(["true", "1", "yes"]);

export function parseDevModeFlag(value: string | undefined): boolean {
  if (!value) return false;
  return TRUTHY.has(value.trim().toLowerCase());
}

/** When true, auth guards are skipped (development only). Server/API use this. */
export function isDevModeEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return parseDevModeFlag(process.env.DEV_Mode);
}
