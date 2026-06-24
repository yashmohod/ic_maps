"use client";

import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import {
  DEFAULT_REPORT_DATE_FILTER,
  type ReportDateFilterValue,
  type ReportDatePreset,
} from "@/lib/report-date-filter";
import { cn } from "@/lib/utils";

const PRESET_ITEMS: Array<{ id: ReportDatePreset; label: string }> = [
  { id: "all", label: "All time" },
  { id: "24h", label: "Last 24 hours" },
  { id: "7d", label: "Last 7 days" },
  { id: "custom", label: "Custom range" },
];

type ReportDateFilterProps = {
  value?: ReportDateFilterValue;
  onChange: (value: ReportDateFilterValue) => void;
  className?: string;
};

export function ReportDateFilter({
  value = DEFAULT_REPORT_DATE_FILTER,
  onChange,
  className,
}: ReportDateFilterProps) {
  const setPreset = (preset: ReportDatePreset) => {
    if (preset === "custom") {
      onChange({
        preset,
        from: value.from,
        to: value.to,
      });
      return;
    }

    onChange({
      preset,
      from: null,
      to: null,
    });
  };

  return (
    <div
      className={cn(
        "border-border bg-panel space-y-3 rounded-xl border p-4",
        className,
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Time period</p>
          <p className="text-muted-foreground text-xs">
            Filter reports by when they were submitted.
          </p>
        </div>
        <div
          role="group"
          aria-label="Time period presets"
          className="flex flex-wrap gap-2"
        >
          {PRESET_ITEMS.map((item) => {
            const isActive = value.preset === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setPreset(item.id)}
                className={cn(
                  "min-h-9 rounded-lg border px-3 py-1.5 text-xs font-semibold transition sm:text-sm",
                  isActive
                    ? "border-brand-cta bg-brand-cta text-brand-cta-foreground"
                    : "border-border bg-background hover:bg-panel-muted/40",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {value.preset === "custom" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="report-filter-from">From</Label>
            <DatePicker
              id="report-filter-from"
              value={value.from}
              onChange={(from) => onChange({ ...value, from })}
              placeholder="Start date"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-filter-to">To</Label>
            <DatePicker
              id="report-filter-to"
              value={value.to}
              onChange={(to) => onChange({ ...value, to })}
              placeholder="End date (optional)"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
