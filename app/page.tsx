"use client";
import { Toggle } from "@/components/ui/toggle";
import React, { useRef, useState, useMemo, useEffect, type JSX } from "react";
import {
  Map as ReactMap,
  Source,
  Layer,
  Marker,
  type MapRef,
  type ViewStateChangeEvent,
} from "@vis.gl/react-maplibre";
import { toast } from "sonner";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMapStyle } from "@/hooks/use-map-style";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  CAMPUS_BOUNDS,
} from "@/lib/map-constants";
import { EditorToolsMenu } from "@/components/EditorToolsMenu";
import ProfileOptions from "../components/profileOptions";
import NavModeMap from "../components/NavMode";
import { MapBottomSheet } from "@/components/MapBottomSheet";
import { NavigationStepsPanel } from "@/components/NavigationStepsPanel";
import { NavigationNextTurnBanner } from "@/components/NavigationNextTurnBanner";
import { DestinationStopsEditor } from "@/components/DestinationStopsEditor";
import { DestinationSearchCombobox } from "@/components/DestinationSearchCombobox";
import { TripStopMarkers } from "@/components/TripStopMarkers";
import { RoutePathLayer } from "@/components/RoutePathLayer";
import Link from "next/link";
import { type Session } from "@/lib/auth-client";
import { useEffectiveSession } from "@/hooks/use-effective-session";
import { useIsIcUser } from "@/hooks/use-is-ic-user";
import {
  Car,
  CheckIcon,
  Footprints,
  ListOrdered,
  LogIn,
  Maximize2,
  Minimize2,
  Navigation,
  NavigationOff,
  Route,
  Star,
  XIcon,
} from "lucide-react";
import maplibregl from "maplibre-gl";
import apiClient from "@/lib/apiClient";
import { Slider } from "@/components/ui/slider";
import { NavConditions } from "@/lib/navigation";
import { AccuracyRingLayer } from "@/components/AccuracyRingLayer";
import { makeCircleGeoJSON, bearingTo } from "@/lib/geo";
import {
  surfacePanelClass,
  surfaceSubtleClass,
  borderMutedClass,
  touchTargetClass,
  safeAreaTopClass,
  mapModeRowOffsetClass,
  mapFavoritesRowOffsetClass,
  mapPageClass,
  mapHeaderChipClass,
  mapModeChipClass,
  mapFloatingActionClass,
  mapSheetPeekMinVisibleCompactPx,
  mapSheetPeekMinVisiblePx,
  mapSheetToolbarOverlapPx,
} from "@/lib/panel-classes";
import type {
  LngLat,
  UserPos,
  MarkerNode,
  EdgeIndexEntry,
  GeoJSONFeatureCollection,
  MapDestination,
  NavigateToResponse,
  RouteLegMetrics,
} from "@/lib/types/map";
import {
  formatRouteDistance,
  formatRouteEtaSummary,
  formatRouteDuration,
} from "@/lib/distance-display";
import type { NavStep } from "@/lib/navigation-types";
import { useDistanceUnits } from "@/hooks/use-distance-units";
import { useNavigationProgress } from "@/hooks/use-navigation-progress";

export type Destination = MapDestination;

type FavoriteRow = {
  id: number;
  name: string;
  lat: number;
  lng: number;
};

type ChainRow = {
  id: number;
  name: string;
  destinationIds: number[];
  destinations: Array<{ id: number; name: string }>;
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
    badgeColor: "bg-secondary text-secondary-foreground",
  },
  [MAP_STAGES.BUILDING]: {
    label: "Building focus",
    headline: "Dialed into your destination",
    description: "Review building info or preview a route when ready.",
    badgeColor: "bg-brand-cta/15 text-brand-cta-foreground dark:text-brand-cta",
  },
  [MAP_STAGES.ROUTE]: {
    label: "Route overview",
    headline: "Preview the full path",
    description: "See the complete route before committing to tracking.",
    badgeColor:
      "bg-brand/10 text-brand dark:bg-brand-cta/15 dark:text-brand-cta",
  },
  [MAP_STAGES.TRACKING]: {
    label: "Live navigation",
    headline: "Tracking in real time",
    description: "Follow step-by-step directions until you arrive.",
    badgeColor: "bg-brand-cta/15 text-brand-cta-foreground dark:text-brand-cta",
  },
};

const MAX_INCLINE = 45;
/** Home sheet is shorter (60vh) and has a toolbar row above the panel. */
/** Collapsed peek target; MapBottomSheet clamps further on mobile for min visible chrome. */
const HOME_SHEET_PEEK = 0.85;
const HOME_SHEET_SNAP_POINTS = [0, HOME_SHEET_PEEK];

