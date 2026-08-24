"use client";

import React, { useMemo } from "react";
import { Source, Layer } from "@vis.gl/react-maplibre";
import type { LayerProps } from "@vis.gl/react-maplibre";
import type { ThroughBuildingPortal } from "@/lib/navigation-route-model";

type Props = {
  /** Continuous polyline (legacy / GPS). Used for drawing when segments are absent. */
  coordinates?: [number, number][];
  /** Outdoor-only line runs; gaps at through-building hops. */
  segments?: [number, number][][];
  /** Entry/exit door markers for through-building hops. */
  portals?: ThroughBuildingPortal[];
  id?: string;
};

export function RoutePathLayer({
  coordinates,
  segments,
  portals = [],
  id = "route-path",
}: Props) {
  const lineGeoJSON = useMemo(() => {
    const runs =
      segments && segments.length > 0
        ? segments.filter((s) => s.length >= 2)
        : coordinates && coordinates.length >= 2
          ? [coordinates]
          : [];
    if (runs.length === 0) return null;
    return {
      type: "FeatureCollection" as const,
      features: runs.map((coords, i) => ({
        type: "Feature" as const,
        properties: { i },
        geometry: {
          type: "LineString" as const,
          coordinates: coords,
        },
      })),
    };
  }, [coordinates, segments]);

  const portalGeoJSON = useMemo(() => {
    if (!portals.length) return null;
    const features = portals.flatMap((p, i) => [
      {
        type: "Feature" as const,
        properties: { role: "entry", i },
        geometry: { type: "Point" as const, coordinates: p.entry },
      },
      {
        type: "Feature" as const,
        properties: { role: "exit", i },
        geometry: { type: "Point" as const, coordinates: p.exit },
      },
    ]);
    return { type: "FeatureCollection" as const, features };
  }, [portals]);

  const lineStyle = useMemo<LayerProps>(
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

  const portalHaloStyle = useMemo<LayerProps>(
    () => ({
      id: `${id}-portal-halo`,
      type: "circle",
      paint: {
        "circle-radius": 10,
        "circle-color": "#ffffff",
        "circle-opacity": 0.95,
      },
    }),
    [id],
  );

  const portalDotStyle = useMemo<LayerProps>(
    () => ({
      id: `${id}-portal-dot`,
      type: "circle",
      paint: {
        "circle-radius": 6,
        "circle-color": [
          "match",
          ["get", "role"],
          "entry",
          "#35D5A4",
          "exit",
          "#003c71",
          "#35D5A4",
        ],
        "circle-stroke-width": 0,
      },
    }),
    [id],
  );

  if (!lineGeoJSON && !portalGeoJSON) return null;

  return (
    <>
      {lineGeoJSON ? (
        <Source id={id} type="geojson" data={lineGeoJSON}>
          <Layer {...lineStyle} />
        </Source>
      ) : null}
      {portalGeoJSON ? (
        <Source id={`${id}-portals`} type="geojson" data={portalGeoJSON}>
          <Layer {...portalHaloStyle} />
          <Layer {...portalDotStyle} />
        </Source>
      ) : null}
    </>
  );
}
