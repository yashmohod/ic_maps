"use client";

import { Map, Satellite } from "lucide-react";
import type { BasemapId } from "@/hooks/use-basemap";

type Props = {
  basemap: BasemapId;
  onChange: (id: BasemapId) => void;
  className?: string;
};

export function BasemapToggle({
  basemap,
  onChange,
  className = "",
}: Props) {
  const isSat = basemap === "satellite";
  const label = isSat ? "Switch to map view" : "Switch to satellite view";

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
