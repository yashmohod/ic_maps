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

import maplibregl, { type LineLayerSpecification } from "maplibre-gl";

import { useAppTheme } from "@/hooks/use-app-theme";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";
import { getAllNavModes, RouteNavigate } from "@/lib/icmapsApi";
import { HomeLogoLink } from "@/components/home-logo-link";
import { ThemeToggleButton } from "@/components/theme-toggle-button";

// ✅ This is the KEY: load markers + edgeIndex the same way your working pages do
import NavModeMap from "@/components/NavMode"; // <-- adjust if your path differs

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

type MarkerNode = { id: string | number; lng: number; lat: number };
type EdgeIndexEntry = { key: string; from: string | number; to: string | number };

type GeoJSONFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, any>;
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

/** Extract path keys from many possible shapes:
 * - { path: [...] }
 * - { path: { path: [...] } }
 * - resp.path being array directly
 */
function extractPathKeys(resp: any): string[] {
  if (!resp) return [];

  // common shapes
  if (Array.isArray(resp?.path)) return resp.path.map(String);
  if (Array.isArray(resp)) return resp.map(String);

  // nested path object
  if (resp?.path && typeof resp.path === "object" && Array.isArray(resp.path.path)) {
    return resp.path.path.map(String);
  }

  // other possible fields
  const candidates = [
    resp.pathKeys,
    resp.path_keys,
    resp.edges,
    resp.routeEdges,
    resp.route_edges,
    resp.data?.path,
    resp.payload?.path,
  ];

  const found = candidates.find((x) => Array.isArray(x));
  return Array.isArray(found) ? found.map(String) : [];
}

function makeLookups(markersLocal: MarkerNode[], edgeIndexLocal: EdgeIndexEntry[]) {
  const nodesById = new Map<string, { lng: number; lat: number }>(
    markersLocal.map((m) => [String(m.id), { lng: m.lng, lat: m.lat }]),
  );

  const edgesByKey = new Map<string, { from: string; to: string }>(
    edgeIndexLocal.map((e) => [String(e.key), { from: String(e.from), to: String(e.to) }]),
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
      Math.sin(latRad) * Math.cos(d) + Math.cos(latRad) * Math.sin(d) * Math.cos(brng),
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
    const nextNode =
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
  const stylePath = isDark
    ? "/styles/osm-bright/style-local-dark.json"
    : "/styles/osm-bright/style-local-light.json";
  const { baseStyle } = usePmtilesStyle({ stylePath });
  const canRenderMap = !!baseStyle;

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

  /** -------- graph data (from NavModeMap) -------- */
  const [markers, setMarkers] = useState<MarkerNode[]>([]);
  const [edgeIndex, setEdgeIndex] = useState<EdgeIndexEntry[]>([]);

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
        "line-color": "#ffd200",
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

  /** Fetch path keys from backend */
  async function refreshRoute() {
    if (!routeIdRaw) return;
    if (!userPos) return;
    if (!curNavMode) return;
    if (routePending) return;

    setRoutePending(true);
    try {
      // allow either numeric or string ids
      const asNum = Number(routeIdRaw);
      const routeIdForApi: any = Number.isFinite(asNum) ? asNum : routeIdRaw;

      const resp: any = await (RouteNavigate as any)(
        routeIdForApi,
        userPos.lat,
        userPos.lng,
        Number(curNavMode),
      );

      console.log("RouteNavigate resp:", resp);

      const keys = extractPathKeys(resp);
      if (!keys.length) {
        setPathKeys([]);
        setPathSet(new Set());
        setRouteFC(null);
        setDestPos(null);
        toast.error("No path returned for that share route.");
        return;
      }

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
      console.warn("No segments could be resolved from pathKeys", { pathKeys });
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

  /** lifecycle */
  useEffect(() => {
    if (!routeIdRaw) toast.error("Missing route id in URL.");
    void loadNavModes();
    void locateOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeIdRaw]);

  // refresh route when mode/location ready
  useEffect(() => {
    void refreshRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curNavMode, userPos?.lat, userPos?.lng, routeIdRaw]);
  const emptyPath = useMemo(() => new Set<string>(), []);
  /** UI */
  return (
    <div className="relative h-screen w-full bg-background text-foreground">
      <Toaster position="top-right" reverseOrder />

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
                Route ID: <span className="opacity-80">{routeIdRaw || "—"}</span>
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
            {/* Pass empty path so NavModeMap doesn't draw cyan highlights (we draw the yellow route ourselves) */}
            <NavModeMap
              path={emptyPath}
              navMode={curNavMode}
              markers={markers}
              setMarkers={setMarkers}
              edgeIndex={edgeIndex}
              setEdgeIndex={setEdgeIndex}
            />

            {/* accuracy ring */}
            {accuracyGeoJSON && (
              <Source id="loc-accuracy" type="geojson" data={accuracyGeoJSON as any}>
                <Layer {...(accuracyFill as any)} />
                <Layer {...(accuracyLine as any)} />
              </Source>
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
