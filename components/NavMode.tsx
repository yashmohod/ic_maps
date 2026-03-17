"use client";

import React, { useMemo } from "react";
import { Source, Layer } from "@vis.gl/react-maplibre";
import type { LayerProps } from "@vis.gl/react-maplibre";
import { useAppTheme } from "@/hooks/use-app-theme";
import type { NavConditions } from "@/lib/navigation";
import type { MarkerNode, EdgeIndexEntry } from "@/lib/types/map";

type Path = {
  path: Set<number>;
  firstNodeId: number;
  lastNodeId: number;
}
type FeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, any>;

/** Markers with at least id/lng/lat; id may be string or number; nav flags optional (missing treated as true). */
type NavModeMarker = { id: string | number; lng: number; lat: number } &
  Partial<Pick<MarkerNode, "isPedestrian" | "isVehicular">>;

/** Edge with at least from/to; id or key for path highlight. Compatible with EdgeIndexEntry and route [id]'s RouteEdgeEntry. */
type NavModeEdge = { from: number | string; to: number | string; id?: number | string; key?: string };

type Props = {
  path: Path;
  curNavConditions: NavConditions;
  markers: NavModeMarker[];
  edgeIndex: NavModeEdge[];
  setEdgeIndex?: React.Dispatch<React.SetStateAction<EdgeIndexEntry[]>>;
  showBaseGraph?: boolean;
};

export default function NavMode({
  path,
  curNavConditions,
  markers,
  edgeIndex,
  setEdgeIndex: _setEdgeIndex,
  showBaseGraph = true,
}: Props) {
  const { isDark } = useAppTheme();

  const edgesGeoJSON = useMemo<FeatureCollection>(() => {

    const features: GeoJSON.Feature[] = edgeIndex
      .map((e) => {
        const { from, to } = e;
        const edgeId = "id" in e && e.id != null ? e.id : "key" in e && e.key != null ? e.key : from;
        const a = markers.find((cur) => cur.id === from || String(cur.id) === String(from));
        const b = markers.find((cur) => cur.id === to || String(cur.id) === String(to));
        if (!a || !b) return null;
        if (curNavConditions.is_pedestrian) {
          if (!(a.isPedestrian ?? true) || !(b.isPedestrian ?? true)) {
            return null;
          }
        }
        if (curNavConditions.is_vehicular) {
          if (!(a.isVehicular ?? true) || !(b.isVehicular ?? true)) {
            return null;
          }
        }
        return {
          type: "Feature",
          properties: {
            key: String(edgeId),
            from: String(from),
            to: String(to),
            path: path.path.has(Number(edgeId)),
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
          "#35D5A4",
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
