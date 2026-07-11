"use client";
import {
  Map as ReactMap,
  Source,
  Layer,
  type MapRef,
  type ViewStateChangeEvent,
} from "@vis.gl/react-maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { toast } from "sonner";
import maplibregl from "maplibre-gl";
import { HomeLogoLink } from "@/components/home-logo-link";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import { useRef, useState } from "react";

import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/map-constants";
import { useMapStyle } from "@/hooks/use-map-style";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";

export default function MyMaps() {
  const [viewState, setViewState] = useState<{
    longitude: number;
    latitude: number;
    zoom: number;
    bearing: number;
    pitch: number;
  }>({
    longitude: DEFAULT_CENTER.lng,
    latitude: DEFAULT_CENTER.lat,
    zoom: DEFAULT_ZOOM,
    bearing: 0,
    pitch: 0,
  });

  const [mapReady, setMapReady] = useState(false);

  const { mapStyle } = useMapStyle();
  const { baseStyle } = usePmtilesStyle();
  const canRenderMap = !!baseStyle;
  const mapRef = useRef<MapRef | null>(null);
  return (
    <>
      {/* Map — full-bleed on desktop; top half on mobile */}
      <div className="order-1 h-[45vh] min-h-[240px] w-full md:absolute md:inset-0 md:h-full">
        {!canRenderMap && mapReady ? (
          <div className="h-full w-full grid place-items-center text-sm opacity-70">
            Loading basemap...
          </div>
        ) : (
          <ReactMap
            ref={mapRef}
            {...viewState}
            onMove={(e: ViewStateChangeEvent) =>
              setViewState((prev) => ({ ...prev, ...e.viewState }))
            }
            mapLib={maplibregl}
            mapStyle={baseStyle as any}
            onLoad={() => setMapReady(true)}
          ></ReactMap>
        )}
      </div>
    </>
  );
}
