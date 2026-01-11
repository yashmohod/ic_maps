// src/app/NavigationMapBlueLight.tsx
"use client";

import React, { useRef, useState, useMemo, useEffect, type JSX } from "react";
import {
  Map as ReactMap,
  Source,
  Layer,
  Marker,
  type MapRef,
} from "@vis.gl/react-maplibre";
import toast, { Toaster } from "react-hot-toast";
import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl, { type LineLayerSpecification } from "maplibre-gl";

import { useAppTheme } from "@/hooks/use-app-theme";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";
import { getNearestBlueLightPath } from "@/lib/icmapsApi";
import NavModeMap from "../../components/NavMode";

/** ---------------- Types ---------------- */

type LngLat = { lng: number; lat: number };

type UserPos = {
  lng: number;
  lat: number;
  accuracy?: number;
  heading?: number | null;
};

type MarkerNode = { id: string | number; lng: number; lat: number };

type EdgeIndexEntry = {
  key: string;
  from: string | number;
  to: string | number;
};

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

export default function NavigationMapBlueLight(): JSX.Element {
  const defViewState = {
    longitude: -76.494131,
    latitude: 42.422108,
    zoom: 15.5,
    bearing: 0,
    pitch: 0,
  };

  const [viewState, setViewState] = useState(defViewState);

  const topLeftBoundary = { lng: -76.505098, lat: 42.427959 };
  const bottomRightBoundary = { lng: -76.483915, lat: 42.410851 };

  const [userPos, setUserPos] = useState<UserPos | null>(null);
  const [destPos, setDestPos] = useState<LngLat | null>(null);

  const [tracking, setTracking] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const [markers, setMarkers] = useState<MarkerNode[]>([]);
  const [edgeIndex, setEdgeIndex] = useState<EdgeIndexEntry[]>([]);
  const [path, setPath] = useState<Set<string>>(new Set());

  const [routeFC, setRouteFC] = useState<GeoJSONFeatureCollection | null>(null);
  const [lastGeoMsg, setLastGeoMsg] = useState("");

  const mapRef = useRef<MapRef | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const deviceHeadingRef = useRef<number | null>(null);
  const routeCoordsRef = useRef<Array<[number, number]>>([]);

  const { isDark } = useAppTheme();
  const stylePath = isDark
    ? "/styles/osm-bright/style-local-dark.json"
    : "/styles/osm-bright/style-local-light.json";
  const { baseStyle } = usePmtilesStyle({ stylePath });
  const canRenderMap = !!baseStyle;

  const surfacePanelClass = "bg-panel text-panel-foreground";
  const borderMutedClass = "border-border";

  /** -------- Accuracy ring -------- */

  const accuracyGeoJSON = useMemo<GeoJSONFeatureCollection | null>(() => {
    if (!userPos?.accuracy) return null;
    return makeCircleGeoJSON(
      userPos.lng,
      userPos.lat,
      Math.max(userPos.accuracy, 5),
      64
    );
  }, [userPos]);

  const accuracyFill = useMemo(
    () => ({
      id: "loc-accuracy-fill",
      type: "fill" as const,
      source: "loc-accuracy",
      paint: { "fill-color": "#3b82f6", "fill-opacity": 0.15 },
    }),
    []
  );

  const accuracyLine = useMemo(
    () => ({
      id: "loc-accuracy-line",
      type: "line" as const,
      source: "loc-accuracy",
      paint: { "line-color": "#3b82f6", "line-width": 2, "line-opacity": 0.6 },
    }),
    []
  );

  /** -------- Camera helpers -------- */

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

  async function diagEnv() {
    console.log(
      "[geo] secure:",
      window.isSecureContext,
      "UA:",
      navigator.userAgent
    );
    try {
      if (navigator.permissions?.query) {
        const p = await navigator.permissions.query({
          name: "geolocation" as PermissionName,
        });
        console.log("[geo] permission.state:", p.state);
      }
    } catch (e) {
      console.log("[geo] permissions.query failed:", e);
    }
  }

  const [useCompass, setUseCompass] = useState(false);

  async function enableCompass() {
    try {
      const DOE: any = DeviceOrientationEvent;
      if (
        typeof DOE !== "undefined" &&
        typeof DOE.requestPermission === "function"
      ) {
        const res: "granted" | "denied" = await DOE.requestPermission();
        if (res !== "granted") return toast.error("Compass permission denied");
      }

      const handler = (
        e: DeviceOrientationEvent & { webkitCompassHeading?: number }
      ) => {
        const heading =
          typeof e.webkitCompassHeading === "number"
            ? e.webkitCompassHeading
            : typeof e.alpha === "number"
            ? 360 - e.alpha
            : null;

        if (heading != null && !Number.isNaN(heading)) {
          deviceHeadingRef.current = (heading + 360) % 360;
        }
      };

      window.addEventListener("deviceorientationabsolute", handler, true);
      window.addEventListener("deviceorientation", handler, true);
      setUseCompass(true);
    } catch {
      toast.error("Compass not available");
    }
  }

  function disableCompass() {
    setUseCompass(false);
    deviceHeadingRef.current = null;
  }

  async function locateOnceRobust(forceCenter = false) {
    await diagEnv();

    if (forceCenter && userPos) ensureCenter(userPos.lng, userPos.lat, 16);

    if (!("geolocation" in navigator)) {
      const msg = "Geolocation not supported";
      setLastGeoMsg(msg);
      alert(msg);
      return;
    }
    if (!window.isSecureContext) {
      const msg = "Location requires HTTPS (or localhost)";
      setLastGeoMsg(msg);
      alert(msg);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude, accuracy } = position.coords;

        const insideCampus =
          latitude < topLeftBoundary.lat &&
          latitude > bottomRightBoundary.lat &&
          longitude < bottomRightBoundary.lng &&
          longitude > topLeftBoundary.lng;

        if (insideCampus) {
          setUserPos({ lng: longitude, lat: latitude, accuracy });
          ensureCenter(longitude, latitude, 16);
          void getBlueLightPath(latitude, longitude);
        }
      },
      (err) => console.log(err.message),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  }

  /** -------- Lookups -------- */

  function makeLookups(
    markersLocal: MarkerNode[],
    edgeIndexLocal: EdgeIndexEntry[]
  ) {
    const nodesById = new Map<string, { lng: number; lat: number }>(
      markersLocal.map((m) => [String(m.id), { lng: m.lng, lat: m.lat }])
    );
    const edgesByKey = new Map<string, { from: string; to: string }>(
      edgeIndexLocal.map((e) => [
        String(e.key),
        { from: String(e.from), to: String(e.to) },
      ])
    );
    return { nodesById, edgesByKey };
  }

  /** -------- Bearing helpers -------- */

  const toRadLocal = (d: number) => (d * Math.PI) / 180;
  const toDegLocal = (r: number) => (r * 180) / Math.PI;
  const normBearing = (b: number) => ((b % 360) + 360) % 360;

  function bearingTo(lng1: number, lat1: number, lng2: number, lat2: number) {
    const φ1 = toRadLocal(lat1),
      φ2 = toRadLocal(lat2);
    const λ1 = toRadLocal(lng1),
      λ2 = toRadLocal(lng2);
    const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
    const x =
      Math.cos(φ1) * Math.sin(φ2) -
      Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
    return normBearing(toDegLocal(Math.atan2(y, x)));
  }

  function aimCamera(
    map: any,
    lng: number,
    lat: number,
    bearingDeg: number,
    {
      zoom = 16,
      pitch = 60,
      duration = 400,
    }: { zoom?: number; pitch?: number; duration?: number } = {}
  ) {
    if (!map) return;
    map.easeTo({
      center: [lng, lat],
      zoom,
      bearing: bearingDeg ?? 0,
      pitch,
      duration,
      essential: true,
    });
    setViewState((v) => ({
      ...v,
      longitude: lng,
      latitude: lat,
      zoom,
      bearing: bearingDeg ?? 0,
      pitch,
    }));
  }

  /** -------- Route line style (typed) -------- */

  const routeLineLayer = useMemo<LineLayerSpecification>(
    () => ({
      id: "route-line",
      type: "line",
      source: "route",
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-width": 7,
        "line-color": "#ffd200",
        "line-opacity": 0.95,
        "line-blur": 0.2,
      },
    }),
    []
  );

  /** -------- BlueLight route building -------- */

  const [blDest, setBLDest] = useState<string>("");

  useEffect(() => {
    if (!path || path.size === 0) {
      setRouteFC(null);
      setDestPos(null);
      routeCoordsRef.current = [];
      return;
    }
    if (!markers.length || !edgeIndex.length) return;

    const pathKeys = Array.from(path);
    const { nodesById, edgesByKey } = makeLookups(markers, edgeIndex);

    // Destination node
    const blNode = nodesById.get(String(blDest));
    if (blNode && Number.isFinite(blNode.lng) && Number.isFinite(blNode.lat)) {
      setDestPos({ lng: blNode.lng, lat: blNode.lat });
    } else {
      setDestPos(null);
    }

    // One segment per edge (discontinuous supported)
    const segments: Array<Array<[number, number]>> = [];
    for (const key of pathKeys) {
      const edge = edgesByKey.get(String(key));
      if (!edge) continue;

      const from = nodesById.get(edge.from);
      const to = nodesById.get(edge.to);
      if (!from || !to) continue;

      segments.push([
        [from.lng, from.lat],
        [to.lng, to.lat],
      ]);
    }

    if (segments.length === 0) {
      setRouteFC(null);
      routeCoordsRef.current = [];
      return;
    }

    // Choose longest segment for camera bearing
    let longestSegment = segments[0];
    let longestLen = -Infinity;
    for (const seg of segments) {
      const [a, b] = seg;
      const dx = a[0] - b[0];
      const dy = a[1] - b[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > longestLen) {
        longestLen = len;
        longestSegment = seg;
      }
    }
    routeCoordsRef.current = longestSegment;

    setRouteFC({
      type: "FeatureCollection",
      features: segments.map((coords) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: coords },
      })),
    });
  }, [path, markers, edgeIndex, blDest]);

  /** -------- Tracking -------- */

  async function startTracking() {
    if (!userPos) {
      toast.error("Location is required to start the emergency route.");
      return;
    }

    const coords = routeCoordsRef.current;
    if (!coords || coords.length < 2) {
      toast.error("Route is still loading. Please wait a moment.");
      return;
    }

    const [lng1, lat1] = [userPos.lng, userPos.lat];
    const [lng2, lat2] = coords[1];

    const forward =
      typeof userPos.heading === "number"
        ? userPos.heading
        : bearingTo(lng1, lat1, lng2, lat2);

    aimCamera(mapRef.current?.getMap?.(), lng1, lat1, forward, {
      pitch: 60,
      duration: 600,
      zoom: 18,
    });

    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { longitude, latitude, heading } = pos.coords;

        setUserPos((up) =>
          up
            ? { ...up, lng: longitude, lat: latitude, heading }
            : { lng: longitude, lat: latitude, heading }
        );

        let brg = 0;
        if (typeof heading === "number" && !Number.isNaN(heading)) {
          brg = heading;
        } else if (routeCoordsRef.current.length >= 2) {
          const [nx, ny] = routeCoordsRef.current[1];
          brg = bearingTo(longitude, latitude, nx, ny);
        }

        aimCamera(mapRef.current?.getMap?.(), longitude, latitude, brg, {
          pitch: 60,
          duration: 300,
          zoom: 18,
        });
      },
      (err) => {
        console.log("watchPosition error:", err);
        toast.error(err.message || "Tracking error");
        stopTracking();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 1000 }
    );

    watchIdRef.current = id;
    setTracking(true);
    setNavigating(true);
  }

  function stopTracking() {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    setViewState(defViewState);
    routeCoordsRef.current = [];
    setRouteFC(null);
    setDestPos(null);

    setPath(new Set());
    setNavigating(false);
    setTracking(false);
    disableCompass();
    void locateOnceRobust(false);
  }

  /** -------- Backend call -------- */

  async function getBlueLightPath(lat: number, lng: number) {
    try {
      const resp: any = await getNearestBlueLightPath(lat, lng);
      const pathArr: unknown = resp?.path;
      const dest: unknown = resp?.dest;

      const keys = Array.isArray(pathArr) ? pathArr.map(String) : [];
      console.log(keys);
      setPath(new Set(keys));
      setBLDest(dest != null ? String(dest) : "");
    } catch (e) {
      console.error("blue light path failed", e);
      toast.error("Failed to load blue light route.");
      setPath(new Set());
      setBLDest("");
    }
  }

  /** -------- Lifecycle -------- */

  useEffect(() => {
    void locateOnceRobust(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null)
        navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  // empty path passed to NavModeMap so it never draws cyan highlights
  const emptyPath = useMemo(() => new Set<string>(), []);

  /** ---------------- Render ---------------- */

  return (
    <div className="relative h-screen w-full bg-background text-foreground">
      <Toaster position="top-right" reverseOrder />

      {/* Top brand bar */}
      <div className="absolute inset-x-2 top-3 z-30 md:left-1/2 md:w-[720px] md:-translate-x-1/2">
        <div className="flex w-full items-stretch gap-2">
          <div
            className={`flex flex-[1] items-center justify-center rounded-[25px] border ${borderMutedClass} ${surfacePanelClass} px-2 py-1 shadow-xl backdrop-blur
              transition transform hover:scale-[1.03] active:scale-95`}
          >
            <img
              src="/assets/ic_logo_up.png"
              alt="Ithaca College logo"
              className="max-h-10 dark:hidden"
            />
            <img
              src="/assets/ic_logo_up_dark.png"
              alt="Ithaca College logo"
              className="hidden max-h-10 dark:block"
            />
          </div>

          <div
            className={`flex flex-[10] items-center justify-center-safe rounded-[22px] border ${borderMutedClass} ${surfacePanelClass} px-4 py-2 shadow-xl backdrop-blur`}
          >
            <div className="flex w-full items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-600">
                  Emergency
                </p>
                <p className="text-sm font-semibold text-panel-foreground">
                  Blue Light Safety Route
                </p>
              </div>
              <span className="inline-flex items-center rounded-full bg-rose-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-rose-700 border border-rose-100">
                Live Route
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Start/Stop tracking button */}
      <div className="absolute z-30 right-3 bottom-[calc(env(safe-area-inset-bottom,0)+24px)] md:bottom-6 flex flex-col gap-2">
        {!tracking ? (
          <button
            className="rounded-full bg-destructive px-5 py-3 text-sm font-semibold text-white shadow-xl transition hover:bg-destructive/90"
            onClick={startTracking}
            title="Start emergency route to nearest blue light"
          >
            Start Emergency Route
          </button>
        ) : (
          <button
            className="rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-xl transition hover:bg-primary/90"
            onClick={stopTracking}
            title="Stop emergency route"
          >
            Stop Route
          </button>
        )}
      </div>

      {/* Map wrapper owns the sizing className (Map component typings don't include className) */}
      <div className="h-full w-full">
        {!canRenderMap ? (
          <div className="h-full w-full grid place-items-center text-sm opacity-70">
            Loading basemap...
          </div>
        ) : (
          <ReactMap
            ref={mapRef}
            {...viewState}
            onMove={(e: any) =>
              setViewState((prev) => ({ ...prev, ...e.viewState }))
            }
            mapLib={maplibregl}
            mapStyle={baseStyle as any}
            onLoad={() => setMapReady(true)}
          >
            <NavModeMap
              path={emptyPath}
              navMode={1}
              markers={markers}
              setMarkers={setMarkers}
              edgeIndex={edgeIndex}
              setEdgeIndex={setEdgeIndex}
            />

            {accuracyGeoJSON && (
              <Source
                id="loc-accuracy"
                type="geojson"
                data={accuracyGeoJSON as any}
              >
                <Layer {...(accuracyFill as any)} />
                <Layer {...(accuracyLine as any)} />
              </Source>
            )}

            {routeFC && (
              <Source id="route" type="geojson" data={routeFC as any}>
                <Layer {...routeLineLayer} />
              </Source>
            )}

            {destPos &&
              Number.isFinite(destPos.lng) &&
              Number.isFinite(destPos.lat) && (
                <Marker
                  longitude={destPos.lng}
                  latitude={destPos.lat}
                  anchor="center"
                >
                  <div className="relative flex items-center justify-center">
                    <div className="absolute h-8 w-8 rounded-full bg-red-600 opacity-40 animate-ping" />
                    <div
                      className="h-4 w-4 rounded-full border-2 border-red-700 bg-brand shadow-lg"
                    />
                  </div>
                </Marker>
              )}

            {userPos && (
              <Marker
                longitude={userPos.lng}
                latitude={userPos.lat}
                anchor="center"
              >
                <div
                  title={`You are here (${userPos.lat.toFixed(
                    6
                  )}, ${userPos.lng.toFixed(6)})`}
                  className="h-3.5 w-3.5 rounded-full border-2 border-white bg-blue-600 shadow-lg ring-4 ring-blue-500/30 transition"
                />
              </Marker>
            )}
          </ReactMap>
        )}
      </div>
    </div>
  );
}

/** ---------------- Geometry helpers (typed) ---------------- */

function makeCircleGeoJSON(
  lng: number,
  lat: number,
  radiusMeters: number,
  points = 64
): GeoJSONFeatureCollection {
  const coords: Array<[number, number]> = [];
  const d = radiusMeters / 6378137;
  const [lon, latRad] = [toRad(lng), toRad(lat)];

  for (let i = 0; i <= points; i++) {
    const brng = (i * 2 * Math.PI) / points;
    const lat2 = Math.asin(
      Math.sin(latRad) * Math.cos(d) +
        Math.cos(latRad) * Math.sin(d) * Math.cos(brng)
    );
    const lon2 =
      lon +
      Math.atan2(
        Math.sin(brng) * Math.sin(d) * Math.cos(latRad),
        Math.cos(d) - Math.sin(latRad) * Math.sin(lat2)
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
