"use client";

import { Source, Layer } from "@vis.gl/react-maplibre";

type Props = {
  data: GeoJSON.GeoJSON;
  isDark: boolean;
};

export function AccuracyRingLayer({ data, isDark }: Props) {
  return (
    <Source id="loc-accuracy" type="geojson" data={data}>
      <Layer
        id="loc-accuracy-fill"
        type="fill"
        paint={{
          "fill-color": isDark ? "#60a5fa" : "#3b82f6",
          "fill-opacity": 0.15,
        }}
      />
      <Layer
        id="loc-accuracy-line"
        type="line"
        paint={{
          "line-color": isDark ? "#60a5fa" : "#3b82f6",
          "line-width": 2,
          "line-opacity": 0.6,
        }}
      />
    </Source>
  );
}
