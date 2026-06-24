import type { SQL } from "drizzle-orm";
import { and, gte, lte } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export type ParsedReportDateQuery =
  | { ok: true; from?: Date; to?: Date }
  | { ok: false; error: string };

export function parseReportDateQuery(
  searchParams: URLSearchParams,
): ParsedReportDateQuery {
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");

  if (!fromRaw && !toRaw) {
    return { ok: true };
  }

  let from: Date | undefined;
  let to: Date | undefined;

  if (fromRaw) {
    from = new Date(fromRaw);
    if (Number.isNaN(from.getTime())) {
      return { ok: false, error: "Invalid from date" };
    }
  }

  if (toRaw) {
    to = new Date(toRaw);
    if (Number.isNaN(to.getTime())) {
      return { ok: false, error: "Invalid to date" };
    }
  }

  if (from && to && from.getTime() > to.getTime()) {
    return { ok: false, error: "from must be before to" };
  }

  return { ok: true, from, to };
}

export function reportCreatedAtConditions(
  createdAtColumn: PgColumn,
  from?: Date,
  to?: Date,
): SQL | undefined {
  const parts: SQL[] = [];
  if (from) parts.push(gte(createdAtColumn, from));
  if (to) parts.push(lte(createdAtColumn, to));
  return parts.length > 0 ? and(...parts) : undefined;
}
