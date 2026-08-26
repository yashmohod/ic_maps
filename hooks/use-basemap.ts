"use client";

import { useEffect, useMemo, useState } from "react";
import type { StyleSpecification } from "maplibre-gl";
import {
  buildSatelliteStyle,
  SATELLITE_DETAIL_TILE_PATH,
  SATELLITE_TILE_PATH,
} from "@/lib/map-constants";
import { withBasePath } from "@/lib/base-path";

export type BasemapId = "map" | "satellite";

const STORAGE_KEY = "ic-maps-basemap";

export function cloneSatelliteStyle(): StyleSpecification {
  return buildSatelliteStyle(
    withBasePath(SATELLITE_TILE_PATH),
    withBasePath(SATELLITE_DETAIL_TILE_PATH),
  );
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
  const resolvedMapStyle = basemap === "satellite" ? satelliteStyle : baseStyle;
  const canRenderMap = basemap === "satellite" || !!baseStyle;
  return { basemap, setBasemap, resolvedMapStyle, canRenderMap };
}
