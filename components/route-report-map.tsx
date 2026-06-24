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
import type {
  GeoJSONFeatureCollection,
  OutsideNodeDetail,
} from "@/lib/types/map";
import { cn } from "@/lib/utils";

type RouteReportMapProps = {
  className?: string;
  mode: "freePin" | "entrance";
  polygon: GeoJSONFeatureCollection | null;
  entrances: OutsideNodeDetail[];
  selectedOutsideNodeId: number | null;
  pin: { lat: number; lng: number } | null;
  onSelectEntrance: (nodeId: number) => void;
  onPinChange: (pin: { lat: number; lng: number }) => void;
};

function collectCoordinates(
  polygon: GeoJSONFeatureCollection | null,
  entrances: OutsideNodeDetail[],
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

  for (const entrance of entrances) {
    coords.push([entrance.lng, entrance.lat]);
  }

  return coords;
}

export function RouteReportMap({
  className,
  mode,
  polygon,
  entrances,
  selectedOutsideNodeId,
  pin,
  onSelectEntrance,
  onPinChange,
}: RouteReportMapProps) {
  const { mapStyle } = useMapStyle();
  const { baseStyle } = usePmtilesStyle({ stylePath: mapStyle });
  const mapRef = useRef<maplibregl.Map | null>(null);
  const canRenderMap = baseStyle != null;

  const fitTargets = useMemo(
    () => collectCoordinates(polygon, entrances),
    [polygon, entrances],
  );

  const fitBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    if (fitTargets.length >= 2) {
      const bounds = fitTargets.reduce(
        (acc, [lng, lat]) => acc.extend([lng, lat]),
        new maplibregl.LngLatBounds(fitTargets[0], fitTargets[0]),
      );
      map.fitBounds(bounds, { padding: 48, maxZoom: 18, duration: 500 });
      return;
    }

    if (fitTargets.length === 1) {
      const [lng, lat] = fitTargets[0];
      map.flyTo({ center: [lng, lat], zoom: 17, duration: 500 });
      return;
    }

    if (pin) {
      map.flyTo({ center: [pin.lng, pin.lat], zoom: 16, duration: 500 });
    }
  }, [fitTargets, pin]);

  useEffect(() => {
    fitBounds();
  }, [fitBounds]);

  useEffect(() => {
    if (selectedOutsideNodeId == null) return;
    const entrance = entrances.find((e) => e.id === selectedOutsideNodeId);
    if (!entrance) return;
    mapRef.current?.flyTo({
      center: [entrance.lng, entrance.lat],
      zoom: 18,
      duration: 400,
    });
  }, [selectedOutsideNodeId, entrances]);

  function handleMapClick(event: maplibregl.MapMouseEvent) {
    if (mode !== "freePin") return;
    onPinChange({ lat: event.lngLat.lat, lng: event.lngLat.lng });
  }

  return (
    <div
      className={cn(
        "border-border bg-panel relative h-64 w-full overflow-hidden rounded-xl border",
        className,
      )}
    >
      {!canRenderMap ? (
        <div className="text-muted-foreground grid h-full place-items-center text-sm">
          Loading map...
        </div>
      ) : (
        <>
          <ReactMap
            ref={(ref) => {
              mapRef.current = ref?.getMap() ?? null;
            }}
            initialViewState={{
              longitude: pin?.lng ?? DEFAULT_CENTER.lng,
              latitude: pin?.lat ?? DEFAULT_CENTER.lat,
              zoom: DEFAULT_ZOOM,
            }}
            maxBounds={CAMPUS_BOUNDS}
            mapLib={maplibregl}
            mapStyle={baseStyle as maplibregl.StyleSpecification}
            style={{ width: "100%", height: "100%" }}
            onClick={handleMapClick}
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

            {mode === "entrance" &&
              entrances.map((entrance, index) => {
                const isSelected = entrance.id === selectedOutsideNodeId;
                const markerLabel =
                  entrance.name?.trim() || `Entrance ${index + 1}`;
                return (
                  <Marker
                    key={entrance.id}
                    longitude={entrance.lng}
                    latitude={entrance.lat}
                    anchor="center"
                  >
                    <div className="flex flex-col items-center gap-1">
                      {isSelected ? (
                        <span className="rounded-md border border-border bg-panel px-1.5 py-0.5 text-[10px] font-semibold text-panel-foreground shadow">
                          {markerLabel}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Select ${markerLabel}`}
                        aria-pressed={isSelected}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectEntrance(entrance.id);
                        }}
                        className={cn(
                          "rounded-full border-2 border-white shadow transition",
                          isSelected
                            ? "bg-brand-cta h-5 w-5"
                            : "bg-brand h-4 w-4 hover:scale-110",
                        )}
                      />
                    </div>
                  </Marker>
                );
              })}

            {mode === "freePin" && pin && (
              <Marker
                longitude={pin.lng}
                latitude={pin.lat}
                anchor="center"
                draggable
                onDragEnd={(event) =>
                  onPinChange({
                    lat: event.lngLat.lat,
                    lng: event.lngLat.lng,
                  })
                }
              >
                <div
                  className="bg-destructive h-4 w-4 rounded-full border-2 border-white shadow-lg"
                  title={`Report location (${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)})`}
                />
              </Marker>
            )}
          </ReactMap>

          <p className="bg-panel/90 text-muted-foreground pointer-events-none absolute inset-x-0 bottom-0 px-3 py-2 text-xs">
            {mode === "freePin"
              ? "Tap the map to mark the problem location. Drag the pin to adjust."
              : "Tap an entrance marker or pick one from the list above."}
          </p>
        </>
      )}
    </div>
  );
}
