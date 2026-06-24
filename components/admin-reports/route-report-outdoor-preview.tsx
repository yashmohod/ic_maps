"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Layer, Map as ReactMap, Marker, Source } from "@vis.gl/react-maplibre";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { useMapStyle } from "@/hooks/use-map-style";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";
import {
  CAMPUS_BOUNDS,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
} from "@/lib/map-constants";
import { parsePolygon, type RouteReportFeatureType } from "@/lib/route-report";
import type { GeoJSONFeatureCollection } from "@/lib/types/map";
import { cn } from "@/lib/utils";

export type RouteReportOutdoorPreviewProps = {
  className?: string;
  destinationPolygon?: string | null;
  nodeOutsideLat?: number | null;
  nodeOutsideLng?: number | null;
  pinLat?: number | null;
  pinLng?: number | null;
  destinationLat?: number | null;
  destinationLng?: number | null;
  featureType?: RouteReportFeatureType | string | null;
};

function collectCoordinates(
  polygon: GeoJSONFeatureCollection | null,
  points: Array<{ lat: number; lng: number }>,
): Array<[number, number]> {
  const coords: Array<[number, number]> = [];

  for (const feature of polygon?.features ?? []) {
    const geometry = feature.geometry;
    if (geometry.type === "Polygon") {
      for (const ring of geometry.coordinates) {
        for (const [lng, lat] of ring) coords.push([lng, lat]);
      }
    } else if (geometry.type === "MultiPolygon") {
      for (const poly of geometry.coordinates) {
        for (const ring of poly) {
          for (const [lng, lat] of ring) coords.push([lng, lat]);
        }
      }
    }
  }

  for (const point of points) {
    coords.push([point.lng, point.lat]);
  }

  return coords;
}

export function RouteReportOutdoorPreview({
  className,
  destinationPolygon,
  nodeOutsideLat,
  nodeOutsideLng,
  pinLat,
  pinLng,
  destinationLat,
  destinationLng,
  featureType,
}: RouteReportOutdoorPreviewProps) {
  const { mapStyle } = useMapStyle();
  const { baseStyle } = usePmtilesStyle({ stylePath: mapStyle });
  const mapRef = useRef<maplibregl.Map | null>(null);
  const canRenderMap = baseStyle != null;

  const polygon = useMemo(
    () => parsePolygon(destinationPolygon),
    [destinationPolygon],
  );

  const marker = useMemo(() => {
    if (
      featureType === "entrance" &&
      nodeOutsideLat != null &&
      nodeOutsideLng != null
    ) {
      return { lat: nodeOutsideLat, lng: nodeOutsideLng };
    }
    if (pinLat != null && pinLng != null) {
      return { lat: pinLat, lng: pinLng };
    }
    if (nodeOutsideLat != null && nodeOutsideLng != null) {
      return { lat: nodeOutsideLat, lng: nodeOutsideLng };
    }
    if (destinationLat != null && destinationLng != null) {
      return { lat: destinationLat, lng: destinationLng };
    }
    return null;
  }, [
    featureType,
    pinLat,
    pinLng,
    nodeOutsideLat,
    nodeOutsideLng,
    destinationLat,
    destinationLng,
  ]);

  const fitTargets = useMemo(
    () => collectCoordinates(polygon, marker ? [marker] : []),
    [polygon, marker],
  );

  const fitBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    if (fitTargets.length >= 2) {
      const bounds = fitTargets.reduce(
        (acc, [lng, lat]) => acc.extend([lng, lat]),
        new maplibregl.LngLatBounds(fitTargets[0], fitTargets[0]),
      );
      map.fitBounds(bounds, { padding: 40, maxZoom: 18, duration: 400 });
      return;
    }

    if (fitTargets.length === 1) {
      const [lng, lat] = fitTargets[0];
      map.flyTo({ center: [lng, lat], zoom: 17, duration: 400 });
      return;
    }

    map.flyTo({
      center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
      zoom: DEFAULT_ZOOM,
      duration: 400,
    });
  }, [fitTargets]);

  useEffect(() => {
    fitBounds();
  }, [fitBounds]);

  const initialCenter = marker ?? DEFAULT_CENTER;

  return (
    <div
      className={cn(
        "border-border bg-panel relative h-56 w-full overflow-hidden rounded-xl border sm:h-64",
        className,
      )}
    >
      {!canRenderMap ? (
        <div className="text-muted-foreground grid h-full place-items-center text-sm">
          Loading map...
        </div>
      ) : (
        <ReactMap
          ref={(ref) => {
            mapRef.current = ref?.getMap() ?? null;
          }}
          initialViewState={{
            longitude: initialCenter.lng,
            latitude: initialCenter.lat,
            zoom: DEFAULT_ZOOM,
          }}
          maxBounds={CAMPUS_BOUNDS}
          mapLib={maplibregl}
          mapStyle={baseStyle as maplibregl.StyleSpecification}
          style={{ width: "100%", height: "100%" }}
          interactive
        >
          {polygon && (
            <Source
              id="report-boundary"
              type="geojson"
              data={polygon as GeoJSON.GeoJSON}
            >
              <Layer
                id="report-boundary-fill"
                type="fill"
                paint={{
                  "fill-color": "#35D5A4",
                  "fill-opacity": 0.2,
                }}
              />
              <Layer
                id="report-boundary-outline"
                type="line"
                paint={{
                  "line-color": "#35D5A4",
                  "line-width": 2,
                }}
              />
            </Source>
          )}

          {marker && (
            <Marker
              longitude={marker.lng}
              latitude={marker.lat}
              anchor="center"
            >
              <div className="flex flex-col items-center gap-1">
                {featureType === "entrance" ? (
                  <span className="rounded-md border border-border bg-panel px-1.5 py-0.5 text-[10px] font-semibold text-panel-foreground shadow">
                    Entrance
                  </span>
                ) : null}
                <div className="bg-brand-cta h-5 w-5 rounded-full border-2 border-white shadow-lg" />
              </div>
            </Marker>
          )}
        </ReactMap>
      )}
    </div>
  );
}
