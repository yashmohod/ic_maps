"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUpDown, LocateFixed, MapPin, Plus, X } from "lucide-react";
import {
  mapBarActionClass,
  mapChromeClass,
  touchTargetClass,
} from "@/lib/panel-classes";
import type { CampusEntrance, TripEnd } from "@/lib/trip-end";
import { sameTripEnd } from "@/lib/trip-end";

type PlaceChoice = { id: number; name: string };

type TripEndsFieldsProps = {
  from: TripEnd | null;
  to: TripEnd | null;
  places: PlaceChoice[];
  entrances: CampusEntrance[];
  onFromChange: (end: TripEnd | null) => void;
  onToChange: (end: TripEnd | null) => void;
  onSwap: () => void;
  allowGps?: boolean;
  gpsStatus?: "unknown" | "ready" | "unavailable";
  onRetryGps?: () => void;
  showAddStop?: boolean;
  stopCount?: number;
  onAddStop?: () => void;
  disabled?: boolean;
  /** Sits in the same bar as the fields, on the left. */
  leading?: ReactNode;
  onSearchOpenChange?: (open: boolean) => void;
};

function endLabel(
  end: TripEnd | null,
  places: PlaceChoice[],
  entrances: CampusEntrance[],
  gpsStatus: "unknown" | "ready" | "unavailable",
  empty: string,
): string {
  if (!end) return empty;
  if (end.kind === "gps") {
    return gpsStatus === "unavailable" ? "Location unavailable" : "Current location";
  }
  if (end.kind === "place") {
    return places.find((p) => p.id === end.id)?.name ?? "Place";
  }
  return entrances.find((e) => e.id === end.id)?.name ?? "Campus entrance";
}

export function TripEndsFields({
  from,
  to,
  places,
  entrances,
  onFromChange,
  onToChange,
  onSwap,
  allowGps = true,
  gpsStatus = "unknown",
  onRetryGps,
  showAddStop = false,
  stopCount = 0,
  onAddStop,
  disabled = false,
  leading,
  onSearchOpenChange,
}: TripEndsFieldsProps) {
  const [openField, setOpenField] = useState<"from" | "to" | null>(null);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openField) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenField(null);
        onSearchOpenChange?.(false);
      }
    }
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [onSearchOpenChange, openField]);

  const other = openField === "from" ? to : openField === "to" ? from : null;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items: Array<{ key: string; label: string; end: TripEnd }> = [];
    if (allowGps && !(other?.kind === "gps")) {
      const label =
        gpsStatus === "unavailable" ? "Current location (unavailable)" : "Current location";
      if (!q || label.toLowerCase().includes(q)) {
        items.push({ key: "gps", label, end: { kind: "gps" } });
      }
    }
    for (const entrance of entrances) {
      const end: TripEnd = {
        kind: "entrance",
        id: entrance.id,
        nodeId: entrance.nodeId,
      };
      if (other && sameTripEnd(other, end)) continue;
      if (q && !entrance.name.toLowerCase().includes(q)) continue;
      items.push({ key: `entrance-${entrance.id}`, label: entrance.name, end });
    }
    for (const place of places) {
      const end: TripEnd = { kind: "place", id: place.id };
      if (other && sameTripEnd(other, end)) continue;
      if (q && !place.name.toLowerCase().includes(q)) continue;
      items.push({ key: `place-${place.id}`, label: place.name, end });
    }
    return items;
  }, [allowGps, entrances, gpsStatus, other, places, query]);

  function open(field: "from" | "to") {
    if (disabled) return;
    setQuery("");
    setOpenField(field);
    onSearchOpenChange?.(true);
  }

  function choose(end: TripEnd) {
    if (openField === "from") onFromChange(end);
    if (openField === "to") onToChange(end);
    setOpenField(null);
    onSearchOpenChange?.(false);
  }

  function renderField(field: "from" | "to") {
    const end = field === "from" ? from : to;
    const label = endLabel(
      end,
      places,
      entrances,
      gpsStatus,
      field === "from" ? "Choose start" : "Choose destination",
    );
    const unavailable = end?.kind === "gps" && gpsStatus === "unavailable";
    return (
      <div className="flex min-h-11 items-center gap-1 px-2">
        <span className="w-8 shrink-0 text-[11px] font-semibold uppercase text-panel-muted-foreground">
          {field === "from" ? "From" : "To"}
        </span>
        <button
          type="button"
          className="min-w-0 flex-1 truncate py-2 text-left text-sm font-medium"
          onClick={() => open(field)}
          disabled={disabled}
        >
          {label}
        </button>
        {unavailable && onRetryGps ? (
          <button
            type="button"
            className={`${touchTargetClass} shrink-0 rounded-full px-2 text-xs font-semibold text-brand-cta`}
            onClick={onRetryGps}
          >
            Retry
          </button>
        ) : null}
        {field === "to" && showAddStop && onAddStop ? (
          <button
            type="button"
            className={`${touchTargetClass} relative shrink-0 rounded-full px-2`}
            onClick={onAddStop}
            aria-label="Add a stop"
          >
            <Plus size={16} />
            {stopCount > 1 ? (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand-cta px-1 text-[10px] font-bold text-brand-cta-foreground">
                {stopCount}
              </span>
            ) : null}
          </button>
        ) : null}
        {end ? (
          <button
            type="button"
            className={`${touchTargetClass} shrink-0 rounded-full px-1 text-panel-muted-foreground`}
            aria-label={field === "from" ? "Clear start" : "Clear destination"}
            onClick={() =>
              field === "from" ? onFromChange(null) : onToChange(null)
            }
            disabled={disabled}
          >
            <X size={16} />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <div
        className={`flex min-w-0 items-stretch overflow-hidden rounded-2xl border border-border ${mapChromeClass}`}
      >
        {leading}
        <div className="min-w-0 flex-1 divide-y divide-border">
          {renderField("from")}
          {renderField("to")}
        </div>
        <button
          type="button"
          className={`${mapBarActionClass} border-l border-border`}
          aria-label="Swap start and destination"
          title="Swap start and destination"
          onClick={onSwap}
          disabled={disabled}
        >
          <ArrowUpDown size={18} aria-hidden="true" />
          Swap
        </button>
      </div>
      {openField ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-2xl border border-border bg-panel p-2 text-panel-foreground shadow-xl">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search campus"
            className="mb-2 w-full rounded-xl border border-border bg-panel-muted px-3 py-2 text-sm outline-none"
          />
          {rows.length === 0 ? (
            <p className="px-2 py-3 text-center text-sm text-panel-muted-foreground">
              No matches
            </p>
          ) : (
            <ul>
              {rows.map((row) => (
                <li key={row.key}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left text-sm hover:bg-panel-muted"
                    onClick={() => choose(row.end)}
                  >
                    {row.end.kind === "gps" ? (
                      <LocateFixed size={16} className="shrink-0" />
                    ) : (
                      <MapPin size={16} className="shrink-0" />
                    )}
                    <span className="truncate">{row.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