export default function NavigationMap(): JSX.Element {
  const defViewState = {
    longitude: DEFAULT_CENTER.lng,
    latitude: DEFAULT_CENTER.lat,
    zoom: DEFAULT_ZOOM,
    bearing: 0,
    pitch: 0,
  };

  type Path = {
    path: Set<number>;
    firstNodeId: number;
    lastNodeId: number;
    startNode?: { id: number; lat: number; lng: number };
  };

  const [viewState, setViewState] = useState<{
    longitude: number;
    latitude: number;
    zoom: number;
    bearing: number;
    pitch: number;
  }>(defViewState);

  const [[swLng, swLat], [neLng, neLat]] = CAMPUS_BOUNDS;

  const [selectedDest, setSelectedDest] = useState<number>(0);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [destinationsFirstLoadPending, setDestinationsFirstLoadPending] =
    useState(true);
  const [userPos, setUserPos] = useState<UserPos | null>(null);
  const [destPos, setDestPos] = useState<LngLat | null>(null);

  const [tracking, setTracking] = useState<boolean>(false);
  const [navigating, setNavigating] = useState<boolean>(false);
  const [mapReady, setMapReady] = useState<boolean>(false);

  const [markers, setMarkers] = useState<MarkerNode[]>([]);
  const [edgeIndex, setEdgeIndex] = useState<EdgeIndexEntry[]>([]);
  const PATH_RESET: Path = { path: new Set(), lastNodeId: -1, firstNodeId: -1 };
  const [path, setPath] = useState<Path>(PATH_RESET);
  const [lastGeoMsg, setLastGeoMsg] = useState<string>("");
  const [useCompass, setUseCompass] = useState<boolean>(false);

  const [curNavConditions, setCurNavConditions] = useState<NavConditions>({
    is_pedestrian: true,
    is_vehicular: false,
    is_avoid_stairs: false,
    is_incline_limit: false,
    max_incline: 0,
    is_through_building: true,
  });

  const [mapStage, setMapStage] = useState<MapStage>(MAP_STAGES.IDLE);

  const [curBuildingPoly, setCurBuildingPoly] =
    useState<GeoJSONFeatureCollection | null>(null);

  const mapRef = useRef<MapRef | null>(null);
  const pendingRouteStartRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const deviceHeadingRef = useRef<number | null>(null);
  const compassHandlerRef = useRef<
    ((e: DeviceOrientationEvent) => void) | null
  >(null);
  const routeCoordsRef = useRef<Array<[number, number]>>([]);
  const [routeCoords, setRouteCoords] = useState<Array<[number, number]>>([]);
  const [routeEta, setRouteEta] = useState<{
    distanceMeters: number;
    durationSeconds: number;
    legs: RouteLegMetrics[];
  } | null>(null);
  const [routeSteps, setRouteSteps] = useState<NavStep[]>([]);
  const graphPrefetchRef = useRef<Promise<void> | null>(null);
  const { units: distanceUnits } = useDistanceUnits();

  const navProgress = useNavigationProgress(
    routeSteps,
    userPos,
    routeCoords,
    tracking,
  );

  const [buildingNodes, setBuildingNodes] = useState<Set<number>>(new Set());
  const [buildingMarkers, setBuildingMarkers] = useState<
    Array<{ id: number; lat: number; lng: number }>
  >([]);

  const [favorites, setFavorites] = useState<FavoriteRow[]>([]);
  const [chains, setChains] = useState<ChainRow[]>([]);
  const [destinationStops, setDestinationStops] = useState<number[]>([]);
  const [chainNameInput, setChainNameInput] = useState("");
  const [showFavoriteTripSave, setShowFavoriteTripSave] = useState(false);
  const [stopsEditorOpen, setStopsEditorOpen] = useState(false);

  const favoriteIdSet = useMemo(
    () => new Set(favorites.map((f) => f.id)),
    [favorites],
  );

  const tripStopMarkers = useMemo(() => {
    if (routeCoords.length < 2 && !navigating) return [];
    const ids =
      destinationStops.filter((id) => id > 0).length > 0
        ? destinationStops.filter((id) => id > 0)
        : selectedDest > 0
          ? [selectedDest]
          : [];
    return ids
      .map((id, index) => {
        const dest = destinations.find((d) => Number(d.id) === id);
        if (!dest) return null;
        return {
          id,
          name: dest.name,
          lat: dest.lat,
          lng: dest.lng,
          order: index + 1,
        };
      })
      .filter(
        (
          stop,
        ): stop is {
          id: number;
          name: string;
          lat: number;
          lng: number;
          order: number;
        } => stop != null,
      );
  }, [
    routeCoords.length,
    navigating,
    destinationStops,
    selectedDest,
    destinations,
  ]);

  const selectedBuilding = useMemo(() => {
    return destinations.find((b) => `${b.id}` === `${selectedDest}`) ?? null;
  }, [destinations, selectedDest]);

  async function prefetchGraph() {
    if (edgeIndex.length > 0) return;
    if (graphPrefetchRef.current) return graphPrefetchRef.current;

    graphPrefetchRef.current = (async () => {
      try {
        const req = await apiClient.get("/api/map/all");
        if (req.status !== 200) return;
        const data = await req.json();
        setMarkers(data.nodes as MarkerNode[]);
        setEdgeIndex(data.edges as EdgeIndexEntry[]);
      } catch (err) {
        console.error(err);
      } finally {
        graphPrefetchRef.current = null;
      }
    })();

    return graphPrefetchRef.current;
  }

  const { isDark, mapStyle } = useMapStyle();

  const { realSession, error, isSignedIn, devMode } = useEffectiveSession();
  const { isIcUser } = useIsIcUser();
  const signedInUserId = realSession?.user?.id;

  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (devMode) {
      setIsAdmin(true);
      return;
    }
    if (!signedInUserId || error) {
      setIsAdmin(false);
      return;
    }
    setIsAdmin(Boolean((realSession?.user as { isAdmin?: boolean }).isAdmin));
  }, [devMode, signedInUserId, error, realSession?.user]);

  useEffect(() => {
    if (!isSignedIn || error) {
      setFavorites([]);
      setChains([]);
      return;
    }
    void loadFavorites();
    void loadChains();
  }, [isSignedIn, signedInUserId, error]);

  useEffect(() => {
    if (!pendingRouteStartRef.current) return;
    if (!userPos || !selectedDest) return;
    pendingRouteStartRef.current = false;
    void showRoute();
  }, [userPos, selectedDest]);

  const stageDetails =
    STAGE_DETAILS[mapStage] ?? STAGE_DETAILS[MAP_STAGES.IDLE];

  /** ---------------- PMTiles + Style ---------------- */

  const { baseStyle, vectorSourceId } = usePmtilesStyle({
    stylePath: mapStyle,
  });

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

    map.fitBounds(CAMPUS_BOUNDS, {
      padding: { top: 48, bottom: 80, left: 48, right: 48 },
      duration: 900,
      essential: true,
    });
    setMapStage(MAP_STAGES.IDLE);
  }

  /** -------- Geo diagnostics + compass -------- */

  async function diagEnv() {
    try {
      if (navigator.permissions?.query) {
        await navigator.permissions.query({
          name: "geolocation" as PermissionName,
        });
      }
    } catch {}
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

      compassHandlerRef.current = handler;
      window.addEventListener("deviceorientationabsolute", handler, true);
      window.addEventListener("deviceorientation", handler, true);
      setUseCompass(true);
    } catch {
      toast.error("Compass not available");
    }
  }

  function disableCompass() {
    if (compassHandlerRef.current) {
      window.removeEventListener(
        "deviceorientationabsolute",
        compassHandlerRef.current,
        true,
      );
      window.removeEventListener(
        "deviceorientation",
        compassHandlerRef.current,
        true,
      );
      compassHandlerRef.current = null;
    }
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
      toast.error(msg);
      return;
    }
    if (!window.isSecureContext) {
      const msg = "Location requires HTTPS (or localhost)";
      setLastGeoMsg(msg);
      toast.error(msg);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude, accuracy } = position.coords;

        const insideCampus =
          latitude > swLat &&
          latitude < neLat &&
          longitude > swLng &&
          longitude < neLng;

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
      () => {},
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
    );
  }

  /** -------- Building load + selection -------- */

  async function showBuilding(id: number) {
    if (!id) {
      setDestPos(null);
      setMapStage(MAP_STAGES.IDLE);
      return;
    }

    try {
      const curDestination: Destination | undefined = destinations.find(
        (cur) => cur.id === id,
      );
      if (!curDestination)
        return toast.error("Could not find the current destination.");
      let curDestinationPoly: GeoJSONFeatureCollection | null = null;
      try {
        if (curDestination.polygon) {
          curDestinationPoly = JSON.parse(
            curDestination.polygon,
          ) as GeoJSONFeatureCollection;
        }
      } catch {
        toast.error("Building has no boundary data.");
      }
      setCurBuildingPoly(curDestinationPoly);

      const req: any = await apiClient.get(
        `/api/destination/outsideNode?id=${encodeURIComponent(id)}`,
      );
      const resp = await req.json();

      const bnid = resp?.nodes ?? [];
      const details: Array<{ id: number; lat: number; lng: number }> =
        Array.isArray(resp?.nodeDetails) ? resp.nodeDetails : [];
      setBuildingNodes(new Set(bnid));
      setBuildingMarkers(details);

      void prefetchGraph();

      setDestPos({
        lat: curDestination.lat - 0.0002,
        lng: curDestination.lng + 0.00005,
      });

      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }

      setNavigating(false);
      setZoomed(true);
      setTracking(false);

      setPath(PATH_RESET);
      routeCoordsRef.current = [];
      setRouteCoords([]);
      setRouteEta(null);

      setMapStage(MAP_STAGES.BUILDING);
    } catch (err) {
      console.error("Building lookup failed", err);
      toast.error("Unable to locate that building right now.");
    }
  }

  function handleClearDestination() {
    if (tracking) stopTracking();
    setSelectedDest(-1);
    setDestinationStops([]);
    setStopsEditorOpen(false);
    setDestPos(null);
    setBuildingNodes(new Set());
    setBuildingMarkers([]);
    setPath(PATH_RESET);
    setNavigating(false);
    routeCoordsRef.current = [];
    setRouteCoords([]);
    setRouteEta(null);
    setMapStage(MAP_STAGES.IDLE);
    showCampusOverview();
  }

  async function handleDestinationChange(id: number) {
    if (!id) {
      handleClearDestination();
      return;
    }
    if (tracking) stopTracking();
    else {
      setPath(PATH_RESET);
      setNavigating(false);
    }
    setSheetPosition(0);
    setSelectedDest(id);
    if (!stopsEditorOpen) {
      setDestinationStops([id]);
    }
    await showBuilding(id);
  }

  async function handleStopPick(id: number) {
    if (tracking) stopTracking();
    setSelectedDest(id);
    setSheetPosition(0);
    await showBuilding(id);
  }

  function openStopsEditor() {
    if (selectedDest > 0 && destinationStops.length === 0) {
      setDestinationStops([selectedDest]);
    }
    setStopsEditorOpen(true);
    setSheetPosition(effectiveSheetPeek);
  }

  async function loadFavorites() {
    try {
      const req = await apiClient.get("/api/favorites");
      if (req.status !== 200) return;
      const data = (await req.json()) as { favorites?: FavoriteRow[] };
      setFavorites(data.favorites ?? []);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadChains() {
    try {
      const req = await apiClient.get("/api/destination-chains");
      if (req.status !== 200) return;
      const data = (await req.json()) as { chains?: ChainRow[] };
      setChains(data.chains ?? []);
    } catch (err) {
      console.error(err);
    }
  }

  async function toggleFavorite(destId: number) {
    if (!isSignedIn) {
      toast.error("Sign in to save favorites");
      return;
    }
    const isFav = favoriteIdSet.has(destId);
    try {
      if (isFav) {
        const req = await apiClient.del(
          `/api/favorites?destinationId=${encodeURIComponent(destId)}`,
        );
        if (req.status !== 200) throw new Error("remove failed");
        setFavorites((prev) => prev.filter((f) => f.id !== destId));
        toast.success("Building removed from favorites");
      } else {
        const req = await apiClient.post("/api/favorites", {
          destinationId: destId,
        });
        if (req.status !== 201) throw new Error("add failed");
        const dest = destinations.find((d) => Number(d.id) === destId);
        if (dest) {
          setFavorites((prev) => [
            ...prev,
            {
              id: destId,
              name: dest.name,
              lat: dest.lat,
              lng: dest.lng,
            },
          ]);
        } else {
          await loadFavorites();
        }
        toast.success("Building added to favorites");
      }
    } catch (err) {
      console.error(err);
      toast.error("Could not update favorite");
    }
  }

  async function applyChain(chain: ChainRow) {
    if (!chain.destinationIds.length) return;
    setDestinationStops(chain.destinationIds);
    const lastId = chain.destinationIds[chain.destinationIds.length - 1]!;
    setSelectedDest(lastId);
    await showBuilding(lastId);
    setStopsEditorOpen(true);
    setSheetPosition(0);
    toast.success(`Loaded “${chain.name}”`);
  }

  async function saveNamedChain() {
    if (!isSignedIn) {
      toast.error("Sign in to save favorite trips");
      return;
    }
    const name = chainNameInput.trim();
    if (!name) {
      toast.error("Enter a trip name");
      return;
    }
    if (destinationStops.length < 2) {
      toast.error("Add at least two stops before saving a favorite trip");
      return;
    }
    try {
      const req = await apiClient.post("/api/destination-chains", {
        name,
        destinationIds: destinationStops,
      });
      if (req.status !== 201) throw new Error("save failed");
      setChainNameInput("");
      setShowFavoriteTripSave(false);
      await loadChains();
      toast.success("Trip saved to favorites");
    } catch (err) {
      console.error(err);
      toast.error("Could not save favorite trip");
    }
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
        String(e.id),
        { from: String(e.from), to: String(e.to) },
      ]),
    );
    return { nodesById, edgesByKey };
  }

  const buildingNodesFC = useMemo<GeoJSONFeatureCollection | null>(() => {
    if (!buildingMarkers.length) return null;
    return {
      type: "FeatureCollection",
      features: buildingMarkers.map((m) => ({
        type: "Feature",
        properties: {
          id: String(m.id),
          onPath: m.id === path.lastNodeId,
        },
        geometry: { type: "Point", coordinates: [m.lng, m.lat] },
      })),
    };
  }, [buildingMarkers, path.lastNodeId]);

  /** -------- Bearing / camera -------- */

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

  async function getRoute(): Promise<Path> {
    const routeDestIds =
      destinationStops.filter((id) => id > 0).length > 0
        ? destinationStops.filter((id) => id > 0)
        : selectedDest > 0
          ? [selectedDest]
          : [];

    if (routeDestIds.length === 0) {
      toast.error("Please select a destination before starting route.");
      return PATH_RESET;
    }
    if (!userPos) {
      toast.error("Tap Locate Me before looking for a route.");
      return PATH_RESET;
    }

    const payload =
      routeDestIds.length > 1
        ? {
            viaDestIds: routeDestIds,
            lat: userPos.lat,
            lng: userPos.lng,
            navConditions: curNavConditions,
          }
        : {
            destId: routeDestIds[0],
            lat: userPos.lat,
            lng: userPos.lng,
            navConditions: curNavConditions,
          };

    const req = await apiClient.post("/api/map/navigateTo", payload);
    const resp = (await req.json().catch(() => ({}))) as NavigateToResponse & {
      error?: string;
    };
    if (req.status !== 200) {
      toast.error(resp?.error ?? "Failed to build route.");
      throw new Error("Navigate request failed");
    }
    if (!Array.isArray(resp?.path) || resp.path.length === 0) {
      toast.error("No route found for that selection.");
      return PATH_RESET;
    }
    const orderedPath = resp.path;
    const pnids: Set<number> = new Set(orderedPath);
    const firstNodeId = resp.firstNodeId ?? orderedPath[0];
    const lastNodeId = resp.lastNodeId ?? orderedPath[orderedPath.length - 1];
    if (!lastNodeId || !firstNodeId || pnids.size === 0) {
      toast.error("No route found for that selection.");
      return PATH_RESET;
    }
    const coords = resp.geometry?.coordinates ?? [];
    routeCoordsRef.current = coords;
    setRouteCoords(coords);
    if (
      typeof resp.distanceMeters === "number" &&
      typeof resp.durationSeconds === "number"
    ) {
      setRouteEta({
        distanceMeters: resp.distanceMeters,
        durationSeconds: resp.durationSeconds,
        legs: Array.isArray(resp.legs) ? resp.legs : [],
      });
    } else {
      setRouteEta(null);
    }
    setRouteSteps(Array.isArray(resp.steps) ? resp.steps : []);
    navProgress.resetProgress();
    if (coords.length >= 2) {
      fitToUserAndDest(coords, { duration: 900 });
    }
    return {
      path: pnids,
      firstNodeId,
      lastNodeId,
      startNode: resp.startNode,
    };
  }

  async function showRoute() {
    try {
      const curPath = await getRoute();
      setPath(curPath);
      setNavigating(true);
      setTracking(false);
      setMapStage(MAP_STAGES.ROUTE);
      setSheetPosition(effectiveSheetPeek);
      setZoomed(true);
    } catch (err) {
      console.error("Route lookup failed", err);
      toast.error("Failed to build route. Please try again.");
    }
  }

  async function recalcRouteForNavMode(nextNavConditions: NavConditions) {
    try {
      const curPath = await getRoute();
      setPath(curPath);
      setNavigating(true);
      setTracking(false);
      setMapStage(MAP_STAGES.ROUTE);
    } catch (err) {
      console.error("Recalc route failed", err);
      toast.error("Failed to recalculate route.");
    }
  }

  async function startTracking() {
    if (!selectedDest || selectedDest <= 0)
      return toast.error("Please select a destination first.");
    if (!userPos)
      return toast.error("Tap Locate Me first so I know where you are.");

    const firstNode =
      path.startNode ??
      markers.find((cur) => cur.id === path.firstNodeId) ??
      buildingMarkers.find((cur) => cur.id === path.firstNodeId) ??
      (routeCoordsRef.current[1]
        ? {
            lng: routeCoordsRef.current[1][0],
            lat: routeCoordsRef.current[1][1],
          }
        : null);

    if (!firstNode) return toast.error("Navigation could not start.");

    setNavigating(true);

    const [lng1, lat1] = [userPos.lng, userPos.lat];
    const [lng2, lat2] = [firstNode.lng, firstNode.lat];
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
        if (typeof heading === "number" && !Number.isNaN(heading))
          brg = heading;
        else if (deviceHeadingRef.current != null)
          brg = deviceHeadingRef.current;
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

    setPath(PATH_RESET);
    setNavigating(false);
    setTracking(false);
    setRouteEta(null);
    setRouteSteps([]);
    navProgress.resetProgress();
    setMapStage(MAP_STAGES.IDLE);
    disableCompass();
  }

  /** -------- Data loading -------- */

  async function getBuildings() {
    try {
      const req = await apiClient.get("/api/destination");
      if (req.status !== 200) return toast.error("Buildings did not load!");
      const resp = await req.json();
      setDestinations(resp.destinations || []);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load buildings!");
    } finally {
      setDestinationsFirstLoadPending(false);
    }
  }

  useEffect(() => {
    getBuildings();
    locateOnceRobust();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // Recalculate route if user is previewing a route and nav mode changes
    const isViewingRoute =
      mapStage === MAP_STAGES.ROUTE && navigating && !tracking;

    if (!isViewingRoute) return;
    if (!selectedDest || !userPos) return;

    void recalcRouteForNavMode(curNavConditions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curNavConditions]);

  // Once NavModeMap loads the new mode graph, build the route geometry
  // useEffect(() => {
  //   if (!pendingPathKeys || pendingPathKeys.length === 0) return;
  //   if (!markers.length || !edgeIndex.length) return;

  //   const coords = buildRouteFeature(pendingPathKeys);

  //   if (!coords) {
  //     const key = pendingPathKeys.slice(0, 3).join(",");
  //     if (lastRecalcToastRef.current !== key) {
  //       lastRecalcToastRef.current = key;
  //       toast.error("Route geometry couldn't be built for this mode.");
  //     }
  //     setPendingPathKeys(null);
  //     return;
  //   }

  //   fitToUserAndDest(coords, { duration: 900 });
  //   setPendingPathKeys(null);
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [pendingPathKeys, markers, edgeIndex]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap?.();
    if (!map) return;
    if (mapStage === MAP_STAGES.TRACKING) return;

    if (mapStage === MAP_STAGES.BUILDING && destPos) {
      if (!Number.isFinite(destPos.lat) || !Number.isFinite(destPos.lng)) {
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

  const [isZoomed, setZoomed] = useState<boolean>(false);
  const [sheetPosition, setSheetPosition] = useState(HOME_SHEET_PEEK);
  const [effectiveSheetPeek, setEffectiveSheetPeek] = useState(HOME_SHEET_PEEK);
  const sheetCollapsed = sheetPosition >= effectiveSheetPeek * 0.92;

  useEffect(() => {
    setSheetPosition((pos) =>
      pos >= effectiveSheetPeek * 0.92 ? effectiveSheetPeek : pos,
    );
  }, [effectiveSheetPeek]);

  async function handelZoom() {
    if (isZoomed) {
      showCampusOverview();
      setZoomed(false);
      return;
    }

    if (navigating) {
      if (tracking) {
        setSheetPosition(effectiveSheetPeek);
        setZoomed(true);
        await startTracking().catch(() => {});
        return;
      } else {
        try {
          await showRoute();
        } catch {
          // showRoute already toasts on error
        }
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
    if (!userPos) {
      pendingRouteStartRef.current = true;
      await locateOnceRobust(true);
      return;
    }

    if (!navigating && !tracking) {
      showRoute();
      return;
    }

    if (navigating) {
      if (tracking) {
        setSheetPosition(0);
        stopTracking();
        setTracking(false);
        setNavigating(false);
        setPath(PATH_RESET);
        routeCoordsRef.current = [];
        setRouteCoords([]);
        setRouteEta(null);
        setMapStage(MAP_STAGES.BUILDING);
      } else {
        setSheetPosition(effectiveSheetPeek);
        startTracking();
      }
    }
  }

  /** ---------------- Render ---------------- */

  const canRenderMap = !!baseStyle;

  return (
    <main
      id="main-content"
      className={`relative w-full bg-background text-foreground ${mapPageClass}`}
    >
      <h1 className="sr-only">IC Maps &ndash; Campus Navigation</h1>

      {/* Top brand + search bar */}
      <div
        className={`absolute inset-x-3 top-0 z-30 ${safeAreaTopClass} md:left-1/2 md:w-[720px] md:-translate-x-1/2`}
      >
        <div className="flex w-full items-stretch gap-2">
          <EditorToolsMenu
            isAdmin={isAdmin}
            isIcUser={isIcUser}
            devMode={devMode}
          />

          <DestinationSearchCombobox
            destinations={destinations}
            value={selectedDest > 0 ? selectedDest : 0}
            onChange={(id) => void handleDestinationChange(id)}
            onAddStop={openStopsEditor}
            stopCount={destinationStops.length}
            loading={destinationsFirstLoadPending && destinations.length === 0}
          />

          {isSignedIn ? (
            <div className={`${mapHeaderChipClass} shrink-0 px-1`}>
              <ProfileOptions session={realSession!} />
            </div>
          ) : (
            <Link
              href="/account/login"
              aria-label="Log in to your account"
              className={`${mapHeaderChipClass} shrink-0 px-2`}
            >
              <LogIn className="size-8 shrink-0" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      {isSignedIn && (favorites.length > 0 || chains.length > 0) ? (
        <div
          className={`absolute inset-x-3 z-30 ${mapFavoritesRowOffsetClass} space-y-2 md:left-1/2 md:w-[720px] md:-translate-x-1/2`}
        >
          {favorites.length > 0 ? (
            <div>
              <p className="mb-1 px-1 text-center text-[11px] font-semibold uppercase tracking-wide text-panel-muted-foreground">
                Favorite buildings
              </p>
              <div className="flex justify-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                {favorites.map((fav) => (
                  <button
                    key={fav.id}
                    type="button"
                    onClick={() => void handleDestinationChange(fav.id)}
                    className={[
                      "shrink-0 min-h-11 rounded-2xl border px-4 py-2 text-sm font-medium transition",
                      selectedDest === fav.id
                        ? "border-brand-cta bg-brand-cta text-brand-cta-foreground"
                        : `${borderMutedClass} ${surfacePanelClass} hover:bg-panel`,
                    ].join(" ")}
                  >
                    {fav.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {chains.length > 0 ? (
            <div>
              <p className="mb-1 px-1 text-center text-[11px] font-semibold uppercase tracking-wide text-panel-muted-foreground">
                Favorite trips
              </p>
              <div className="flex justify-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                {chains.map((chain) => (
                  <button
                    key={chain.id}
                    type="button"
                    onClick={() => void applyChain(chain)}
                    className={[
                      "shrink-0 min-h-11 rounded-2xl border px-4 py-2 text-sm font-medium transition inline-flex items-center gap-1.5",
                      `${borderMutedClass} ${surfacePanelClass} hover:bg-panel`,
                    ].join(" ")}
                  >
                    <Star
                      size={16}
                      className="text-brand-cta"
                      aria-hidden="true"
                    />
                    {chain.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!tracking ? (
        <div
          className={`absolute inset-x-3 z-30 ${mapModeRowOffsetClass} space-y-2 md:left-1/2 md:w-[720px] md:-translate-x-1/2`}
        >
          <div
            role="radiogroup"
            aria-label="Navigation mode"
            className="flex justify-center gap-2 overflow-x-auto pb-1 no-scrollbar mt-5 "
          >
            <button
              role="radio"
              aria-checked={curNavConditions.is_pedestrian}
              onClick={() => {
                setCurNavConditions((prev) => {
                  const temp = { ...prev };
                  if (!temp.is_pedestrian) {
                    temp.is_pedestrian = true;
                    temp.is_vehicular = false;
                  }
                  return temp;
                });
              }}
              className={[
                mapModeChipClass,
                "inline-flex shrink-0 items-center gap-1.5",
                curNavConditions.is_pedestrian
                  ? "bg-brand-cta text-brand-cta-foreground"
                  : `border ${borderMutedClass} bg-panel-muted text-panel-muted-foreground hover:bg-panel`,
              ].join(" ")}
            >
              <Footprints size={16} aria-hidden="true" />
              Pedestrian
            </button>
            <button
              role="radio"
              aria-checked={curNavConditions.is_vehicular}
              onClick={() => {
                setCurNavConditions((prev) => {
                  const temp = { ...prev };
                  if (!temp.is_vehicular) {
                    temp.is_pedestrian = false;
                    temp.is_vehicular = true;
                  }
                  return temp;
                });
              }}
              className={[
                mapModeChipClass,
                "inline-flex shrink-0 items-center gap-1.5",
                curNavConditions.is_vehicular
                  ? "bg-brand-cta text-brand-cta-foreground"
                  : `border ${borderMutedClass} bg-panel-muted text-panel-muted-foreground hover:bg-panel`,
              ].join(" ")}
            >
              <Car size={16} aria-hidden="true" />
              Vehicular
            </button>
          </div>
        </div>
      ) : null}

      <MapBottomSheet
        hidden={!selectedDest}
        height="calc(100dvh - max(4.75rem, env(safe-area-inset-top) + 3.5rem))"
        position={sheetPosition}
        onPositionChange={setSheetPosition}
        snapPoints={HOME_SHEET_SNAP_POINTS}
        compactHeader={navigating && sheetCollapsed}
        peekMinVisiblePx={
          navigating && sheetCollapsed
            ? mapSheetPeekMinVisibleCompactPx
            : mapSheetPeekMinVisiblePx
        }
        toolbarOverlapPx={mapSheetToolbarOverlapPx}
        onEffectivePeekChange={setEffectiveSheetPeek}
        title={
          selectedBuilding && !(navigating && sheetCollapsed) ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-panel-muted-foreground">
              {stageDetails.label}
            </p>
          ) : null
        }
        subtitle={
          selectedBuilding ? (
            navigating && sheetCollapsed && routeEta ? (
              <p className="w-full text-center text-base font-semibold text-brand-cta">
                {formatRouteDistance(routeEta.distanceMeters)}
              </p>
            ) : (
              <>
                <p className="w-full truncate text-center text-lg font-semibold">
                  {selectedBuilding.name}
                </p>
                <p className="mt-1 w-full text-center text-sm text-panel-muted-foreground">
                  {stageDetails.headline}
                </p>
                {navigating && routeEta ? (
                  <p className="mt-1 w-full text-center text-sm font-semibold text-brand-cta">
                    {formatRouteEtaSummary(
                      routeEta.durationSeconds,
                      routeEta.distanceMeters,
                    )}
                  </p>
                ) : null}
              </>
            )
          ) : null
        }
        toolbar={
          <div className="pointer-events-none grid w-full grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-end gap-x-2">
            <button
              type="button"
              className={`pointer-events-auto shrink-0 ${mapFloatingActionClass}`}
              onClick={handelZoom}
              aria-label={
                isZoomed
                  ? "Zoom out to campus overview"
                  : "Zoom in to destination"
              }
            >
              {isZoomed ? (
                <Maximize2 className="text-current" size={32} />
              ) : (
                <Minimize2 className="text-current" size={32} />
              )}
            </button>

            {navigating && routeSteps.length > 0 ? (
              <div className="pointer-events-auto flex min-w-0 justify-center">
                <NavigationNextTurnBanner
                  steps={routeSteps}
                  currentStepIndex={navProgress.currentStepIndex}
                  distanceToNextMeters={navProgress.distanceToNextMeters}
                  units={distanceUnits}
                  tracking={tracking}
                  onAdvance={navProgress.advanceStep}
                  className="w-full max-w-[min(15rem,calc(100vw-7rem))]"
                />
              </div>
            ) : (
              <div aria-hidden />
            )}

            <button
              type="button"
              className={`pointer-events-auto shrink-0 ${mapFloatingActionClass}`}
              onClick={handelTheButton}
              aria-label={
                !tracking && !navigating
                  ? "Show route"
                  : navigating && tracking
                    ? "Stop tracking"
                    : "Start live navigation"
              }
            >
              {!tracking && !navigating ? (
                <Route className="text-current" size={32} />
              ) : null}

              {navigating ? (
                tracking ? (
                  <NavigationOff className="text-current" size={32} />
                ) : (
                  <Navigation className="text-current" size={32} />
                )
              ) : null}
            </button>
          </div>
        }
      >
        {curNavConditions.is_pedestrian && !tracking ? (
          <details
            className={`mx-auto mt-3 mb-4 w-full max-w-md rounded-2xl border ${borderMutedClass} ${surfaceSubtleClass}`}
          >
            <summary
              className={`cursor-pointer px-4 py-3 text-center text-sm font-semibold ${touchTargetClass}`}
            >
              Route options
            </summary>
            <div className="space-y-2 border-t border-border px-3 pb-3 pt-2">
              <Toggle
                className={
                  curNavConditions.is_through_building
                    ? "bg-brand-cta text-brand-cta-foreground w-full min-h-11 justify-start"
                    : "border border-border bg-panel-muted text-panel-muted-foreground hover:bg-panel w-full min-h-11 justify-start"
                }
                aria-label="Through Building"
                size="sm"
                variant="outline"
                pressed={curNavConditions.is_through_building}
                onPressedChange={(pressed) =>
                  setCurNavConditions((prev) => ({
                    ...prev,
                    is_through_building: pressed,
                  }))
                }
              >
                {curNavConditions.is_through_building ? (
                  <CheckIcon className="group-aria-pressed/toggle:fill-foreground" />
                ) : (
                  <XIcon className="group-aria-pressed/toggle:fill-foreground" />
                )}
                Through Building
              </Toggle>
              <Toggle
                className={
                  curNavConditions.is_avoid_stairs
                    ? "bg-brand-cta text-brand-cta-foreground w-full min-h-11 justify-start"
                    : "border border-border bg-panel-muted text-panel-muted-foreground hover:bg-panel w-full min-h-11 justify-start"
                }
                aria-label="Avoid Stairs"
                size="sm"
                variant="outline"
                pressed={curNavConditions.is_avoid_stairs}
                onPressedChange={(pressed) =>
                  setCurNavConditions((prev) => ({
                    ...prev,
                    is_avoid_stairs: pressed,
                  }))
                }
              >
                {curNavConditions.is_avoid_stairs ? (
                  <CheckIcon className="group-aria-pressed/toggle:fill-foreground" />
                ) : (
                  <XIcon className="group-aria-pressed/toggle:fill-foreground" />
                )}
                Avoid Stairs
              </Toggle>
              <Toggle
                className={
                  curNavConditions.is_incline_limit
                    ? "bg-brand-cta text-brand-cta-foreground w-full min-h-11 justify-start"
                    : "border border-border bg-panel-muted text-panel-muted-foreground hover:bg-panel w-full min-h-11 justify-start"
                }
                aria-label="Limit Incline"
                size="sm"
                variant="outline"
                pressed={curNavConditions.is_incline_limit}
                onPressedChange={(pressed) =>
                  setCurNavConditions((prev) => ({
                    ...prev,
                    is_incline_limit: pressed,
                  }))
                }
              >
                {curNavConditions.is_incline_limit ? (
                  <CheckIcon className="group-aria-pressed/toggle:fill-foreground" />
                ) : (
                  <XIcon className="group-aria-pressed/toggle:fill-foreground" />
                )}
                Limit Incline
              </Toggle>
              {curNavConditions.is_incline_limit ? (
                <div className="rounded-xl border border-border bg-panel px-3 py-3">
                  <div className="mb-2 text-center text-sm text-muted-foreground">
                    Max incline: {curNavConditions.max_incline}°
                  </div>
                  <Slider
                    id="max-incline-slider"
                    value={[curNavConditions.max_incline]}
                    onValueChange={(val) => {
                      setCurNavConditions((prev) => ({
                        ...prev,
                        max_incline: val[0],
                      }));
                    }}
                    min={0}
                    max={MAX_INCLINE}
                    step={1}
                  />
                </div>
              ) : null}
            </div>
          </details>
        ) : null}

        {selectedBuilding && (
          <div
            className={`mx-auto w-full max-w-md rounded-2xl border ${borderMutedClass} ${surfaceSubtleClass} p-4 text-center`}
          >
            <div className="flex flex-wrap items-center justify-center gap-2">
              {isSignedIn &&
              selectedDest > 0 &&
              destinationStops.length <= 1 ? (
                <button
                  type="button"
                  onClick={() => void toggleFavorite(selectedDest)}
                  aria-label={
                    favoriteIdSet.has(selectedDest)
                      ? "Remove building from favorites"
                      : "Favorite this building"
                  }
                  className={[
                    "inline-flex min-h-11 items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold transition",
                    favoriteIdSet.has(selectedDest)
                      ? "border-brand-cta bg-brand-cta/10 text-brand-cta"
                      : `${borderMutedClass} text-panel-muted-foreground hover:bg-panel`,
                    touchTargetClass,
                  ].join(" ")}
                >
                  <Star
                    size={18}
                    className={
                      favoriteIdSet.has(selectedDest)
                        ? "fill-current text-brand-cta"
                        : ""
                    }
                    aria-hidden="true"
                  />
                  {favoriteIdSet.has(selectedDest)
                    ? "Favorited"
                    : "Favorite building"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleClearDestination}
                aria-label="Clear destination"
                className={`rounded-2xl border border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-panel-muted-foreground transition hover:bg-foreground/5 ${touchTargetClass}`}
              >
                Clear
              </button>
            </div>

            <p className="mx-auto mt-3 max-w-sm text-sm text-panel-muted-foreground">
              {stageDetails.description ||
                "Additional building details will appear here soon."}
            </p>

            {navigating && routeSteps.length > 0 ? (
              <NavigationStepsPanel
                steps={routeSteps}
                currentStepIndex={navProgress.currentStepIndex}
                distanceToNextMeters={navProgress.distanceToNextMeters}
                units={distanceUnits}
                tracking={tracking}
                onAdvance={navProgress.advanceStep}
                hideLiveBanner
                className="mt-3"
              />
            ) : null}

            {navigating && routeEta && routeEta.legs.length > 1 ? (
              <div
                className={[
                  "mx-auto mt-3 w-full max-w-md rounded-2xl border px-4 py-3 text-center",
                  borderMutedClass,
                  surfaceSubtleClass,
                ].join(" ")}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-panel-muted-foreground">
                  Trip estimate
                </p>
                <ul className="mt-2 space-y-2">
                  {routeEta.legs.map((leg, index) => {
                    const name =
                      destinations.find((d) => d.id === leg.destinationId)
                        ?.name ?? `Stop ${index + 1}`;
                    return (
                      <li
                        key={`${leg.destinationId}-${index}`}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="truncate">{name}</span>
                        <span className="shrink-0 font-medium text-brand-cta">
                          ~{formatRouteDuration(leg.durationSeconds)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {destinationStops.length > 1 ? (
              <button
                type="button"
                onClick={openStopsEditor}
                className={[
                  "mx-auto mt-4 flex w-full max-w-md min-h-11 items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition hover:bg-panel",
                  borderMutedClass,
                  surfaceSubtleClass,
                  touchTargetClass,
                ].join(" ")}
              >
                <span>{destinationStops.length} stops in this trip</span>
                <ListOrdered
                  size={18}
                  className="text-brand-cta"
                  aria-hidden="true"
                />
              </button>
            ) : null}

            {destPos && (
              <div className="mt-2 text-xs text-panel-muted-foreground/80">
                {destPos.lat.toFixed(5)}, {destPos.lng.toFixed(5)}
              </div>
            )}
          </div>
        )}
      </MapBottomSheet>

      <DestinationStopsEditor
        open={stopsEditorOpen}
        onOpenChange={setStopsEditorOpen}
        destinations={destinations}
        favorites={favorites}
        stops={destinationStops}
        onStopsChange={(next) => {
          setDestinationStops(next);
          if (next.length > 0) {
            const lastId = next[next.length - 1]!;
            setSelectedDest(lastId);
          }
        }}
        onPickDestination={(id) => void handleStopPick(id)}
        onDone={() => {
          if (destinationStops.length > 1) {
            toast.success(`${destinationStops.length} stops ready for routing`);
          }
          setSheetPosition(0);
        }}
        canFavoriteTrip={isSignedIn}
        tripNameInput={chainNameInput}
        onTripNameChange={setChainNameInput}
        showFavoriteTripPanel={showFavoriteTripSave}
        onToggleFavoriteTrip={() => setShowFavoriteTripSave((v) => !v)}
        onSaveFavoriteTrip={() => void saveNamedChain()}
        legEtas={navigating ? routeEta?.legs : undefined}
      />

      {/* Map wrapper */}
      <div className="h-full w-full">
        {!canRenderMap ? (
          <div
            className="h-full w-full grid place-items-center text-sm text-muted-foreground"
            role="status"
            aria-label="Loading map"
          >
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
                      "#35D5A4",
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
              path={path}
              curNavConditions={curNavConditions}
              markers={markers}
              edgeIndex={edgeIndex}
              setEdgeIndex={setEdgeIndex}
              showBaseGraph={edgeIndex.length > 0 && navigating}
            />

            {routeCoords.length >= 2 && (
              <RoutePathLayer coordinates={routeCoords} />
            )}

            <TripStopMarkers stops={tripStopMarkers} />

            {accuracyGeoJSON && (
              <AccuracyRingLayer data={accuracyGeoJSON} isDark={isDark} />
            )}

            {selectedDest && curBuildingPoly && (
              <Source
                id="boundary"
                type="geojson"
                data={curBuildingPoly as any}
              >
                <Layer
                  id="boundary-fill"
                  type="fill"
                  paint={{
                    "fill-color": "#35D5A4",
                    "fill-opacity": 0.2,
                  }}
                />
                <Layer
                  id="boundary-outline"
                  type="line"
                  paint={{
                    "line-color": "#35D5A4",
                    "line-width": 2,
                  }}
                />
              </Source>
            )}

            {userPos && (
              <Marker
                longitude={userPos.lng}
                latitude={userPos.lat}
                anchor="center"
              >
                <div
                  title={`You are here (${userPos.lat.toFixed(6)}, ${userPos.lng.toFixed(6)})`}
                  className="h-3.5 w-3.5 rounded-full border-2 border-white bg-blue-600 shadow-lg ring-4 ring-blue-500/30 transition"
                />
              </Marker>
            )}
          </ReactMap>
        )}
      </div>
    </main>
  );
}
