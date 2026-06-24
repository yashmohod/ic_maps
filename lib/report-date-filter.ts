import { endOfDay, startOfDay } from "date-fns";

export type ReportDatePreset = "all" | "24h" | "7d" | "custom";

export type ReportDateFilterValue = {
  preset: ReportDatePreset;
  from: Date | null;
  to: Date | null;
};

export const DEFAULT_REPORT_DATE_FILTER: ReportDateFilterValue = {
  preset: "24h",
  from: null,
  to: null,
};

export type ReportDateRange = {
  from: Date;
  to: Date;
};

export function resolveReportDateRange(
  filter: ReportDateFilterValue,
): ReportDateRange | null {
  if (filter.preset === "all") return null;

  if (filter.preset === "24h") {
    const to = new Date();
    return { from: new Date(to.getTime() - 24 * 60 * 60 * 1000), to };
  }

  if (filter.preset === "7d") {
    const to = new Date();
    return { from: new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000), to };
  }

  if (filter.preset === "custom" && filter.from) {
    const from = startOfDay(filter.from);
    const to = endOfDay(filter.to ?? filter.from);
    return { from, to };
  }

  return null;
}

export function buildReportDateQueryString(
  filter: ReportDateFilterValue,
): string {
  const range = resolveReportDateRange(filter);
  if (!range) return "";

  const params = new URLSearchParams();
  params.set("from", range.from.toISOString());
  params.set("to", range.to.toISOString());
  return `?${params.toString()}`;
}

export function isCustomRangeComplete(filter: ReportDateFilterValue): boolean {
  if (filter.preset !== "custom") return true;
  return filter.from != null;
}
