import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isValidLatLng(lat: unknown, lng: unknown) {
  return (
    isFiniteNumber(lat) &&
    isFiniteNumber(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function parseId(id: unknown): number | null {
  const n = typeof id === "number" ? id : Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function isNonEmptyString(v: unknown, maxLen = 256): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= maxLen;
}

export function parsePolygon(
  polygon: unknown,
): { polyObj: Record<string, unknown>; polyStr: string } | null {
  try {
    const obj =
      typeof polygon === "string"
        ? JSON.parse(polygon)
        : typeof polygon === "object" && polygon != null
          ? polygon
          : null;

    if (!obj || typeof obj !== "object") return null;

    const record = obj as Record<string, unknown>;
    const type = record.type;
    if (typeof type !== "string") return null;

    const geomType =
      type === "Feature"
        ? (record.geometry as { type?: string } | undefined)?.type
        : type === "FeatureCollection"
          ? (
              (
                record.features as
                  | Array<{ geometry?: { type?: string } }>
                  | undefined
              )?.[0]?.geometry as { type?: string } | undefined
            )?.type
          : type;

    if (geomType !== "Polygon") return null;

    if (!record.properties || typeof record.properties !== "object") {
      record.properties = {};
    }

    return {
      polyObj: record,
      polyStr: JSON.stringify(record),
    };
  } catch {
    return null;
  }
}

export function parseBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number" && (v === 0 || v === 1)) return Boolean(v);
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return null;
}

export function parsePositiveInt(
  raw: FormDataEntryValue | null,
): number | null {
  if (raw == null || typeof raw !== "string") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}
