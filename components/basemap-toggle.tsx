"use client";

import { Map, Satellite } from "lucide-react";
import type { BasemapId } from "@/hooks/use-basemap";

type Props = {
  basemap: BasemapId;
  onChange: (id: BasemapId) => void;
  className?: string;
  variant?: "icon" | "menu";
};

export function BasemapToggle({
  basemap,
  onChange,
  className = "",
  variant = "icon",
}: Props) {
  const isSat = basemap === "satellite";
  const label = isSat ? "Switch to map view" : "Switch to satellite view";
  const current = isSat ? "Satellite" : "Map";

  if (variant === "menu") {
    return (
      <button
        type="button"
        aria-label={label}
        aria-pressed={isSat}
        title={label}
        onClick={() => onChange(isSat ? "map" : "satellite")}
        className={[
          "flex h-9 w-full cursor-pointer items-center gap-2 rounded-xl border border-border bg-panel px-3 text-left text-sm text-panel-foreground transition hover:bg-panel-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-cta/50",
          className,
        ].join(" ")}
      >
        <span className="text-brand-cta">
          {isSat ? (
            <Satellite size={16} aria-hidden="true" />
          ) : (
            <Map size={16} aria-hidden="true" />
          )}
        </span>
        <span className="font-semibold">Map type</span>
        <span className="ml-auto text-xs text-panel-muted-foreground">
          {current}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isSat}
      title={label}
      onClick={() => onChange(isSat ? "map" : "satellite")}
      className={[
        "inline-flex items-center justify-center rounded-2xl border border-border bg-panel text-panel-foreground shadow-lg transition hover:bg-panel-muted focus:outline-none focus:ring-2 focus:ring-brand-cta/30",
        className,
      ].join(" ")}
    >
      {isSat ? <Map size={18} /> : <Satellite size={18} />}
    </button>
  );
}
