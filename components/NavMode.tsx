"use client";

import React, { useMemo, useEffect, useRef } from "react";
import { Source, Layer } from "@vis.gl/react-maplibre";
import type { LayerProps } from "@vis.gl/react-maplibre";
import { useAppTheme } from "@/hooks/use-app-theme";
import apiClient from "@/lib/apiClient";
import toast from "react-hot-toast";
import type { NavConditions } from "@/lib/navigation";
/** -------- Types -------- */
type MarkerNode = {
  id: number;
  lng: number;
  lat: number;
  isBlueLight: boolean;
  isPedestrian: boolean;
  isVehicular: boolean;
  isStairs: boolean;
  isElevator: boolean;
};

type EdgeIndexEntry = {
  id: number;
  from: number;
  to: number;
  biDirectional: boolean;
  incline: number;
};
type NavMode = {
  id: number;
  name: string;
  param: string;
}


type FeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, any>;

type Props = {
  path: number[];
  curNavConditions: NavConditions;
  markers: MarkerNode[];
  edgeIndex: EdgeIndexEntry[];
  setEdgeIndex: React.Dispatch<React.SetStateAction<EdgeIndexEntry[]>>;
  showBaseGraph?: boolean;
};

type CachedFeatures = {
  nodes?: MarkerNode[];
  edges?: EdgeIndexEntry[];
};

export default function NavMode({
  path,
  curNavConditions,
  markers,
  edgeIndex,
  setEdgeIndex,
  showBaseGraph = true,
}: Props) {
  const { isDark } = useAppTheme();
  const featureCacheRef = useRef<Map<number, CachedFeatures>>(new Map());




  const edgesGeoJSON = useMemo<FeatureCollection>(() => {

    const features: GeoJSON.Feature[] = edgeIndex
      .map(({ id, from, to }) => {
        const a = markers.find((cur) => cur.id === from);
        const b = markers.find((cur) => cur.id === to);
        if (!a || !b) return null;
        if (curNavConditions.is_pedestrian) {
          if (!a.isPedestrian || !b.isPedestrian) {
            return null;
          }
        }
        if (curNavConditions.is_vehicular) {
          if (!a.isVehicular || !b.isVehicular) {
            return null;
          }
        }
        return {
          type: "Feature",
          properties: {
            key: String(id),
            from: String(from),
            to: String(to),
            path: path.find((cur) => cur === id) !== undefined ? true : false, // key can be string|number, isInPath handles it
          },
          geometry: {
            type: "LineString",
            coordinates: [[a.lng, a.lat], [b.lng, b.lat]],
          },
        } as GeoJSON.Feature;
      })
      .filter((f): f is GeoJSON.Feature => Boolean(f));

    return {
      type: "FeatureCollection",
      features,
    };
  }, [markers, edgeIndex, path, curNavConditions]);

  const lineLayer = useMemo<LayerProps>(
    () => ({
      id: "graph-edges",
      type: "line",
      source: "edges",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-width": ["case", ["boolean", ["get", "path"], false], 6, 2],
        "line-color": [
          "case",
          ["boolean", ["get", "path"], false],
          isDark ? "#facc15" : "#1f2937",
          isDark ? "#e2e8f0" : "#374151",
        ],
        "line-opacity": [
          "case",
          ["boolean", ["get", "path"], false],
          0.95,
          0.35,
        ],
      },
    }),
    [isDark],
  );




  if (!showBaseGraph) return null;

  return (
    <Source id="edges" type="geojson" data={edgesGeoJSON as any}>
      <Layer {...(lineLayer as any)} />
    </Source>
  );
}
