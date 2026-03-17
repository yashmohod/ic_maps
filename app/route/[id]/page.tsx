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
import { toast } from "sonner";
import { useParams } from "next/navigation";

import maplibregl, { type LineLayerSpecification } from "maplibre-gl";

import { useMapStyle } from "@/hooks/use-map-style";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/map-constants";
import { HomeLogoLink } from "@/components/home-logo-link";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import { Spinner } from "@/components/ui/spinner";
import type { NavConditions } from "@/lib/navigation";
import apiClient from "@/lib/apiClient";
import { makeCircleGeoJSON } from "@/lib/geo";
import {
  surfacePanelClass,
  surfaceSubtleClass,
  borderMutedClass,
} from "@/lib/panel-classes";
import type {
  LngLat,
  UserPos,
  SimpleMarkerNode,
  GeoJSONFeatureCollection,
} from "@/lib/types/map";

import NavModeMap from "@/components/NavMode";
import { AccuracyRingLayer } from "@/components/AccuracyRingLayer";

type MarkerNode = SimpleMarkerNode;
type RouteEdgeEntry = { id: string; from: string | number; to: string | number };

/** Extract path (edge IDs) from navigateTo response */
function extractPath(resp: { path?: unknown }): number[] {
  if (!resp?.path || !Array.isArray(resp.path)) return [];
  return resp.path.filter((x): x is number => typeof x === "number");
}

function makeLookups(markersLocal: MarkerNode[], edgeIndexLocal: RouteEdgeEntry[]) {
  const nodesById = new Map<string, { lng: number; lat: number }>(
    markersLocal.map((m) => [String(m.id), { lng: m.lng, lat: m.lat }]),
  );

  const edgesByKey = new Map<string, { from: string; to: string }>(
    edgeIndexLocal.map((e) => [String(e.id), { from: String(e.from), to: String(e.to) }]),
  );

  return { nodesById, edgesByKey };
}

/** Fallback: if key is literally "nodeA__nodeB" and not present in edgeIndex */
function parseEdgeKeyFallback(key: string): { from: string; to: string } | null {
  if (!key || typeof key !== "string") return null;
  const parts = key.split("__");
  if (parts.length !== 2) return null;
  const from = parts[0]?.trim();
  const to = parts[1]?.trim();
  if (!from || !to) return null;
  return { from, to };
}

/** Order node ids from edges (same style as your NavigationMap helper) */
function orderNodeIdsFromEdges(edges: Array<{ from: string; to: string }>): string[] {
  const adj = new Map<string, Set<string>>();
  const add = (u: string, v: string) => {
    if (!adj.has(u)) adj.set(u, new Set());
    if (!adj.has(v)) adj.set(v, new Set());
    adj.get(u)!.add(v);
    adj.get(v)!.add(u);
  };

  for (const e of edges) add(e.from, e.to);
  if (adj.size === 0) return [];

  const endpoints = [...adj.entries()].filter(([, s]) => s.size === 1).map(([id]) => id);
  const start = endpoints[0] ?? [...adj.keys()][0];

  const ordered: string[] = [];
  const visited = new Set<string>();
  let cur: string | null = start;
  let prev: string | null = null;

  while (cur != null) {
    ordered.push(cur);
    visited.add(cur);
    const nextNode: string | null =
      [...(adj.get(cur) ?? [])].find((n) => n !== prev && !visited.has(n)) ?? null;
    prev = cur;
    cur = nextNode;
  }

  return ordered;
}

