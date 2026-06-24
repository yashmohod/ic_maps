"use client";

import React, { useMemo } from "react";
import { Source, Layer } from "@vis.gl/react-maplibre";
import type { LayerProps } from "@vis.gl/react-maplibre";

type Props = {
  coordinates: [number, number][];
  id?: string;
};

export function RoutePathLayer({ coordinates, id = "route-path" }: Props) {
  const geoJSON = useMemo(() => {
    if (!coordinates || coordinates.length < 2) return null;
    return {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          properties: {},
          geometry: {
            type: "LineString" as const,
            coordinates,
          },
        },
      ],
    };
  }, [coordinates]);

  const layerStyle = useMemo<LayerProps>(
    () => ({
      id: `${id}-line`,
      type: "line",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-width": 7,
        "line-color": "#35D5A4",
        "line-opacity": 0.95,
        "line-blur": 0.2,
      },
    }),
    [id],
  );

  if (!geoJSON) return null;

  return (
    <Source id={id} type="geojson" data={geoJSON}>
      <Layer {...layerStyle} />
    </Source>
  );
}
