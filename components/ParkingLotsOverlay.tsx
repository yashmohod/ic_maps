"use client";

import React, { useEffect, useMemo } from "react";
import { Source, Layer } from "@vis.gl/react-maplibre";
import type { LayerProps } from "@vis.gl/react-maplibre";
import type {
  Feature,
  FeatureCollection,
  Polygon,
  GeoJsonProperties,
} from "geojson";
import type { Map as MlMap } from "maplibre-gl";

/** Default parking fill — distinct from building teal/navy. */
export const PARKING_DEFAULT_FILL = "#d97706";
export const PARKING_DEFAULT_OUTLINE = "#92400e";

/** Building fill — matches prior Draw cold color. */
export const BUILDING_DEFAULT_FILL = "#1a5276";
export const BUILDING_DEFAULT_OUTLINE = "#0e2f44";
export const BUILDING_SELECTED_FILL = "#35D5A4";

/** Distinct colors for recommended lots linked to the selected building. */
export const PARKING_RECOMMENDED_PALETTE = [
  "#c45c26",
  "#2a9d8f",
  "#e9c46a",
  "#264653",
  "#e76f51",
  "#457b9d",
  "#9b5de5",
  "#00bbf9",
] as const;

export function parkingRecommendedColor(index: number): string {
  return PARKING_RECOMMENDED_PALETTE[
    Math.abs(index) % PARKING_RECOMMENDED_PALETTE.length
  ]!;
}

/** Keep destination overlays under MapLibre Draw so create/edit still receive clicks. */
function placeOverlayBelowDraw(map: MlMap, layerId: string) {
  if (!map.getLayer(layerId)) return;
  const drawLayer = map
    .getStyle()
    ?.layers?.find((l) => String(l.id).includes("gl-draw"));
  try {
    if (drawLayer) map.moveLayer(layerId, drawLayer.id);
    // If Draw isn't mounted yet, leave overlay where React put it.
  } catch {
    /* style may not be ready */
  }
}

type BuildingOverlayProps = {
  map: MlMap | null;
  features: Array<Feature<Polygon, GeoJsonProperties>>;
  selectedId?: number | null;
  sourceId?: string;
};

/** Stable navy building footprints (Draw can wipe on style reload). */
export function BuildingsOverlay({
  map,
  features,
  selectedId = null,
  sourceId = "buildings-overlay",
}: BuildingOverlayProps) {
  const data = useMemo<FeatureCollection<Polygon, GeoJsonProperties>>(() => {
    return {
      type: "FeatureCollection",
      features: features.map((f) => {
        const destId = Number(f.properties?.destId ?? f.id);
        const selected = selectedId != null && destId === selectedId;
        return {
          ...f,
          properties: {
            ...(f.properties ?? {}),
            destId,
            selected,
            fillColor: selected ? BUILDING_SELECTED_FILL : BUILDING_DEFAULT_FILL,
            outlineColor: selected
              ? BUILDING_SELECTED_FILL
              : BUILDING_DEFAULT_OUTLINE,
            outlineWidth: selected ? 2.5 : 1.5,
          },
        };
      }),
    };
  }, [features, selectedId]);

  const fillStyle = useMemo<LayerProps>(
    () => ({
      id: `${sourceId}-fill`,
      type: "fill",
      paint: {
        "fill-color": ["get", "fillColor"],
        "fill-opacity": 0.35,
      },
    }),
    [sourceId],
  );

  const outlineStyle = useMemo<LayerProps>(
    () => ({
      id: `${sourceId}-outline`,
      type: "line",
      paint: {
        "line-color": ["get", "outlineColor"],
        "line-width": ["get", "outlineWidth"],
      },
    }),
    [sourceId],
  );

  useEffect(() => {
    if (!map) return;
    const place = () => {
      placeOverlayBelowDraw(map, `${sourceId}-fill`);
      placeOverlayBelowDraw(map, `${sourceId}-outline`);
    };
    // Only on load / style swap — not every styledata (that fights Draw).
    map.on("load", place);
    map.on("style.load", place);
    place();
    return () => {
      map.off("load", place);
      map.off("style.load", place);
    };
  }, [map, sourceId]);

  if (features.length === 0) return null;

  return (
    <Source id={sourceId} type="geojson" data={data}>
      <Layer {...fillStyle} />
      <Layer {...outlineStyle} />
    </Source>
  );
}

export const BUILDINGS_OVERLAY_FILL_LAYER = "buildings-overlay-fill";

type ParkingProps = {
  map: MlMap | null;
  features: Array<Feature<Polygon, GeoJsonProperties>>;
  /** Parking lot ids currently recommended for the selected building. */
  recommendedIds: number[];
  sourceId?: string;
};

export function ParkingLotsOverlay({
  map,
  features,
  recommendedIds,
  sourceId = "parking-lots-overlay",
}: ParkingProps) {
  const recommendedIndex = useMemo(() => {
    const m = new Map<number, number>();
    recommendedIds.forEach((id, i) => m.set(id, i));
    return m;
  }, [recommendedIds]);

  const data = useMemo<FeatureCollection<Polygon, GeoJsonProperties>>(() => {
    return {
      type: "FeatureCollection",
      features: features.map((f) => {
        const destId = Number(f.properties?.destId ?? f.id);
        const recIdx = recommendedIndex.get(destId);
        const recommended = recIdx != null;
        return {
          ...f,
          properties: {
            ...(f.properties ?? {}),
            destId,
            recommended,
            fillColor: recommended
              ? parkingRecommendedColor(recIdx)
              : PARKING_DEFAULT_FILL,
            outlineColor: recommended
              ? parkingRecommendedColor(recIdx)
              : PARKING_DEFAULT_OUTLINE,
            outlineWidth: recommended ? 3 : 1.5,
          },
        };
      }),
    };
  }, [features, recommendedIndex]);

  const fillStyle = useMemo<LayerProps>(
    () => ({
      id: `${sourceId}-fill`,
      type: "fill",
      paint: {
        "fill-color": ["get", "fillColor"],
        "fill-opacity": 0.4,
      },
    }),
    [sourceId],
  );

  const outlineStyle = useMemo<LayerProps>(
    () => ({
      id: `${sourceId}-outline`,
      type: "line",
      paint: {
        "line-color": ["get", "outlineColor"],
        "line-width": ["get", "outlineWidth"],
      },
    }),
    [sourceId],
  );

  useEffect(() => {
    if (!map) return;
    const place = () => {
      // Parking above buildings overlay, still below Draw.
      placeOverlayBelowDraw(map, `${sourceId}-fill`);
      placeOverlayBelowDraw(map, `${sourceId}-outline`);
    };
    map.on("load", place);
    map.on("style.load", place);
    place();
    return () => {
      map.off("load", place);
      map.off("style.load", place);
    };
  }, [map, sourceId]);

  if (features.length === 0) return null;

  return (
    <Source id={sourceId} type="geojson" data={data}>
      <Layer {...fillStyle} />
      <Layer {...outlineStyle} />
    </Source>
  );
}

export const PARKING_OVERLAY_FILL_LAYER = "parking-lots-overlay-fill";
