"use client";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import Image from "next/image";
import React, { useRef, useState, useMemo, useEffect, type JSX } from "react";
import {
  Map as ReactMap,
  Source,
  Layer,
  Marker,
  type MapRef,
  type ViewStateChangeEvent,
} from "@vis.gl/react-maplibre";
import toast, { Toaster } from "react-hot-toast";
import "maplibre-gl/dist/maplibre-gl.css";
import { useAppTheme } from "@/hooks/use-app-theme";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";
import {
  getAllBuildings,
  getAllNavModes,
  getRouteTo,
  getBuildingPos,
} from "@/lib/icmapsApi";

import {
  IconNavigation,
  IconNavigationX,
  IconArrowGuide,
  IconArrowBadgeUpFilled,
  IconArrowBadgeDownFilled,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconLogin2,
} from "@tabler/icons-react";
import ProfileOptions from "../components/profileOptions";
import NavModeMap from "../components/NavMode";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { authClient, type Session } from "@/lib/auth-client";

import maplibregl from "maplibre-gl";

/** ---------------- Types ---------------- */

type LngLat = { lng: number; lat: number };

type UserPos = {
  lng: number;
  lat: number;
  accuracy?: number;
  heading?: number | null;
};

type Building = {
  id: string | number;
  name: string;
  lat?: number;
  lng?: number;
  description?: string;
  polyGon?: string;
};

type NavMode = {
  id: string | number;
  name: string;
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
    properties: Record<string, any>;
    geometry:
    | { type: "Point"; coordinates: [number, number] }
    | { type: "LineString"; coordinates: [number, number][] }
    | { type: "Polygon"; coordinates: [Array<[number, number]>] };
  }>;
};

/** ---------------- Map stages ---------------- */

const MAP_STAGES = Object.freeze({
  IDLE: "idle",
  BUILDING: "building",
  ROUTE: "route",
  TRACKING: "tracking",
} as const);

type MapStage = (typeof MAP_STAGES)[keyof typeof MAP_STAGES];

const STAGE_DETAILS: Record<
  MapStage,
  { label: string; headline: string; description: string; badgeColor: string }
> = {
  [MAP_STAGES.IDLE]: {
    label: "Campus overview",
    headline: "Explore the full map",
    description: "Pan freely or pick a building to preview routes.",
    badgeColor: "bg-slate-100 text-slate-600",
  },
  [MAP_STAGES.BUILDING]: {
    label: "Building focus",
    headline: "Dialed into your destination",
    description: "Review building info or preview a route when ready.",
    badgeColor: "bg-amber-100 text-amber-700",
  },
  [MAP_STAGES.ROUTE]: {
    label: "Route overview",
    headline: "Preview the full path",
    description: "See the complete route before committing to tracking.",
    badgeColor: "bg-sky-100 text-sky-700",
  },
  [MAP_STAGES.TRACKING]: {
    label: "Live navigation",
    headline: "Tracking in real time",
    description: "Follow turn-by-turn guidance until you arrive.",
    badgeColor: "bg-emerald-100 text-emerald-700",
  },
};

