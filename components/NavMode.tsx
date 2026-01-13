"use client";

import React, { useMemo, useEffect, useRef } from "react";
import { Source, Layer } from "@vis.gl/react-maplibre";
import type { LayerProps } from "@vis.gl/react-maplibre";
import { getAllMapFeature, getAllMapFeaturesNavMode } from "@/lib/icmapsApi";
import { useAppTheme } from "@/hooks/use-app-theme";

/** -------- Types -------- */

export type MarkerNode = {
  id: string | number;
  lng: number;
  lat: number;
};

export type EdgeIndexEntry = {
  key: string;
  from: string | number;
  to: string | number;
};

type FeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, any>;

type Props = {
  path: Set<string>;
  navMode: string | number | null;
  markers: MarkerNode[];
  setMarkers: React.Dispatch<React.SetStateAction<MarkerNode[]>>;
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
  navMode,
  markers,
  setMarkers,
  edgeIndex,
  setEdgeIndex,
  showBaseGraph = true,
}: Props) {
  const { isDark } = useAppTheme();
  const featureCacheRef = useRef<Map<string, CachedFeatures>>(new Map());

  function isInPath(id: string | number) {
    return path.has(String(id));
  }

  const edgesGeoJSON = useMemo<FeatureCollection>(() => {
    const coord = new Map<string, [number, number]>(
      markers.map((m) => [String(m.id), [m.lng, m.lat]]),
    );

    const features: GeoJSON.Feature[] = edgeIndex
      .map(({ key, from, to }) => {
        const a = coord.get(String(from));
        const b = coord.get(String(to));
        if (!a || !b) return null;

        return {
          type: "Feature",
          properties: {
            key: String(key),
            from: String(from),
            to: String(to),
            path: isInPath(key), // key can be string|number, isInPath handles it
          },
          geometry: {
            type: "LineString",
            coordinates: [a, b],
          },
        } as GeoJSON.Feature;
      })
      .filter((f): f is GeoJSON.Feature => Boolean(f));

    return {
      type: "FeatureCollection",
      features,
    };
  }, [markers, edgeIndex, path]);

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

  useEffect(() => {
    let isActive = true;
    const cacheKey = String(navMode ?? "default");

    async function loadFeatures() {
      const cached = featureCacheRef.current.get(cacheKey);
      if (cached) {
        setMarkers(cached.nodes ?? []);
        setEdgeIndex(cached.edges ?? []);
        return;
      }

      try {
        const resp =
          navMode != null
            ? await getAllMapFeaturesNavMode(navMode)
            : await getAllMapFeature();

        // Support axios-style {data} OR fetch-style direct JSON
        const data: CachedFeatures =
          (resp as any)?.data ?? (resp as any) ?? ({} as CachedFeatures);

        featureCacheRef.current.set(cacheKey, data);
        if (!isActive) return;

        setMarkers(data.nodes ?? []);
        setEdgeIndex(data.edges ?? []);
      } catch (err) {
        console.error("Failed to load nav mode features", err);
        if (!isActive) return;
        setMarkers([]);
        setEdgeIndex([]);
      }
    }

    loadFeatures();
    return () => {
      isActive = false;
    };
  }, [navMode, setMarkers, setEdgeIndex]);

  if (!showBaseGraph) return null;

  return (
    <Source id="edges" type="geojson" data={edgesGeoJSON as any}>
      <Layer {...(lineLayer as any)} />
    </Source>
  );
}
