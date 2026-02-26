import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { NextResponse } from "next/server";

const includeDetail = process.env.NODE_ENV !== "production";

export function calcDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const R = 6371000; // Earth radius (m)
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lng2 - lng1);

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export function heuristic(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  return Math.sqrt(Math.pow(lat1 - lat2, 2) + Math.pow(lng1 - lng2, 2));
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function jsonError(message: string, status: number, detail?: unknown) {
  return NextResponse.json(
    {
      error: message,
      ...(includeDetail && detail != null ? { detail: String(detail) } : {}),
    },
    { status },
  );
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

    const type = (obj as Record<string, unknown>).type;
    if (typeof type !== "string") return null;

    if (
      !(obj as Record<string, unknown>).properties ||
      typeof (obj as Record<string, unknown>).properties !== "object"
    ) {
      (obj as Record<string, unknown>).properties = {};
    }

    return {
      polyObj: obj as Record<string, unknown>,
      polyStr: JSON.stringify(obj),
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