export default function NavigationMap(): JSX.Element {
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

  const [selectedDest, setSelectedDest] = useState<string>("");
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [userPos, setUserPos] = useState<UserPos | null>(null);
  const [destPos, setDestPos] = useState<LngLat | null>(null);

  const [tracking, setTracking] = useState<boolean>(false);
  const [navigating, setNavigating] = useState<boolean>(false);
  const [mapReady, setMapReady] = useState<boolean>(false);

  const [curNavMode, setCurNavMode] = useState<string | number>(1);
  const [markers, setMarkers] = useState<MarkerNode[]>([]);
  const [edgeIndex, setEdgeIndex] = useState<EdgeIndexEntry[]>([]);

  const [path, setPath] = useState<Set<string>>(new Set());
  const [navModes, setNavModes] = useState<NavMode[]>([]);
  const [mapStage, setMapStage] = useState<MapStage>(MAP_STAGES.IDLE);

  const [lastGeoMsg, setLastGeoMsg] = useState<string>("");
  const [useCompass, setUseCompass] = useState<boolean>(false);

  const [curBuildingPoly, setCurBuildingPoly] =
    useState<GeoJSONFeatureCollection | null>(null);

  const mapRef = useRef<MapRef | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const deviceHeadingRef = useRef<number | null>(null);
  const routeCoordsRef = useRef<Array<[number, number]>>([]);

  const [buildingNodes, setBuildingNodes] = useState<Set<string>>(new Set());
  const [pathNodeIds, setPathNodeIds] = useState<Set<string>>(new Set());

  // ---- Route recalc on nav-mode change (route preview only) ----
  const [pendingPathKeys, setPendingPathKeys] = useState<string[] | null>(null);
  const routeReqSeqRef = useRef(0);
  const lastRecalcToastRef = useRef<string>("");

  const selectedBuilding = useMemo(() => {
    return buildings.find((b) => `${b.id}` === `${selectedDest}`) ?? null;
  }, [buildings, selectedDest]);

  const { isDark, toggleTheme } = useAppTheme();

  const { data: session, error, refetch, isPending } = authClient.useSession();

  async function userInit(userId: string) {
    let resp = await fetch("/api/user/");
    console.log("resp", (resp as any)?.curUser);
  }

  useEffect(() => {
    if (!session || error) return;
    void userInit(session.user.id);
  }, [session, refetch, error]);

  const stageDetails =
    STAGE_DETAILS[mapStage] ?? STAGE_DETAILS[MAP_STAGES.IDLE];

  /** ---------------- PMTiles + Style ---------------- */

  const stylePath = isDark
    ? "/styles/osm-bright/style-local-dark.json"
    : "/styles/osm-bright/style-local-light.json";
  const { baseStyle, vectorSourceId } = usePmtilesStyle({ stylePath });

  const surfacePanelClass = "bg-panel text-panel-foreground";
  const surfaceSubtleClass = "bg-panel-muted text-panel-muted-foreground";
  const borderMutedClass = "border-border";
  const selectBaseClass = "border-border bg-panel text-panel-foreground";
  const selectFocusClass =
    "focus:border-brand-accent focus:ring-brand-accent/30";

  /** -------- Accuracy ring -------- */

  const accuracyGeoJSON = useMemo<GeoJSONFeatureCollection | null>(() => {
    if (!userPos?.accuracy) return null;
    return makeCircleGeoJSON(
      userPos.lng,
      userPos.lat,
      Math.max(userPos.accuracy, 5),
      64,
    );
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

  /** -------- Camera helpers -------- */

  function ensureCenter(lng: number, lat: number, minZoom = 13) {
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

  function fitToUserAndDest(
    extraCoords: Array<[number, number]> = [],
    options: { padding?: any; maxZoom?: number; duration?: number } = {},
  ) {
    const map = mapRef.current?.getMap?.();
    if (!map) return;

    const coords: Array<[number, number]> = [];
    if (userPos) coords.push([userPos.lng, userPos.lat]);
    if (destPos) coords.push([destPos.lng, destPos.lat]);
    if (extraCoords?.length) coords.push(...extraCoords);
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

    const defaultPadding = isMobile
      ? { top: 80, right: 24, bottom: 220, left: 24 }
      : { top: 96, right: 360, bottom: 96, left: 32 };

    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      {
        padding: options.padding ?? defaultPadding,
        maxZoom: options.maxZoom ?? 19,
        duration: options.duration ?? 900,
        essential: true,
      },
    );
  }

  function showCampusOverview() {
    const map = mapRef.current?.getMap?.();
    if (!map) return;

    map.fitBounds(
      [
        [topLeftBoundary.lng, bottomRightBoundary.lat],
        [bottomRightBoundary.lng, topLeftBoundary.lat],
      ],
      {
        padding: { top: 48, bottom: 80, left: 48, right: 48 },
        duration: 900,
        essential: true,
      },
    );
    setMapStage(MAP_STAGES.IDLE);
  }

  /** -------- Geo diagnostics + compass -------- */

  async function diagEnv() {
    console.log(
      "[geo] secure:",
      window.isSecureContext,
      "UA:",
      navigator.userAgent,
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
        e: DeviceOrientationEvent & { webkitCompassHeading?: number },
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

  /** -------- Robust geolocation -------- */

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

        if (insideCampus || forceCenter) {
          setUserPos({ lng: longitude, lat: latitude, accuracy });
          ensureCenter(longitude, latitude, 16);
          setMapStage((stage) => {
            if (stage === MAP_STAGES.ROUTE) return MAP_STAGES.ROUTE;
            if (selectedDest) return MAP_STAGES.BUILDING;
            return MAP_STAGES.IDLE;
          });
        }
      },
      (err) => {
        console.log(err.message);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
    );
  }

  /** -------- Building load + selection -------- */

  async function showBuilding(id: string) {
    if (!id) {
      setDestPos(null);
      setMapStage(MAP_STAGES.IDLE);
      return;
    }

    try {
      const resp: any = await getBuildingPos(id);
      console.log(resp);
      const polyStr = resp?.building?.polyGon;
      if (typeof polyStr === "string") setCurBuildingPoly(JSON.parse(polyStr));
      else setCurBuildingPoly(null);

      const bNodes = resp?.building_nodes ?? [];
      setBuildingNodes(new Set(bNodes.map((n: any) => String(n.id))));

      const b = resp?.building;
      const rawLat = Number(b?.lat);
      const rawLng = Number(b?.lng);

      if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) {
        console.error("Invalid building coordinates:", b?.lat, b?.lng);
        toast.error("Building location data is invalid.");
        setDestPos(null);
        return;
      }

      setDestPos({
        lat: rawLat - 0.0002,
        lng: rawLng + 0.00005,
      });

      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }

      setNavigating(false);
      setZoomed(true);
      setTracking(false);

      setPath(new Set());
      setPathNodeIds(new Set());
      routeCoordsRef.current = [];
      setPendingPathKeys(null);

      setMapStage(MAP_STAGES.BUILDING);
    } catch (err) {
      console.error("Building lookup failed", err);
      toast.error("Unable to locate that building right now.");
    }
  }

  function handleClearDestination() {
    if (tracking) stopTracking();
    setSelectedDest("");
    setDestPos(null);
    setBuildingNodes(new Set());
    setPath(new Set());
    setNavigating(false);
    routeCoordsRef.current = [];
    setPendingPathKeys(null);
    setMapStage(MAP_STAGES.IDLE);
    showCampusOverview();
  }

  async function handleDestinationChange(id: string) {
    if (!id) {
      handleClearDestination();
      return;
    }
    if (tracking) stopTracking();
    else {
      setPath(new Set());
      setNavigating(false);
    }
    setSheetPosition(0);
    setSelectedDest(id);
    await showBuilding(id);
  }

  /** -------- Route utilities (typed) -------- */

  function makeLookups(
    markersLocal: MarkerNode[],
    edgeIndexLocal: EdgeIndexEntry[],
  ) {
    const nodesById = new Map<string, { lng: number; lat: number }>(
      markersLocal.map((m) => [String(m.id), { lng: m.lng, lat: m.lat }]),
    );
    const edgesByKey = new Map<string, { from: string; to: string }>(
      edgeIndexLocal.map((e) => [
        String(e.key),
        { from: String(e.from), to: String(e.to) },
      ]),
    );
    return { nodesById, edgesByKey };
  }

  function orderNodeIdsFromPathKeys(
    pathKeys: string[],
    edgesByKey: Map<string, { from: string; to: string }>,
  ) {
    const adj = new Map<string, Set<string>>();
    const add = (u: string, v: string) => {
      if (!adj.has(u)) adj.set(u, new Set());
      if (!adj.has(v)) adj.set(v, new Set());
      adj.get(u)!.add(v);
      adj.get(v)!.add(u);
    };

    for (const k of pathKeys) {
      const e = edgesByKey.get(k);
      if (!e) continue;
      add(e.from, e.to);
    }

    if (adj.size === 0) return [];

    const endpoints = [...adj.entries()]
      .filter(([, s]) => s.size === 1)
      .map(([id]) => id);
    const start = endpoints[0] ?? [...adj.keys()][0];

    const ordered: string[] = [];
    const visited = new Set<string>();
    let cur: string | null = start;
    let prev: string | null = null;

    while (cur != null) {
      ordered.push(cur);
      visited.add(cur);
      const nextNode =
        [...(adj.get(cur) ?? [])].find((n) => n !== prev && !visited.has(n)) ??
        null;
      prev = cur;
      cur = nextNode;
    }

    return ordered;
  }

  function nodeIdsToCoords(
    orderedIds: string[],
    nodesById: Map<string, { lng: number; lat: number }>,
  ) {
    const coords: Array<[number, number]> = [];
    for (const id of orderedIds) {
      const p = nodesById.get(id);
      if (p) coords.push([p.lng, p.lat]);
    }
    return coords;
  }

  const buildingNodesFC = useMemo<GeoJSONFeatureCollection | null>(() => {
    if (!markers.length || !buildingNodes.size) return null;

    return {
      type: "FeatureCollection",
      features: markers
        .filter((m) => buildingNodes.has(String(m.id)))
        .map((m) => ({
          type: "Feature",
          properties: {
            id: String(m.id),
            onPath: pathNodeIds.has(String(m.id)),
          },
          geometry: { type: "Point", coordinates: [m.lng, m.lat] },
        })),
    };
  }, [markers, buildingNodes, pathNodeIds]);

  function buildRouteFeature(pathKeys: string[]) {
    if (!Array.isArray(pathKeys) || pathKeys.length === 0) return null;
    const { nodesById, edgesByKey } = makeLookups(markers, edgeIndex);
    const orderedIds = orderNodeIdsFromPathKeys(pathKeys, edgesByKey);
    const coords = nodeIdsToCoords(orderedIds, nodesById);
    if (coords.length < 2) return null;

    setPathNodeIds(new Set(orderedIds.map((id) => String(id))));
    routeCoordsRef.current = coords;

    return coords;
  }

  function extractPathKeys(resp: any): string[] {
    const pathKeys: string[] = Array.isArray(resp?.path)
      ? resp.path
      : resp?.path instanceof Set
        ? [...resp.path]
        : [];
    return pathKeys.map(String);
  }

  /** -------- Bearing / camera -------- */

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
    }: { zoom?: number; pitch?: number; duration?: number } = {},
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

  /** -------- Route actions -------- */

  async function showRoute() {
    if (!selectedDest)
      return toast.error("Please select a destination before starting route.");
    if (!userPos) return toast.error("Tap Locate Me before looking for a route.");

    try {
      const resp: any = await getRouteTo(
        selectedDest,
        userPos.lat,
        userPos.lng,
        String(curNavMode),
      );

      const pathKeys = extractPathKeys(resp);

      if (pathKeys.length === 0) {
        toast.error("No route found for that selection.");
        return;
      }

      setPath(new Set(pathKeys));
      setNavigating(true);
      setTracking(false);

      const coords = buildRouteFeature(pathKeys);
      setMapStage(MAP_STAGES.ROUTE);

      if (!coords) {
        setPendingPathKeys(pathKeys);
        setSheetPosition(sheetSnapPoints[sheetSnapPoints.length - 1]);
        setZoomed(true);
        fitToUserAndDest();
        return;
      }

      setSheetPosition(sheetSnapPoints[sheetSnapPoints.length - 1]);
      setZoomed(true);
      fitToUserAndDest(coords);
    } catch (err) {
      console.error("Route lookup failed", err);
      toast.error("Failed to build route. Please try again.");
    }
  }

  async function recalcRouteForNavMode(nextNavMode: string | number) {
    if (!selectedDest || !userPos) return;

    const seq = ++routeReqSeqRef.current;

    try {
      const resp: any = await getRouteTo(
        selectedDest,
        userPos.lat,
        userPos.lng,
        String(nextNavMode),
      );

      if (seq !== routeReqSeqRef.current) return;

      const keys = extractPathKeys(resp);

      if (keys.length === 0) {
        toast.error("No route found for that mode.");
        setPendingPathKeys(null);
        return;
      }

      routeCoordsRef.current = [];
      setPathNodeIds(new Set());
      setPath(new Set(keys));
      setNavigating(true);
      setTracking(false);
      setMapStage(MAP_STAGES.ROUTE);

      setPendingPathKeys(keys);
    } catch (err) {
      console.error("Recalc route failed", err);
      toast.error("Failed to recalculate route.");
      setPendingPathKeys(null);
    }
  }

  async function startTracking() {
    if (!selectedDest) return toast.error("Please select a destination first.");
    if (!userPos) return toast.error("Tap Locate Me first so I know where you are.");

    let resp: any;
    try {
      resp = await getRouteTo(
        selectedDest,
        userPos.lat,
        userPos.lng,
        String(curNavMode),
      );
    } catch {
      toast.error("Failed to get route");
      return;
    }

    const pathKeys = extractPathKeys(resp);

    if (pathKeys.length === 0) return toast.error("No route found.");

    setPath(new Set(pathKeys));

    const coords = buildRouteFeature(pathKeys);
    if (!coords || coords.length < 2)
      return toast.error("Route is too short to navigate.");

    setNavigating(true);

    const [lng1, lat1] = [userPos.lng, userPos.lat];
    const [lng2, lat2] = coords[1];
    const forward =
      typeof userPos.heading === "number"
        ? userPos.heading
        : bearingTo(lng1, lat1, lng2, lat2);

    aimCamera(mapRef.current?.getMap?.(), lng1, lat1, forward, {
      pitch: 60,
      duration: 600,
      zoom: 20,
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
            : { lng: longitude, lat: latitude, heading },
        );

        let brg: number;
        if (typeof heading === "number" && !Number.isNaN(heading)) brg = heading;
        else if (deviceHeadingRef.current != null) brg = deviceHeadingRef.current;
        else if (routeCoordsRef.current.length >= 2) {
          const [nx, ny] = routeCoordsRef.current[1];
          brg = bearingTo(longitude, latitude, nx, ny);
        } else brg = mapRef.current?.getMap?.()?.getBearing?.() ?? 0;

        aimCamera(mapRef.current?.getMap?.(), longitude, latitude, brg, {
          pitch: 60,
          duration: 300,
          zoom: 20,
        });
      },
      (err) => {
        console.log("watchPosition error:", err);
        toast.error(err.message || "Tracking error");
        stopTracking();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 1000 },
    );

    watchIdRef.current = id;
    setTracking(true);
    setMapStage(MAP_STAGES.TRACKING);
  }

  function stopTracking() {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setViewState(defViewState);
    routeCoordsRef.current = [];

    setPath(new Set());
    setNavigating(false);
    setTracking(false);
    setPendingPathKeys(null);
    setMapStage(MAP_STAGES.IDLE);
    disableCompass();
  }

  /** -------- Data loading -------- */

  async function getBuildings() {
    const resp: any = await getAllBuildings();
    if (resp?.buildings) setBuildings(resp.buildings || []);
    else toast.error("Buildings did not load!");
  }

  async function getNavModes() {
    const resp: any = await getAllNavModes();
    const curNavModes: NavMode[] = resp.NavModes ?? [];
    if (curNavModes.length > 0) setCurNavMode(curNavModes[0].id);
    setNavModes(curNavModes);
  }

  useEffect(() => {
    getBuildings();
    locateOnceRobust();
    getNavModes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recalculate route if user is previewing a route and nav mode changes
  useEffect(() => {
    const isViewingRoute =
      mapStage === MAP_STAGES.ROUTE && navigating && !tracking;

    if (!isViewingRoute) return;
    if (!selectedDest || !userPos) return;

    void recalcRouteForNavMode(curNavMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curNavMode]);

  // Once NavModeMap loads the new mode graph, build the route geometry
  useEffect(() => {
    if (!pendingPathKeys || pendingPathKeys.length === 0) return;
    if (!markers.length || !edgeIndex.length) return;

    const coords = buildRouteFeature(pendingPathKeys);

    if (!coords) {
      const key = pendingPathKeys.slice(0, 3).join(",") + `|${curNavMode}`;
      if (lastRecalcToastRef.current !== key) {
        lastRecalcToastRef.current = key;
        toast.error("Route geometry couldn't be built for this mode.");
      }
      setPendingPathKeys(null);
      return;
    }

    fitToUserAndDest(coords, { duration: 900 });
    setPendingPathKeys(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPathKeys, markers, edgeIndex]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap?.();
    if (!map) return;
    if (mapStage === MAP_STAGES.TRACKING) return;

    if (mapStage === MAP_STAGES.BUILDING && destPos) {
      if (!Number.isFinite(destPos.lat) || !Number.isFinite(destPos.lng)) {
        console.warn("Skipping flyTo due to invalid destPos", destPos);
        return;
      }

      map.flyTo({
        center: [destPos.lng, destPos.lat],
        zoom: 18.5,
        pitch: 42,
        bearing: 0,
        duration: 900,
        essential: true,
      });
    }

    if (mapStage === MAP_STAGES.ROUTE && userPos && destPos) {
      fitToUserAndDest(routeCoordsRef.current, { duration: 1000 });
    }
  }, [
    mapReady,
    mapStage,
    destPos?.lng,
    destPos?.lat,
    userPos?.lng,
    userPos?.lat,
  ]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null)
        navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  /** -------- Bottom sheet (typed) -------- */

  const [sheetPosition, setSheetPosition] = useState<number>(0.75);
  const [isDraggingSheet, setIsDraggingSheet] = useState<boolean>(false);

  const sheetDragActiveRef = useRef<boolean>(false);
  const sheetStartYRef = useRef<number>(0);
  const sheetStartPosRef = useRef<number>(0);
  const sheetDidDragRef = useRef<boolean>(false);

  const sheetSnapPoints = useMemo<number[]>(
    () => [0.05, 0.1, 0.4, 0.6, 0.75],
    [],
  );

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  function toggleSheetToFarthestSnap() {
    setSheetPosition((current) => {
      const first = sheetSnapPoints[0];
      const last = sheetSnapPoints[sheetSnapPoints.length - 1];
      const distToFirst = Math.abs(current - first);
      const distToLast = Math.abs(current - last);
      return distToFirst > distToLast ? first : last;
    });
  }

  function handleSheetDragStart(e: React.PointerEvent | React.TouchEvent) {
    const anyE: any = e;
    const clientY =
      anyE.touches && anyE.touches[0] ? anyE.touches[0].clientY : anyE.clientY;

    sheetDragActiveRef.current = true;
    sheetDidDragRef.current = false;
    setIsDraggingSheet(true);
    sheetStartYRef.current = clientY;
    sheetStartPosRef.current = sheetPosition;
  }

  useEffect(() => {
    function handleMove(e: PointerEvent | TouchEvent) {
      if (!sheetDragActiveRef.current) return;

      const anyE: any = e;
      const clientY =
        anyE.touches && anyE.touches[0]
          ? anyE.touches[0].clientY
          : anyE.clientY;

      const deltaY = clientY - sheetStartYRef.current;
      if (Math.abs(deltaY) > 6) sheetDidDragRef.current = true;

      const nextPos = clamp(
        sheetStartPosRef.current + deltaY / window.innerHeight,
        0,
        1,
      );
      setSheetPosition(nextPos);
    }

    function handleEnd() {
      if (!sheetDragActiveRef.current) return;
      sheetDragActiveRef.current = false;
      setIsDraggingSheet(false);

      setSheetPosition((current) => {
        let closest = sheetSnapPoints[0];
        let minDist = Math.abs(current - closest);
        for (const sp of sheetSnapPoints) {
          const d = Math.abs(current - sp);
          if (d < minDist) {
            minDist = d;
            closest = sp;
          }
        }
        return closest;
      });
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);

    window.addEventListener("touchmove", handleMove as any, { passive: false });
    window.addEventListener("touchend", handleEnd);
    window.addEventListener("touchcancel", handleEnd);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);

      window.removeEventListener("touchmove", handleMove as any);
      window.removeEventListener("touchend", handleEnd);
      window.removeEventListener("touchcancel", handleEnd);
    };
  }, [sheetSnapPoints]);

  const [isZoomed, setZoomed] = useState<boolean>(false);

  async function handelZoom() {
    if (isZoomed) {
      showCampusOverview();
      setZoomed(false);
      return;
    }

    if (navigating) {
      if (tracking) {
        setSheetPosition(sheetSnapPoints[sheetSnapPoints.length - 1]);
        setZoomed(true);
        startTracking();
        return;
      } else {
        showRoute();
        setSheetPosition(0);
        setZoomed(true);
        return;
      }
    } else {
      if (selectedDest) {
        await showBuilding(selectedDest);
        if (userPos) ensureCenter(userPos.lng, userPos.lat, 16);
        setZoomed(true);
        return;
      } else {
        locateOnceRobust();
        setZoomed(true);
        return;
      }
    }
  }

  async function handelTheButton() {
    if (!selectedDest)
      return toast.error("Please select a destination before starting route.");
    if (!userPos) return toast.error("Tap Locate Me before looking for a route.");

    if (!navigating && !tracking) {
      showRoute();
      return;
    }

    if (navigating) {
      if (tracking) {
        setSheetPosition(0);
        stopTracking();
        showRoute();
      } else {
        setSheetPosition(sheetSnapPoints[sheetSnapPoints.length - 1]);
        startTracking();
      }
    }
  }

  const { toggleSidebar } = useSidebar();

  /** ---------------- Render ---------------- */

  const canRenderMap = !!baseStyle;

  return (
    <div className="relative h-screen w-full bg-background text-foreground">
      <Toaster position="top-right" reverseOrder />

      {/* Top brand + search bar */}
      <div className="absolute inset-x-2 top-3 z-30 md:left-1/2 md:w-[720px] md:-translate-x-1/2">
        <div className="flex w-full items-stretch gap-2 justify-items-center">
          <div
            className={`flex flex-[1] items-center justify-center rounded-[25px] border ${borderMutedClass} ${surfacePanelClass} px-2 py-1 shadow-xl backdrop-blur
              transition transform hover:scale-[1.03] active:scale-95`}
            onClick={toggleTheme}
          >
            <Image
              src="/assets/ic_logo_up.png"
              alt="Ithaca College logo"
              width={160}
              height={40}
              className="max-h-10 w-auto dark:hidden"
            />
            <Image
              src="/assets/ic_logo_up_dark.png"
              alt="Ithaca College logo"
              width={160}
              height={40}
              className="hidden max-h-10 w-auto dark:block"
            />
          </div>

          <div
            className={`flex flex-[10] items-center justify-center-safe rounded-[22px] border ${borderMutedClass} ${surfacePanelClass} px-1 py-1 shadow-xl backdrop-blur`}
          >
            <div className="w-full">
              <select
                id="search-dest"
                className={`w-full rounded-2xl border px-3 py-3 text-sm font-medium transition focus:outline-none focus:ring-2 ${selectFocusClass} ${selectBaseClass}`}
                value={selectedDest}
                onChange={(e) => handleDestinationChange(e.target.value)}
              >
                <option value="">Search campus buildings…</option>
                {buildings.map((d) => (
                  <option key={String(d.id)} value={String(d.id)}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {session ? (
            <div
              className={`flex flex-[1] h-full  w-full items-center justify-center rounded-[25px] border ${borderMutedClass} ${surfacePanelClass} px-2 py-1 shadow-xl backdrop-blur
              transition transform hover:scale-[1.03] active:scale-95`}
            >
              <ProfileOptions session={session} />
            </div>
          ) : (
            <Link href="/account/login">
              <div
                className={`flex flex-[1] h-full  w-full items-center justify-center rounded-[25px] border ${borderMutedClass} ${surfacePanelClass} px-2 py-1 shadow-xl backdrop-blur
              transition transform hover:scale-[1.03] active:scale-95`}
              >
                <IconLogin2 size={35} />
              </div>
            </Link>
          )}
        </div>
      </div>

      {/* Nav mode pills */}
      <div className="absolute inset-x-3 top-21 z-30 space-y-3 md:left-1/2 md:w-[720px] md:-translate-x-1/2">
        <div className="px-3">
          <div className="flex justify-center">
            <span
              className={`mx-2 w-15 rounded-3xl border ${borderMutedClass} ${surfacePanelClass} text-center text-[13px] font-bold uppercase tracking-wide text-panel-muted-foreground shadow-xl backdrop-blur`}
            >
              Modes
            </span>
          </div>

          <div className="mt-1 justify-center -mx-1 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {navModes.map((mode) => {
              const active = `${mode.id}` === `${curNavMode}`;
              return (
                <button
                  key={String(mode.id)}
                  onClick={() => setCurNavMode(mode.id)}
                  className={[
                    "shrink-0 rounded-[15px] px-4 py-1.5 text-xs font-semibold uppercase transition shadow-sm",
                    active
                      ? "bg-brand text-brand-foreground dark:bg-brand-accent dark:text-brand-accent-foreground"
                      : `border ${borderMutedClass} bg-panel-muted text-panel-muted-foreground hover:bg-panel`,
                  ].join(" ")}
                >
                  {mode.name}
                </button>
              );
            })}
            {navModes.length === 0 && (
              <span className="px-2 text-[10px] text-muted-foreground">
                Loading navigation modes…
              </span>
            )}
          </div>
        </div>
      </div>

      {/* admin pages (moved fully to left) */}
      <div className="absolute left-3 top-40 z-30 flex flex-col space-y-3">
        <Link href="/route-editor">
          <button
            className={[
              "shrink-0 w-30 rounded-[15px] px-4 py-1.5 font-bold transition shadow-sm",
              `border ${borderMutedClass} bg-panel-muted text-panel-muted-foreground hover:bg-panel`,
            ].join(" ")}
          >
            {"Route \n Editor"}
          </button>
        </Link>

        <Link href="/building-editor">
          <button
            className={[
              "shrink-0 w-30 rounded-[15px] px-4 py-1.5 font-bold transition shadow-sm",
              `border ${borderMutedClass} bg-panel-muted text-panel-muted-foreground hover:bg-panel`,
            ].join(" ")}
          >
            {"Building \n Editor"}
          </button>
        </Link>

        <Link href="/customRoute">
          <button
            className={[
              "shrink-0 w-30 rounded-[15px] px-4 py-1.5 font-bold transition shadow-sm",
              `border ${borderMutedClass} bg-panel-muted text-panel-muted-foreground hover:bg-panel`,
            ].join(" ")}
          >
            {"Shareable \n Routes"}
          </button>
        </Link>
      </div>

      {/* Bottom sheet wrapper */}
      <div
        className={[
          "fixed inset-x-0 bottom-0 z-30 h-[60vh] pointer-events-none md:left-1/2 md:w-[720px] md:-translate-x-1/2",
          !isDraggingSheet && "transition-transform duration-250 ease-out",
          !selectedDest && "hidden",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ transform: `translateY(${sheetPosition * 100}%)` }}
      >
        <div className="flex flex-row w-full justify-between">
          <div
            className={[
              "mr-3 mb-2 justify-self-start rounded-[15px]  w-15 h-15 justify-items-center content-center pointer-events-auto",
              "bg-brand text-brand-foreground dark:bg-brand-accent dark:text-brand-accent-foreground",
            ].join(" ")}
          >
            <button
              className="w-full h-full grid place-items-center"
              onClick={handelZoom}
            >
              {isZoomed ? (
                <IconArrowsMaximize className="text-current" size={32} />
              ) : (
                <IconArrowsMinimize className="text-current" size={32} />
              )}
            </button>
          </div>

          <div
            className={[
              "mr-3 mb-2 justify-self-end rounded-[15px]  w-15 h-15 justify-items-center content-center pointer-events-auto",
              "bg-brand text-brand-foreground dark:bg-brand-accent dark:text-brand-accent-foreground",
            ].join(" ")}
          >
            <button
              className="w-full h-full grid place-items-center"
              onClick={handelTheButton}
            >
              {!tracking && !navigating ? (
                <IconArrowGuide className="text-current" size={32} />
              ) : null}

              {navigating ? (
                tracking ? (
                  <IconNavigationX className="text-current" size={32} />
                ) : (
                  <IconNavigation className="text-current" size={32} />
                )
              ) : null}
            </button>
          </div>
        </div>

        {/* Actual sheet */}
        <div
          className={[
            "flex h-full flex-col rounded-t-3xl border shadow-2xl backdrop-blur pointer-events-auto",
            surfacePanelClass,
            borderMutedClass,
          ].join(" ")}
        >
          {/* Grab row */}
          <div
            className="w-full"
            style={{ touchAction: "none" }}
            onPointerDown={handleSheetDragStart}
            onTouchStart={handleSheetDragStart}
          >
            <div
              className={[
                "flex ml-0.5 mt-0.5 w-14 h-14 rounded-3xl shadow-md justify-content-center content-center select-none touch-none",
                "bg-brand text-brand-foreground dark:bg-brand-accent dark:text-brand-accent-foreground",
              ].join(" ")}
              style={{ touchAction: "none" }}
              onPointerDown={handleSheetDragStart}
              onTouchStart={handleSheetDragStart}
            >
              <button
                onPointerDown={(e) => handleSheetDragStart(e)}
                onClick={() => {
                  if (sheetDidDragRef.current) return;
                  toggleSheetToFarthestSnap();
                }}
              >
                {sheetPosition > 0.5 ? (
                  <IconArrowBadgeUpFilled className="text-current" size={42} />
                ) : (
                  <IconArrowBadgeDownFilled className="text-current" size={42} />
                )}
              </button>
            </div>
          </div>

          <div className="h-[calc(100%-48px)] overflow-y-auto px-4 pb-4">
            {selectedBuilding && (
              <div
                className={`mt-4 rounded-3xl border ${borderMutedClass} ${surfaceSubtleClass} p-4`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
                      {stageDetails.label}
                    </p>
                    <p className="text-lg font-semibold">
                      {selectedBuilding.name}
                    </p>
                    <p className="mt-1 text-sm opacity-80">
                      {stageDetails.headline}
                    </p>
                  </div>
                  <button
                    onClick={handleClearDestination}
                    className="rounded-full border border-border/40 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-panel-foreground/80 transition hover:bg-foreground/5"
                  >
                    Clear
                  </button>
                </div>

                <p className="mt-2 text-sm opacity-80">
                  {selectedBuilding.description ||
                    stageDetails.description ||
                    "Additional building details will appear here soon."}
                </p>

                {destPos && (
                  <div className="mt-2 text-xs opacity-70">
                    {destPos.lat.toFixed(5)}, {destPos.lng.toFixed(5)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Map wrapper */}
      <div className="h-full w-full">
        {!canRenderMap ? (
          <div className="h-full w-full grid place-items-center text-sm opacity-70">
            Loading basemap…
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
            onLoad={() => {
              setMapReady(true);
              const map = mapRef.current?.getMap?.();
              console.log(map?.getStyle().sources);
              console.log(map?.getStyle().layers?.map(l => ({
                id: l.id, source: (l as any).source, "source-layer": (l as any)["source-layer"], type: l.type
              })));
              map?.on("error", (e: any) => {
                console.error("[maplibre error]", e?.error ?? e);
              });
            }}
          >
            <Layer
              id="3d-buildings"
              type="fill-extrusion"
              source={vectorSourceId}
              source-layer="building"
              minzoom={15}
              beforeId="place-city"
              paint={{
                "fill-extrusion-color": isDark ? "#2b3647" : "#dfdbd7",
                "fill-extrusion-height": [
                  "coalesce",
                  ["get", "render_height"],
                  ["get", "height"],
                  12,
                ],
                "fill-extrusion-base": [
                  "coalesce",
                  ["get", "render_min_height"],
                  ["get", "min_height"],
                  0,
                ],
                "fill-extrusion-opacity": 0.75,
              }}
            />

            {buildingNodesFC && (
              <Source
                id="building-nodes"
                type="geojson"
                data={buildingNodesFC as any}
              >
                <Layer
                  id="building-nodes-circle"
                  type="circle"
                  paint={{
                    "circle-radius": [
                      "case",
                      ["boolean", ["get", "onPath"], false],
                      12,
                      8,
                    ],
                    "circle-color": [
                      "case",
                      ["boolean", ["get", "onPath"], false],
                      isDark ? "#ffd200" : "#003c71",
                      isDark ? "#60a5fa" : "#2563eb",
                    ],
                    "circle-stroke-width": 2,
                    "circle-stroke-color": isDark ? "#041631" : "#ffffff",
                  }}
                />
              </Source>
            )}

            {/* KEY forces remount so NavModeMap reloads graph cleanly per mode */}
            <NavModeMap
              key={`navmode-${String(curNavMode)}`}
              path={path}
              navMode={curNavMode}
              markers={markers}
              setMarkers={setMarkers}
              edgeIndex={edgeIndex}
              setEdgeIndex={setEdgeIndex}
            />

            {accuracyGeoJSON && (
              <Source id="loc-accuracy" type="geojson" data={accuracyGeoJSON as any}>
                <Layer {...accuracyFill} />
                <Layer {...accuracyLine} />
              </Source>
            )}

            {selectedDest && curBuildingPoly && (
              <Source id="boundary" type="geojson" data={curBuildingPoly as any}>
                <Layer
                  id="boundary-fill"
                  type="fill"
                  paint={{
                    "fill-color": isDark ? "#ffd200" : "#003c71",
                    "fill-opacity": 0.2,
                  }}
                />
                <Layer
                  id="boundary-outline"
                  type="line"
                  paint={{
                    "line-color": isDark ? "#ffd200" : "#003c71",
                    "line-width": 2,
                  }}
                />
              </Source>
            )}

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
    </div>
  );
}

/** ---------------- Geometry helpers (typed) ---------------- */

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
