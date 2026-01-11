// src/app/route/[id]/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  Map as ReactMap,
  Source,
  Layer,
  Marker,
  type MapRef,
  type ViewStateChangeEvent,
} from "@vis.gl/react-maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import toast, { Toaster } from "react-hot-toast";
import { useParams } from "next/navigation";

import type { LineLayerSpecification } from "maplibre-gl";

import { useAppTheme } from "@/hooks/use-app-theme";
import { getAllNavModes, RouteNavigate } from "@/lib/icmapsApi"; // <-- ensure exported
// If yours is RouteNavigate, change the import:
// import { getAllNavModes, RouteNavigate as RouteNaviagate } from "@/lib/icmapsApi";

type LngLat = { lng: number; lat: number };

type UserPos = {
  lng: number;
  lat: number;
  accuracy?: number;
  heading?: number | null;
};

type NavMode = {
  id: string | number;
  name: string;
};

type MarkerNode = { id?: string | number; lng: number; lat: number };

type GeoJSONFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, unknown>;
    geometry:
    | { type: "Point"; coordinates: [number, number] }
    | { type: "LineString"; coordinates: Array<[number, number]> }
    | { type: "Polygon"; coordinates: Array<Array<[number, number]>> };
  }>;
};

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      className={[
        "inline-block animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      ].join(" ")}
      aria-label="Loading"
    />
  );
}

/** Robustly extract an array of "nodes" from whatever your API returns */
function extractNodes(resp: any): any[] {
  if (!resp) return [];
  if (Array.isArray(resp)) return resp;

  const candidates = [
    resp.nodes,
    resp.routeNodes,
    resp.route_nodes,
    resp.pathNodes,
    resp.path_nodes,
    resp.data,
    resp.payload?.nodes,
    resp.payload?.route_nodes,
  ];

  const found = candidates.find((x) => Array.isArray(x));
  return Array.isArray(found) ? found : [];
}

/** Convert node-ish values into {lng,lat} */
function normalizeNodes(raw: any[]): MarkerNode[] {
  return raw
    .map((n) => {
      // shape A: {lng, lat}
      if (n && typeof n === "object" && "lng" in n && "lat" in n) {
        const lng = Number((n as any).lng);
        const lat = Number((n as any).lat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        return { id: (n as any).id, lng, lat };
      }

      // shape B: {x,y}
      if (n && typeof n === "object" && "x" in n && "y" in n) {
        const lng = Number((n as any).x);
        const lat = Number((n as any).y);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        return { id: (n as any).id, lng, lat };
      }

      // shape C: [lng,lat]
      if (Array.isArray(n) && n.length >= 2) {
        const lng = Number(n[0]);
        const lat = Number(n[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        return { lng, lat };
      }

      return null;
    })
    .filter(Boolean) as MarkerNode[];
}

function makeCircleGeoJSON(
  lng: number,
  lat: number,
  radiusMeters: number,
  points = 64,
): GeoJSONFeatureCollection {
  const coords: Array<[number, number]> = [];
  const d = radiusMeters / 6378137;
  const [lon, latRad] = [toRad(lng), toRad(lat)];

  for (let i = 0; i <= points; i++) {
    const brng = (i * 2 * Math.PI) / points;
    const lat2 = Math.asin(
      Math.sin(latRad) * Math.cos(d) +
      Math.cos(latRad) * Math.sin(d) * Math.cos(brng),
    );
    const lon2 =
      lon +
      Math.atan2(
        Math.sin(brng) * Math.sin(d) * Math.cos(latRad),
        Math.cos(d) - Math.sin(latRad) * Math.sin(lat2),
      );
    coords.push([toDeg(lon2), toDeg(lat2)]);
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [coords] },
      },
    ],
  };
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}
function toDeg(rad: number) {
  return (rad * 180) / Math.PI;
}