export default function ShareRouteNavigatePage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const routeIdRaw = params?.id ?? "";

  const defViewState = useMemo(
    () => ({
      longitude: DEFAULT_CENTER.lng,
      latitude: DEFAULT_CENTER.lat,
      zoom: DEFAULT_ZOOM,
      bearing: 0,
      pitch: 0,
    }),
    [],
  );

  const [viewState, setViewState] = useState<{
    longitude: number;
    latitude: number;
    zoom: number;
    bearing: number;
    pitch: number;
  }>(defViewState);
  const mapRef = useRef<MapRef | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const { isDark, mapStyle } = useMapStyle();
  const { baseStyle } = usePmtilesStyle({ stylePath: mapStyle });
  const canRenderMap = !!baseStyle;


  /** Route from shareable link: GET /api/shareableroute?id=... */
  type RouteInfo = { name: string; destinationId: number } | null;
  const [routeInfo, setRouteInfo] = useState<RouteInfo>(null);
  const [routeLoadPending, setRouteLoadPending] = useState(true);

  /** Nav conditions for navigateTo (single-destination routing) */
  const [curNavConditions, setCurNavConditions] = useState<NavConditions>({
    is_pedestrian: true,
    is_vehicular: false,
    is_through_building: true,
    is_avoid_stairs: false,
    is_incline_limit: false,
    max_incline: 0,
  });

  /** Load shareable route by id to get first destination */
  async function loadRoute() {
    if (!routeIdRaw) {
      setRouteLoadPending(false);
      return;
    }
    setRouteLoadPending(true);
    try {
      const res = await fetch(
        `/api/shareableroute?id=${encodeURIComponent(routeIdRaw)}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? "Route not found.");
        setRouteInfo(null);
        return;
      }
      const firstDest = data.destinations?.[0];
      if (!firstDest?.id) {
        toast.error("This route has no destination.");
        setRouteInfo(null);
        return;
      }
      setRouteInfo({
        name: data.name ?? "Route",
        destinationId: Number(firstDest.id),
      });
    } catch (e) {
      console.error(e);
      toast.error("Failed to load route.");
      setRouteInfo(null);
    } finally {
      setRouteLoadPending(false);
    }
  }

  /** Load graph (nodes + edges) from GET /api/map/all */
  const [graphLoaded, setGraphLoaded] = useState(false);
  async function loadGraph() {
    try {
      const res = await apiClient.get("/api/map/all");
      if (res.status !== 200) {
        toast.error("Failed to load map data.");
        return;
      }
      const data = await res.json();
      const nodes = data.nodes ?? [];
      const edges = (data.edges ?? []).map(
        (e: { id: number; from: number; to: number }) => ({
          id: String(e.id),
          from: e.from,
          to: e.to,
        }),
      );
      setMarkers(nodes);
      setEdgeIndex(edges);
      setGraphLoaded(true);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load map data.");
    }
  }

  /** -------- nav modes (simplified: pedestrian / vehicular toggle) -------- */
  const navModeOptions = useMemo(
    () => [
      { id: "pedestrian", label: "Pedestrian", conditions: { is_pedestrian: true, is_vehicular: false } as const },
      { id: "vehicular", label: "Vehicular", conditions: { is_pedestrian: false, is_vehicular: true } as const },
    ],
    [],
  );

  /** -------- (removed legacy nav modes / getAllNavModes) -------- */
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
        toast.error("Could not get your location.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  }

  /** -------- graph data (from NavModeMap) -------- */
  const [markers, setMarkers] = useState<MarkerNode[]>([]);
  const [edgeIndex, setEdgeIndex] = useState<RouteEdgeEntry[]>([]);

  /** -------- route state -------- */
  const [routePending, setRoutePending] = useState(false);
  const [pathKeys, setPathKeys] = useState<string[]>([]);
  const [pathSet, setPathSet] = useState<Set<string>>(new Set());

  const [routeFC, setRouteFC] = useState<GeoJSONFeatureCollection | null>(null);
  const [destPos, setDestPos] = useState<LngLat | null>(null);

  const routeLineLayer = useMemo<LineLayerSpecification>(
    () => ({
      id: "route-line",
      type: "line",
      source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-width": 7,
        "line-color": "#35D5A4",
        "line-opacity": 0.95,
        "line-blur": 0.2,
      },
    }),
    [],
  );

  const accuracyGeoJSON = useMemo<GeoJSONFeatureCollection | null>(() => {
    if (!userPos?.accuracy) return null;
    return makeCircleGeoJSON(userPos.lng, userPos.lat, Math.max(userPos.accuracy, 5), 64);
  }, [userPos]);

  function fitToUserAndRoute(coords: Array<[number, number]>) {
    const map = mapRef.current?.getMap?.();
    if (!map) return;
    if (!coords?.length) return;

    const all: Array<[number, number]> = [];
    if (userPos) all.push([userPos.lng, userPos.lat]);
    all.push(...coords);

    if (all.length < 2) return;

    const lngs = all.map((c) => c[0]);
    const lats = all.map((c) => c[1]);
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

  /** Fetch path from our API (user -> route's first destination) */
  async function refreshRoute() {
    if (!routeIdRaw) return;
    if (!userPos) return;
    if (!routeInfo?.destinationId) return;
    if (routePending) return;

    setRoutePending(true);
    try {
      const res = await apiClient.post("/api/map/navigateTo", {
        destId: routeInfo.destinationId,
        lat: userPos.lat,
        lng: userPos.lng,
        navConditions: curNavConditions,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPathKeys([]);
        setPathSet(new Set());
        setRouteFC(null);
        setDestPos(null);
        toast.error(data?.error ?? "No path returned.");
        return;
      }

      const path = extractPath(data);
      if (!path.length) {
        setPathKeys([]);
        setPathSet(new Set());
        setRouteFC(null);
        setDestPos(null);
        toast.error("No path returned for that route.");
        return;
      }

      const keys = path.map(String);
      setPathKeys(keys);
      setPathSet(new Set(keys));
    } catch (e) {
      console.error(e);
      setPathKeys([]);
      setPathSet(new Set());
      setRouteFC(null);
      setDestPos(null);
      toast.error("Failed to load route.");
    } finally {
      setRoutePending(false);
    }
  }

  /** Build GeoJSON using markers+edgeIndex (exactly like your BlueLight page) */
  useEffect(() => {
    if (!pathKeys.length) {
      setRouteFC(null);
      setDestPos(null);
      return;
    }
    if (!markers.length || !edgeIndex.length) {
      // wait until NavModeMap loads graph
      return;
    }

    const { nodesById, edgesByKey } = makeLookups(markers, edgeIndex);

    const resolvedEdges: Array<{ from: string; to: string }> = [];
    const segments: Array<Array<[number, number]>> = [];

    for (const key of pathKeys) {
      const edge =
        edgesByKey.get(String(key)) ??
        parseEdgeKeyFallback(String(key)); // fallback for "n1__n2" form

      if (!edge) continue;

      const from = nodesById.get(edge.from);
      const to = nodesById.get(edge.to);
      if (!from || !to) continue;

      resolvedEdges.push({ from: edge.from, to: edge.to });
      segments.push([
        [from.lng, from.lat],
        [to.lng, to.lat],
      ]);
    }

    if (!segments.length) {
      setRouteFC(null);
      setDestPos(null);
      toast.error("Path edges did not match any loaded graph edges for this nav mode.");
      return;
    }

    // destination marker: try to order the nodes, else just use last segment end
    const orderedNodeIds = orderNodeIdsFromEdges(resolvedEdges);
    const lastId = orderedNodeIds[orderedNodeIds.length - 1];

    if (lastId) {
      const p = nodesById.get(String(lastId));
      if (p) setDestPos({ lng: p.lng, lat: p.lat });
      else setDestPos(null);
    } else {
      const lastSeg = segments[segments.length - 1];
      const end = lastSeg?.[1];
      setDestPos(end ? { lng: end[0], lat: end[1] } : null);
    }

    setRouteFC({
      type: "FeatureCollection",
      features: segments.map((coords) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: coords },
      })),
    });

    // fit bounds using ALL segment coords
    const allCoords: Array<[number, number]> = [];
    for (const seg of segments) {
      allCoords.push(seg[0], seg[1]);
    }
    setTimeout(() => fitToUserAndRoute(allCoords), 0);
  }, [pathKeys, markers, edgeIndex, userPos?.lat, userPos?.lng]);

  /** lifecycle: load route and graph on mount */
  useEffect(() => {
    if (!routeIdRaw) {
      toast.error("Missing route id in URL.");
      setRouteLoadPending(false);
      return;
    }
    void loadRoute();
    void loadGraph();
    void locateOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeIdRaw]);

  /** Refresh route when destination, location, or nav conditions change */
  useEffect(() => {
    if (!routeInfo?.destinationId || !userPos || !graphLoaded) return;
    void refreshRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeInfo?.destinationId, userPos?.lat, userPos?.lng, curNavConditions, graphLoaded]);

  const emptyPath = useMemo(
    () => ({ path: new Set<number>(), firstNodeId: -1, lastNodeId: -1 }),
    [],
  );
  /** UI */
  return (
    <div className="relative h-screen w-full bg-background text-foreground">
      <div className="absolute left-3 top-20 z-40 flex items-center gap-2 md:top-3">
        <HomeLogoLink className="h-12 px-3 py-2 shadow-xl backdrop-blur" />
        <ThemeToggleButton className="h-12 w-12 shadow-xl backdrop-blur" />
      </div>

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
                {routeLoadPending
                  ? "Loading…"
                  : routeInfo
                    ? routeInfo.name
                    : `Route ID: ${routeIdRaw || "—"}`}
              </p>
              <p className="mt-1 text-xs text-panel-muted-foreground">
                {routePending
                  ? "Refreshing route…"
                  : routeInfo
                    ? "Route to destination from your current location."
                    : "Load a route to see directions."}
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
                aria-label="Locate me"
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
                disabled={!userPos || !routeInfo?.destinationId || routePending}
                title="Refresh route"
                aria-label="Refresh route"
              >
                {routePending ? <Spinner /> : null}
                Refresh
              </button>
            </div>
          </div>

          {/* Nav mode: Pedestrian / Vehicular */}
          <div className="mt-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-panel-muted-foreground">
              Mode
            </span>
            <div className="mt-2 -mx-1 flex gap-2">
              {navModeOptions.map((opt) => {
                const active =
                  (opt.id === "pedestrian" && curNavConditions.is_pedestrian) ||
                  (opt.id === "vehicular" && curNavConditions.is_vehicular);
                return (
                  <button
                    key={opt.id}
                    onClick={() =>
                      setCurNavConditions((prev) => ({
                        ...prev,
                        ...opt.conditions,
                      }))
                    }
                    disabled={routePending}
                    className={[
                      "shrink-0 rounded-[15px] px-4 py-1.5 text-xs font-semibold uppercase transition",
                      active
                        ? "bg-brand-cta text-brand-cta-foreground"
                        : `border ${borderMutedClass} bg-panel-muted text-panel-muted-foreground hover:bg-panel`,
                      routePending && "opacity-60",
                    ].join(" ")}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="h-full w-full">
        {!canRenderMap ? (
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
          >
            {/* ✅ Load the graph (markers + edgeIndex) exactly like your working pages */}
            {/* Pass empty path so NavModeMap doesn't draw cyan highlights (we draw the teal route ourselves) */}
            <NavModeMap
              path={emptyPath}
              curNavConditions={curNavConditions}
              markers={markers}
              edgeIndex={edgeIndex}
            />

            {/* accuracy ring */}
            {accuracyGeoJSON && (
              <AccuracyRingLayer data={accuracyGeoJSON} isDark={isDark} />
            )}

            {/* route line (segments FC) */}
            {routeFC && (
              <Source id="route" type="geojson" data={routeFC as any}>
                <Layer {...routeLineLayer} />
              </Source>
            )}

            {/* destination pulse */}
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
        )}
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
                : pathKeys.length
                  ? `${pathKeys.length} edges`
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
