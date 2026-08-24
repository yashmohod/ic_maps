"use client";

import { useEffect, useMemo, useState } from "react";
import type { StyleSpecification } from "maplibre-gl";
import { SATELLITE_STYLE } from "@/lib/map-constants";

export type BasemapId = "map" | "satellite";

const STORAGE_KEY = "ic-maps-basemap";

export function cloneSatelliteStyle(): StyleSpecification {
  return JSON.parse(JSON.stringify(SATELLITE_STYLE)) as StyleSpecification;
}

export function useBasemap() {
  const [basemap, setBasemapState] = useState<BasemapId>("map");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "satellite" || stored === "map") setBasemapState(stored);
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  function setBasemap(next: BasemapId) {
    setBasemapState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  return { basemap, setBasemap };
}

/** Map vs satellite style for any MapLibre page that already has OSM `baseStyle`. */
export function useBasemapStyle(baseStyle: StyleSpecification | null) {
  const { basemap, setBasemap } = useBasemap();
  const satelliteStyle = useMemo(() => cloneSatelliteStyle(), []);
  const resolvedMapStyle =
    basemap === "satellite" ? satelliteStyle : baseStyle;
  const canRenderMap = basemap === "satellite" || !!baseStyle;
  return { basemap, setBasemap, resolvedMapStyle, canRenderMap };
}
