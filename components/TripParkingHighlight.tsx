"use client";

import { Source, Layer } from "@vis.gl/react-maplibre";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import {
  PARKING_DEFAULT_FILL,
  PARKING_DEFAULT_OUTLINE,
} from "@/components/ParkingLotsOverlay";

/** Amber footprint for parking lots used in the active trip (vs teal buildings). */
export function TripParkingHighlight({
  data,
  sourceId = "trip-parking",
}: {
  data: FeatureCollection<Polygon> | null;
  sourceId?: string;
}) {
  if (!data || data.features.length === 0) return null;

  return (
    <Source id={sourceId} type="geojson" data={data}>
      <Layer
        id={`${sourceId}-fill`}
        type="fill"
        paint={{
          "fill-color": PARKING_DEFAULT_FILL,
          "fill-opacity": 0.28,
        }}
      />
      <Layer
        id={`${sourceId}-outline`}
        type="line"
        paint={{
          "line-color": PARKING_DEFAULT_OUTLINE,
          "line-width": 2.5,
        }}
      />
    </Source>
  );
}

/** Parse a destination polygon string into polygon features tagged with destId. */
export function featuresFromDestinationPolygon(
  polygon: string,
  destId: number,
): Feature<Polygon>[] {
  try {
    const parsed = JSON.parse(polygon) as
      | FeatureCollection
      | Feature<Polygon>
      | Polygon;
    if (parsed.type === "FeatureCollection") {
      return (parsed.features as Feature[]).flatMap((f) => {
        if (!f.geometry || f.geometry.type !== "Polygon") return [];
        return [
          {
            ...f,
            type: "Feature" as const,
            geometry: f.geometry as Polygon,
            properties: { ...(f.properties ?? {}), destId },
          },
        ];
      });
    }
    if (parsed.type === "Feature" && parsed.geometry?.type === "Polygon") {
      return [
        {
          ...parsed,
          geometry: parsed.geometry,
          properties: { ...(parsed.properties ?? {}), destId },
        },
      ];
    }
    if (parsed.type === "Polygon") {
      return [
        {
          type: "Feature",
          geometry: parsed,
          properties: { destId },
        },
      ];
    }
  } catch {
    /* skip bad polygon */
  }
  return [];
}