export default function ShareRouteNavigatePage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const routeId = params?.id ? String(params.id) : "";

  const defViewState = useMemo(
    () => ({
      longitude: -76.494131,
      latitude: 42.422108,
      zoom: 15.5,
      bearing: 0,
      pitch: 0,
    }),
    [],
  );

  const [viewState, setViewState] = useState(defViewState);
  const mapRef = useRef<MapRef | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const { isDark } = useAppTheme();
  const mapStyleUrl = isDark
    ? "https://api.maptiler.com/maps/dataviz-dark/style.json?key=ezFqZj4n29WctcwDznlR"
    : "https://api.maptiler.com/maps/base-v4/style.json?key=ezFqZj4n29WctcwDznlR";

  const surfacePanelClass = "bg-panel text-panel-foreground";
  const surfaceSubtleClass = "bg-panel-muted text-panel-muted-foreground";
  const borderMutedClass = "border-border";

  /** -------- nav modes -------- */
  const [navModes, setNavModes] = useState<NavMode[]>([]);
  const [curNavMode, setCurNavMode] = useState<string | number>("");
  const [modesPending, setModesPending] = useState(true);

  async function loadNavModes() {
    setModesPending(true);
    try {
      const resp: any = await getAllNavModes();
      const list: NavMode[] = resp?.NavModes ?? resp?.navModes ?? [];
      setNavModes(list);
      if (list.length > 0) setCurNavMode(list[0].id);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load navigation modes.");
    } finally {
      setModesPending(false);
    }
  }

  /** -------- user location -------- */
  const [userPos, setUserPos] = useState<UserPos | null>(null);
  const [locating, setLocating] = useState(false);

  function ensureCenter(lng: number, lat: number, minZoom = 16) {
    const map = mapRef.current?.getMap?.();
    const zoom = Math.max(viewState.zoom ?? 0, minZoom);
    if (map && mapReady) {
      map.flyTo({ center: [lng, lat], zoom, essential: true });
    } else {
      setViewState((vs) => ({
        ...vs,
        longitude: lng,
        latitude: lat,
        zoom,
        bearing: 0,
        pitch: 0,
      }));
    }
  }

  async function locateOnce() {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation not supported.");
      return;
    }
    if (!window.isSecureContext) {
      toast.error("Location requires HTTPS (or localhost).");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude, accuracy } = position.coords;
        setUserPos({ lng: longitude, lat: latitude, accuracy });
        ensureCenter(longitude, latitude, 16);
        setLocating(false);
      },
      (err) => {
        console.log(err.message);
        toast.error("Could not get your location.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  }

  /** -------- route from RouteNaviagate -------- */
  const [routeNodes, setRouteNodes] = useState<MarkerNode[]>([]);
  const [routePending, setRoutePending] = useState(false);

  const routeLineLayer = useMemo<LineLayerSpecification>(
    () => ({
      id: "route-line",
      type: "line",
      source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-width": 7,
        "line-color": "#ffd200",
        "line-opacity": 0.95,
        "line-blur": 0.2,
      },
    }),
    [],
  );

  const routeFC = useMemo<GeoJSONFeatureCollection | null>(() => {
    if (!routeNodes.length) return null;
    const coords = routeNodes.map((n) => [n.lng, n.lat] as [number, number]);
    if (coords.length < 2) return null;

    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: coords },
        },
      ],
    };
  }, [routeNodes]);

  const routeNodesFC = useMemo<GeoJSONFeatureCollection | null>(() => {
    if (!routeNodes.length) return null;
    return {
      type: "FeatureCollection",
      features: routeNodes.map((n, idx) => ({
        type: "Feature",
        properties: { idx },
        geometry: { type: "Point", coordinates: [n.lng, n.lat] },
      })),
    };
  }, [routeNodes]);

  const destPos = useMemo<LngLat | null>(() => {
    if (!routeNodes.length) return null;
    const last = routeNodes[routeNodes.length - 1];
    return { lng: last.lng, lat: last.lat };
  }, [routeNodes]);

  const accuracyGeoJSON = useMemo<GeoJSONFeatureCollection | null>(() => {
    if (!userPos?.accuracy) return null;
    return makeCircleGeoJSON(userPos.lng, userPos.lat, Math.max(userPos.accuracy, 5), 64);
  }, [userPos]);

  const accuracyFill = useMemo(
    () => ({
      id: "loc-accuracy-fill",
      type: "fill" as const,
      source: "loc-accuracy",
      paint: { "fill-color": "#3b82f6", "fill-opacity": 0.15 },
    }),
    [],
  );

  const accuracyLine = useMemo(
    () => ({
      id: "loc-accuracy-line",
      type: "line" as const,
      source: "loc-accuracy",
      paint: { "line-color": "#3b82f6", "line-width": 2, "line-opacity": 0.6 },
    }),
    [],
  );

  function fitToUserAndRoute() {
    const map = mapRef.current?.getMap?.();
    if (!map) return;

    const coords: Array<[number, number]> = [];
    if (userPos) coords.push([userPos.lng, userPos.lat]);
    for (const n of routeNodes) coords.push([n.lng, n.lat]);
    if (coords.length < 2) return;

    const lngs = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    const west = Math.min(...lngs);
    const east = Math.max(...lngs);
    const south = Math.min(...lats);
    const north = Math.max(...lats);

    const isMobile =
      typeof window !== "undefined"
        ? (window.matchMedia?.("(max-width: 768px)")?.matches ?? false)
        : false;

    const padding = isMobile
      ? { top: 90, right: 24, bottom: 120, left: 24 }
      : { top: 96, right: 420, bottom: 96, left: 32 };

    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding, maxZoom: 19, duration: 900, essential: true },
    );
  }

  async function refreshRoute() {
    if (!routeId) return;
    if (!userPos) return;
    if (!curNavMode) return;
    if (routePending) return;

    setRoutePending(true);
    try {
      // IMPORTANT: adjust param order if your client differs
      const resp: any = await RouteNavigate(
        routeId,
        userPos.lat,
        userPos.lng,
        String(curNavMode),
      );

      const raw = extractNodes(resp);
      const nodes = normalizeNodes(raw);

      if (nodes.length < 2) {
        setRouteNodes([]);
        toast.error("Route could not be built (no nodes returned).");
        return;
      }

      setRouteNodes(nodes);

      // camera
      setTimeout(() => fitToUserAndRoute(), 0);
    } catch (e) {
      console.error(e);
      setRouteNodes([]);
      toast.error("Failed to load route.");
    } finally {
      setRoutePending(false);
    }
  }

  /** -------- lifecycle -------- */
  useEffect(() => {
    if (!routeId) toast.error("Missing route id in URL.");
    void loadNavModes();
    void locateOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  // refresh when mode changes OR location appears
  useEffect(() => {
    void refreshRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curNavMode, userPos?.lat, userPos?.lng, routeId]);

  /** ---------------- Render ---------------- */
  return (
    <div className="relative h-screen w-full bg-background text-foreground">
      <Toaster position="top-right" reverseOrder />

      {/* Top bar */}
      <div className="absolute inset-x-2 top-3 z-30 md:left-1/2 md:w-[820px] md:-translate-x-1/2">
        <div
          className={[
            "rounded-[22px] border px-4 py-3 shadow-xl backdrop-blur",
            borderMutedClass,
            surfacePanelClass,
          ].join(" ")}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">
                Shareable Route
              </p>
              <p className="truncate text-sm font-semibold">
                Route ID: <span className="opacity-80">{routeId || "—"}</span>
              </p>
              <p className="mt-1 text-xs text-panel-muted-foreground">
                {routePending ? "Refreshing route…" : "Route loaded from your current location."}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                className={[
                  "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition",
                  borderMutedClass,
                  surfaceSubtleClass,
                  "hover:bg-panel",
                  "disabled:opacity-60",
                ].join(" ")}
                onClick={locateOnce}
                disabled={locating}
                title="Update your location"
              >
                {locating ? <Spinner /> : null}
                Locate me
              </button>

              <button
                className={[
                  "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition",
                  borderMutedClass,
                  surfaceSubtleClass,
                  "hover:bg-panel",
                  "disabled:opacity-60",
                ].join(" ")}
                onClick={refreshRoute}
                disabled={!userPos || !curNavMode || routePending}
                title="Refresh route"
              >
                {routePending ? <Spinner /> : null}
                Refresh
              </button>
            </div>
          </div>

          {/* Nav mode pills */}
          <div className="mt-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-panel-muted-foreground">
                Navigation mode
              </span>
              {modesPending ? (
                <span className="inline-flex items-center gap-2 text-[11px] text-panel-muted-foreground">
                  <Spinner className="h-3.5 w-3.5" />
                  Loading modes…
                </span>
              ) : null}
            </div>

            <div className="mt-2 -mx-1 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {navModes.map((mode) => {
                const active = String(mode.id) === String(curNavMode);
                return (
                  <button
                    key={String(mode.id)}
                    onClick={() => setCurNavMode(mode.id)}
                    disabled={routePending}
                    className={[
                      "shrink-0 rounded-[15px] px-4 py-1.5 text-xs font-semibold uppercase transition shadow-sm",
                      active
                        ? "bg-brand text-brand-foreground dark:bg-brand-accent dark:text-brand-accent-foreground"
                        : `border ${borderMutedClass} bg-panel-muted text-panel-muted-foreground hover:bg-panel`,
                      routePending && "opacity-60",
                    ].join(" ")}
                    title={active ? "Current mode" : "Switch mode"}
                  >
                    {mode.name}
                  </button>
                );
              })}

              {!modesPending && navModes.length === 0 && (
                <span className="px-2 text-[11px] text-panel-muted-foreground">
                  No nav modes available.
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="h-full w-full">
        <ReactMap
          ref={mapRef}
          {...viewState}
          onMove={(e: ViewStateChangeEvent) =>
            setViewState((prev) => ({ ...prev, ...e.viewState }))
          }
          mapStyle={mapStyleUrl}
          onLoad={() => setMapReady(true)}
        >
          {/* accuracy ring */}
          {accuracyGeoJSON && (
            <Source id="loc-accuracy" type="geojson" data={accuracyGeoJSON as any}>
              <Layer {...(accuracyFill as any)} />
              <Layer {...(accuracyLine as any)} />
            </Source>
          )}

          {/* route line */}
          {routeFC && (
            <Source id="route" type="geojson" data={routeFC as any}>
              <Layer {...routeLineLayer} />
            </Source>
          )}

          {/* route nodes (from RouteNaviagate) */}
          {routeNodesFC && (
            <Source id="route-nodes" type="geojson" data={routeNodesFC as any}>
              <Layer
                id="route-nodes-circle"
                type="circle"
                paint={{
                  "circle-radius": 6,
                  "circle-color": isDark ? "#60a5fa" : "#2563eb",
                  "circle-stroke-width": 2,
                  "circle-stroke-color": isDark ? "#041631" : "#ffffff",
                }}
              />
            </Source>
          )}

          {/* destination pulse = last node */}
          {destPos && (
            <Marker longitude={destPos.lng} latitude={destPos.lat} anchor="center">
              <div className="relative flex items-center justify-center">
                <div className="absolute h-8 w-8 rounded-full bg-red-600 opacity-40 animate-ping" />
                <div className="h-4 w-4 rounded-full border-2 border-red-700 bg-brand shadow-lg" />
              </div>
            </Marker>
          )}

          {/* user marker */}
          {userPos && (
            <Marker longitude={userPos.lng} latitude={userPos.lat} anchor="center">
              <div
                title={`You are here (${userPos.lat.toFixed(6)}, ${userPos.lng.toFixed(6)})`}
                className="h-3.5 w-3.5 rounded-full border-2 border-white bg-blue-600 shadow-lg ring-4 ring-blue-500/30 transition"
              />
            </Marker>
          )}
        </ReactMap>
      </div>

      {/* bottom-right status */}
      <div className="absolute z-30 right-3 bottom-6">
        <div
          className={[
            "rounded-2xl border px-3 py-2 text-xs shadow-xl backdrop-blur",
            borderMutedClass,
            surfacePanelClass,
          ].join(" ")}
        >
          <div className="flex items-center gap-2">
            {routePending ? <Spinner className="h-3.5 w-3.5" /> : null}
            <span className="text-panel-muted-foreground">
              {routePending
                ? "Building route…"
                : routeNodes.length
                  ? `${routeNodes.length} nodes`
                  : userPos
                    ? "No route yet"
                    : "Waiting for location"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

