"use client";
import { Toggle } from "@/components/ui/toggle";
import { withBasePath } from "@/lib/base-path";
import React, { useRef, useState, useMemo, useEffect, type JSX } from "react";
import {
  Map as ReactMap,
  Source,
  Layer,
  Marker,
  type MapRef,
} from "@vis.gl/react-maplibre";
import { toast } from "sonner";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMapStyle } from "@/hooks/use-map-style";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";
import { useBasemapStyle } from "@/hooks/use-basemap";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  CAMPUS_BOUNDS,
} from "@/lib/map-constants";
import { EditorToolsMenu } from "@/components/EditorToolsMenu";
import { MapBottomSheet } from "@/components/MapBottomSheet";
import { NavigationStepsPanel } from "@/components/NavigationStepsPanel";
import { NavigationNextTurnBanner } from "@/components/NavigationNextTurnBanner";
import { DestinationStopsEditor } from "@/components/DestinationStopsEditor";
import { TripEndsFields } from "@/components/TripEndsFields";
import ComboboxSelect from "@/components/ComboboxSelect";
import { TripStopMarkers } from "@/components/TripStopMarkers";
import { RoutePathLayer } from "@/components/RoutePathLayer";
import {
  TripParkingHighlight,
  featuresFromDestinationPolygon,
} from "@/components/TripParkingHighlight";
import type { FeatureCollection, Polygon } from "geojson";
import { useEffectiveSession } from "@/hooks/use-effective-session";
import { useIsIcUser } from "@/hooks/use-is-ic-user";
import {
  Car,
  CheckIcon,
  Footprints,
  ListOrdered,
  LocateFixed,
  Maximize2,
  Minimize2,
  Navigation,
  NavigationOff,
  Route,
  Star,
  XIcon,
} from "lucide-react";
import maplibregl from "maplibre-gl";
import { Slider } from "@/components/ui/slider";
import { NavConditions } from "@/lib/navigation";
import { AccuracyRingLayer } from "@/components/AccuracyRingLayer";
import {
  makeCircleGeoJSON,
  bearingTo,
  distanceToPolylineMeters,
  GPS_NAV_UI_INTERVAL_MS,
  shouldPublishGpsUi,
} from "@/lib/geo";
import {
  surfacePanelClass,
  surfaceSubtleClass,
  borderMutedClass,
  touchTargetClass,
  safeAreaTopClass,
  mapBarActionClass,
  mapModeRowOffsetClass,
  mapFavoritesRowOffsetClass,
  mapPageClass,
  mapChromeClass,
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
import {
  buildNavigatePayload,
  sameTripEnd,
  tripEndNeedsGps,
  type CampusEntrance,
  type TripEnd,
} from "@/lib/trip-end";

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

function storedPolygonFeatures(
  polygon: string,
): GeoJSONFeatureCollection["features"] {
  try {
    const parsed = JSON.parse(polygon) as {
      type?: string;
      features?: GeoJSONFeatureCollection["features"];
    };
    if (parsed?.type === "FeatureCollection" && Array.isArray(parsed.features)) {
      return parsed.features;
    }
    if (parsed?.type === "Feature") {
      return [parsed as GeoJSONFeatureCollection["features"][number]];
    }
    if (parsed?.type === "Polygon" || parsed?.type === "MultiPolygon") {
      return [
        {
          type: "Feature",
          properties: {},
          geometry: parsed as GeoJSONFeatureCollection["features"][number]["geometry"],
        },
      ];
    }
  } catch {
    /* skip a bad polygon */
  }
  return [];
}

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

  const [[swLng, swLat], [neLng, neLat]] = CAMPUS_BOUNDS;

  const [selectedDest, setSelectedDest] = useState<number>(0);
  const [tripFrom, setTripFrom] = useState<TripEnd | null>({ kind: "gps" });
  const [tripTo, setTripTo] = useState<TripEnd | null>(null);
  const [campusEntrances, setCampusEntrances] = useState<CampusEntrance[]>([]);
  const [gpsFieldStatus, setGpsFieldStatus] = useState<
    "unknown" | "ready" | "unavailable"
  >("unknown");
  const [locatingSelf, setLocatingSelf] = useState(false);
  const [tripSearchOpen, setTripSearchOpen] = useState(false);
  const [destinations, setDestinations] = useState<MapDestination[]>([]);
  const [destinationsFirstLoadPending, setDestinationsFirstLoadPending] =
    useState(true);
  const [userPos, setUserPos] = useState<UserPos | null>(null);
  const [destPos, setDestPos] = useState<LngLat | null>(null);

  const [tracking, setTracking] = useState<boolean>(false);
  const [navigating, setNavigating] = useState<boolean>(false);
  const [mapReady, setMapReady] = useState<boolean>(false);

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

  const [routeDestPoly, setRouteDestPoly] =
    useState<GeoJSONFeatureCollection | null>(null);
  const [startBuildingPoly, setStartBuildingPoly] =
    useState<GeoJSONFeatureCollection | null>(null);
  const [tripParkingPoly, setTripParkingPoly] =
    useState<FeatureCollection<Polygon> | null>(null);

  const mapRef = useRef<MapRef | null>(null);
  const showZoomReadout = process.env.NODE_ENV !== "production";
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);
  const skipParkingRecalcRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const deviceHeadingRef = useRef<number | null>(null);
  const compassHandlerRef = useRef<
    ((e: DeviceOrientationEvent) => void) | null
  >(null);
  const routeCoordsRef = useRef<Array<[number, number]>>([]);
  const [routeCoords, setRouteCoords] = useState<Array<[number, number]>>([]);
  const [routeOutdoorSegments, setRouteOutdoorSegments] = useState<
    Array<Array<[number, number]>>
  >([]);
  const [routeModeSegments, setRouteModeSegments] = useState<
    import("@/lib/types/map").RouteModeSegment[]
  >([]);
  const [routePortals, setRoutePortals] = useState<
    Array<{ entry: [number, number]; exit: [number, number] }>
  >([]);
  const routeRequestIdRef = useRef(0);
  const buildingSelectRequestIdRef = useRef(0);
  const offRouteSinceRef = useRef<number | null>(null);
  const navigatingRef = useRef(false);
  const trackingRef = useRef(false);
  navigatingRef.current = navigating;
  trackingRef.current = tracking;
  const userPosRef = useRef<UserPos | null>(null);
  userPosRef.current = userPos;
  const tripFromRef = useRef(tripFrom);
  const tripToRef = useRef(tripTo);
  tripFromRef.current = tripFrom;
  tripToRef.current = tripTo;
  const lastGpsUiAtRef = useRef(0);
  const [routeEta, setRouteEta] = useState<{
    distanceMeters: number;
    durationSeconds: number;
    legs: RouteLegMetrics[];
  } | null>(null);
  const [routeSteps, setRouteSteps] = useState<NavStep[]>([]);
  const pendingCenterRef = useRef<{
    lng: number;
    lat: number;
    zoom: number;
  } | null>(null);
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
  /** null = auto (closest recommended lot). */
  const [preferredParkingLotId, setPreferredParkingLotId] = useState<
    number | null
  >(null);

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

  const routeDestinationIds = useMemo(() => {
    const stops = destinationStops.filter((id) => id > 0);
    if (stops.length > 0) return stops;
    return selectedDest > 0 ? [selectedDest] : [];
  }, [destinationStops, selectedDest]);

  const recommendedParkingLotIds = useMemo(() => {
    const ids = new Set<number>();
    for (const destId of routeDestinationIds) {
      const dest = destinations.find((d) => Number(d.id) === destId);
      if (!dest || dest.isParkingLot) continue;
      for (const lotId of dest.parkingLotIds ?? []) {
        if (lotId > 0) ids.add(lotId);
      }
    }
    return [...ids];
  }, [routeDestinationIds, destinations]);

  const parkingLotSelectItems = useMemo(
    () => [
      { value: 0, label: "Closest recommended" },
      ...recommendedParkingLotIds.map((id) => ({
        value: id,
        label:
          destinations.find((d) => Number(d.id) === id)?.name ?? `Lot ${id}`,
      })),
    ],
    [recommendedParkingLotIds, destinations],
  );

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

  const stageDetails =
    STAGE_DETAILS[mapStage] ?? STAGE_DETAILS[MAP_STAGES.IDLE];

  /** ---------------- PMTiles + Style ---------------- */

  const { baseStyle } = usePmtilesStyle({
    stylePath: mapStyle,
  });
  const { basemap, setBasemap, resolvedMapStyle, canRenderMap } =
    useBasemapStyle(baseStyle);

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
    const zoom = Math.max(map?.getZoom?.() ?? DEFAULT_ZOOM, minZoom);

    if (map && mapReady) {
      map.flyTo({ center: [lng, lat], zoom, essential: true });
    } else {
      pendingCenterRef.current = { lng, lat, zoom };
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

    const applyFix = (
      longitude: number,
      latitude: number,
      accuracy: number | undefined,
    ) => {
      const insideCampus =
        latitude > swLat &&
        latitude < neLat &&
        longitude > swLng &&
        longitude < neLng;

      if (insideCampus || forceCenter) {
        setUserPos({ lng: longitude, lat: latitude, accuracy });
        setGpsFieldStatus("ready");
        ensureCenter(longitude, latitude, 16);
        setMapStage((stage) => {
          if (stage === MAP_STAGES.ROUTE) return MAP_STAGES.ROUTE;
          if (selectedDest) return MAP_STAGES.BUILDING;
          return MAP_STAGES.IDLE;
        });
      }
    };

    // Fast cached fix first, then refine with a fresh high-accuracy reading.
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude, accuracy } = position.coords;
        applyFix(longitude, latitude, accuracy);
      },
      () => {},
      { enableHighAccuracy: false, timeout: 1500, maximumAge: 60_000 },
    );
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude, accuracy } = position.coords;
        applyFix(longitude, latitude, accuracy);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  }

  /** -------- Building load + selection -------- */

  async function showBuilding(id: number) {
    if (!id) {
      setDestPos(null);
      setMapStage(MAP_STAGES.IDLE);
      return;
    }

    const reqId = ++buildingSelectRequestIdRef.current;

    try {
      let curDestination: MapDestination | undefined = destinations.find(
        (cur) => cur.id === id,
      );
      if (!curDestination)
        return toast.error("Could not find the current destination.");

      if (!curDestination.polygon) {
        const destReq = await fetch(
          withBasePath(`/api/destination?id=${encodeURIComponent(id)}`),
        );
        if (reqId !== buildingSelectRequestIdRef.current) return;
        if (!destReq.ok) {
          toast.error("Building details did not load.");
          return;
        }
        const destPayload = await destReq.json().catch(() => null);
        if (reqId !== buildingSelectRequestIdRef.current) return;
        const full = Array.isArray(destPayload?.destinations)
          ? (destPayload.destinations[0] as MapDestination | undefined)
          : undefined;
        if (!full) {
          toast.error("Building details did not load.");
          return;
        }
        curDestination = { ...curDestination, ...full };
        setDestinations((prev) =>
          prev.map((d) => (d.id === id ? { ...d, polygon: full.polygon } : d)),
        );
      }

      try {
        if (curDestination.polygon) JSON.parse(curDestination.polygon);
      } catch {
        toast.error("Building has no boundary data.");
      }
      if (reqId !== buildingSelectRequestIdRef.current) return;

      const req = await fetch(
        withBasePath(
          `/api/destination/outsideNode?id=${encodeURIComponent(id)}`,
        ),
      );
      if (reqId !== buildingSelectRequestIdRef.current) return;
      if (!req.ok) {
        toast.error("Building entrances did not load.");
        return;
      }
      const resp = await req.json().catch(() => null);
      if (reqId !== buildingSelectRequestIdRef.current) return;
      if (!resp) {
        toast.error("Building entrances did not load.");
        return;
      }

      const bnid = resp?.nodes ?? [];
      const details: Array<{ id: number; lat: number; lng: number }> =
        Array.isArray(resp?.nodeDetails) ? resp.nodeDetails : [];
      setBuildingNodes(new Set(bnid));
      setBuildingMarkers(details);

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
      setRouteOutdoorSegments([]);
      setRouteModeSegments([]);
      setRoutePortals([]);
      setRouteEta(null);
      setTripParkingPoly(null);

      setMapStage(MAP_STAGES.BUILDING);
    } catch (err) {
      if (reqId !== buildingSelectRequestIdRef.current) return;
      console.error("Building lookup failed", err);
      toast.error("Unable to locate that building right now.");
    }
  }

  function handleClearDestination() {
    if (tracking) stopTracking();
    setTripFrom({ kind: "gps" });
    setTripTo(null);
    setGpsFieldStatus(userPosRef.current ? "ready" : "unknown");
    setSelectedDest(0);
    setDestinationStops([]);
    setPreferredParkingLotId(null);
    setStopsEditorOpen(false);
    setDestPos(null);
    setBuildingNodes(new Set());
    setBuildingMarkers([]);
    setPath(PATH_RESET);
    setNavigating(false);
    routeCoordsRef.current = [];
    setRouteCoords([]);
    setRouteOutdoorSegments([]);
    setRouteModeSegments([]);
    setRoutePortals([]);
    setRouteEta(null);
    setTripParkingPoly(null);
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
    setTripTo({ kind: "place", id });
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
      const req = await fetch(withBasePath("/api/favorites"));
      if (req.status !== 200) return;
      const data = (await req.json()) as { favorites?: FavoriteRow[] };
      setFavorites(data.favorites ?? []);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadChains() {
    try {
      const req = await fetch(withBasePath("/api/destination-chains"));
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
        const req = await fetch(
          withBasePath(
            `/api/favorites?destinationId=${encodeURIComponent(destId)}`,
          ),
          { method: "DELETE" },
        );
        if (req.status !== 200) throw new Error("remove failed");
        setFavorites((prev) => prev.filter((f) => f.id !== destId));
        toast.success("Building removed from favorites");
      } else {
        const req = await fetch(withBasePath("/api/favorites"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destinationId: destId,
          }),
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
    setTripTo({ kind: "place", id: lastId });
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
      const req = await fetch(withBasePath("/api/destination-chains"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          destinationIds: destinationStops,
        }),
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
  }

  /** -------- Route actions -------- */

  async function loadTripParkingPolys(legs: RouteLegMetrics[]) {
    const parkingIds = [
      ...new Set(
        legs
          .filter((l) => l.kind === "parking")
          .map((l) => l.destinationId)
          .filter((id) => id > 0),
      ),
    ];
    if (parkingIds.length === 0) {
      setTripParkingPoly(null);
      return;
    }

    const features = [];
    for (const id of parkingIds) {
      let dest = destinations.find((d) => d.id === id);
      if (!dest?.polygon) {
        try {
          const res = await fetch(
            withBasePath(`/api/destination?id=${encodeURIComponent(id)}`),
          );
          if (!res.ok) continue;
          const payload = await res.json().catch(() => null);
          const full = Array.isArray(payload?.destinations)
            ? (payload.destinations[0] as MapDestination | undefined)
            : undefined;
          if (!full?.polygon) continue;
          dest = { ...(dest ?? full), ...full };
          setDestinations((prev) => {
            const exists = prev.some((d) => d.id === id);
            if (exists) {
              return prev.map((d) =>
                d.id === id ? { ...d, polygon: full.polygon } : d,
              );
            }
            return [...prev, dest!];
          });
        } catch {
          continue;
        }
      }
      if (!dest?.polygon) continue;
      features.push(...featuresFromDestinationPolygon(dest.polygon, id));
    }

    setTripParkingPoly(
      features.length > 0
        ? { type: "FeatureCollection", features }
        : null,
    );
  }

  async function getRoute(
    gpsOverride?: { lat: number; lng: number },
  ): Promise<Path | null | "stale"> {
    const from = gpsOverride ? ({ kind: "gps" } as const) : tripFromRef.current;
    const to = tripToRef.current;
    const pos = gpsOverride ?? userPosRef.current;
    const built = buildNavigatePayload({
      from,
      to,
      viaPlaceIds: destinationStops,
      gps: pos,
      navConditions: curNavConditions,
      preferredParkingLotId,
    });
    if (!built.ok) {
      if (built.reason === "same") {
        toast.error("Start and destination are the same.");
      } else if (built.reason === "gps") {
        toast.error(
          "Location unavailable. Pick a place or a campus entrance instead.",
        );
      } else {
        toast.error("Choose a start and a destination.");
      }
      return null;
    }
    const payload = built.body;

    const reqId = ++routeRequestIdRef.current;
    const req = await fetch(withBasePath("/api/map/navigateTo"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (reqId !== routeRequestIdRef.current) return "stale";
    const resp = (await req.json().catch(() => ({}))) as NavigateToResponse & {
      error?: string;
    };
    if (reqId !== routeRequestIdRef.current) return "stale";
    if (req.status !== 200) {
      toast.error(resp?.error ?? "Failed to build route.");
      return null;
    }
    if (!Array.isArray(resp?.path) || resp.path.length === 0) {
      toast.error("No route found for that selection.");
      return null;
    }
    const orderedPath = resp.path;
    const pnids: Set<number> = new Set(orderedPath);
    const firstNodeId = resp.firstNodeId ?? orderedPath[0];
    const lastNodeId = resp.lastNodeId ?? orderedPath[orderedPath.length - 1];
    if (!lastNodeId || !firstNodeId || pnids.size === 0) {
      toast.error("No route found for that selection.");
      return null;
    }
    const coords = resp.geometry?.coordinates ?? [];
    routeCoordsRef.current = coords;
    setRouteCoords(coords);
    setRouteOutdoorSegments(
      Array.isArray(resp.geometry?.outdoorSegments)
        ? resp.geometry.outdoorSegments
        : coords.length >= 2
          ? [coords]
          : [],
    );
    setRouteModeSegments(
      Array.isArray(resp.geometry?.modeSegments)
        ? resp.geometry.modeSegments
        : [],
    );
    setRoutePortals(
      Array.isArray(resp.geometry?.portals) ? resp.geometry.portals : [],
    );
    offRouteSinceRef.current = null;
    if (
      typeof resp.distanceMeters === "number" &&
      typeof resp.durationSeconds === "number"
    ) {
      setRouteEta({
        distanceMeters: resp.distanceMeters,
        durationSeconds: resp.durationSeconds,
        legs: Array.isArray(resp.legs) ? resp.legs : [],
      });
      void loadTripParkingPolys(
        Array.isArray(resp.legs) ? resp.legs : [],
      );
    } else {
      setRouteEta(null);
      setTripParkingPoly(null);
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

  async function showRoute(gpsOverride?: {
    lat: number;
    lng: number;
  }): Promise<boolean> {
    try {
      const curPath = await getRoute(gpsOverride);
      if (curPath === "stale") return true;
      if (!curPath) return false;
      setPath(curPath);
      setNavigating(true);
      if (!trackingRef.current) {
        setTracking(false);
        setMapStage(MAP_STAGES.ROUTE);
        setSheetPosition(effectiveSheetPeek);
      }
      setZoomed(true);
      return true;
    } catch (err) {
      console.error("Route lookup failed", err);
      toast.error("Failed to build route. Please try again.");
      return false;
    }
  }

  const showRouteRef = useRef(showRoute);
  showRouteRef.current = showRoute;
  const destinationStopsKey = destinationStops.join(",");
  const prevDestinationStopsKeyRef = useRef(destinationStopsKey);
  useEffect(() => {
    const prevKey = prevDestinationStopsKeyRef.current;
    prevDestinationStopsKeyRef.current = destinationStopsKey;
    if (!navigating) return;
    if (destinationStopsKey.length === 0) return;
    // Only when the stop list/order changes — not when navigation first starts.
    if (prevKey === destinationStopsKey) return;
    const t = window.setTimeout(() => {
      void showRouteRef.current();
    }, 300);
    return () => window.clearTimeout(t);
  }, [destinationStopsKey, navigating]);

  useEffect(() => {
    if (preferredParkingLotId == null) return;
    if (!recommendedParkingLotIds.includes(preferredParkingLotId)) {
      setPreferredParkingLotId(null);
    }
  }, [recommendedParkingLotIds, preferredParkingLotId]);

  const prevPreferredParkingLotIdRef = useRef(preferredParkingLotId);
  useEffect(() => {
    const prev = prevPreferredParkingLotIdRef.current;
    prevPreferredParkingLotIdRef.current = preferredParkingLotId;
    if (skipParkingRecalcRef.current) {
      skipParkingRecalcRef.current = false;
      return;
    }
    if (!navigating || tracking) return;
    if (!curNavConditions.is_vehicular) return;
    if (prev === preferredParkingLotId) return;
    const t = window.setTimeout(() => {
      void (async () => {
        const ok = await showRouteRef.current();
        if (!ok) {
          skipParkingRecalcRef.current = true;
          setPreferredParkingLotId(prev);
        }
      })();
    }, 200);
    return () => window.clearTimeout(t);
  }, [
    preferredParkingLotId,
    navigating,
    tracking,
    curNavConditions.is_vehicular,
  ]);

  const startPlaceId = tripFrom?.kind === "place" ? tripFrom.id : 0;
  const startPolygonRaw =
    destinations.find((d) => Number(d.id) === startPlaceId)?.polygon ?? "";
  useEffect(() => {
    if (!startPlaceId) {
      setStartBuildingPoly(null);
      return;
    }
    if (startPolygonRaw) {
      try {
        setStartBuildingPoly(
          JSON.parse(startPolygonRaw) as GeoJSONFeatureCollection,
        );
      } catch {
        setStartBuildingPoly(null);
      }
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          withBasePath(
            `/api/destination?id=${encodeURIComponent(startPlaceId)}`,
          ),
        );
        if (!res.ok || cancelled) return;
        const payload = await res.json().catch(() => null);
        const full = Array.isArray(payload?.destinations)
          ? (payload.destinations[0] as MapDestination | undefined)
          : undefined;
        if (!full?.polygon || cancelled) return;
        setDestinations((prev) =>
          prev.map((d) =>
            Number(d.id) === startPlaceId ? { ...d, polygon: full.polygon } : d,
          ),
        );
        setStartBuildingPoly(
          JSON.parse(full.polygon) as GeoJSONFeatureCollection,
        );
      } catch {
        if (!cancelled) setStartBuildingPoly(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [startPlaceId, startPolygonRaw]);

  const routeHighlightKey = routeDestinationIds
    .filter((id) => id > 0 && id !== startPlaceId)
    .map((id) => {
      const polygon = destinations.find((d) => Number(d.id) === id)?.polygon;
      return `${id}:${polygon ? "1" : "0"}`;
    })
    .join(",");
  useEffect(() => {
    const ids = routeHighlightKey
      .split(",")
      .filter(Boolean)
      .map((part) => Number(part.split(":")[0]))
      .filter((id) => id > 0);
    if (ids.length === 0) {
      setRouteDestPoly(null);
      return;
    }
    const features = ids.flatMap((id) => {
      const polygon = destinations.find((d) => Number(d.id) === id)?.polygon;
      return polygon ? storedPolygonFeatures(polygon) : [];
    });
    setRouteDestPoly(
      features.length > 0
        ? { type: "FeatureCollection", features }
        : null,
    );
    const missing = ids.filter(
      (id) => !destinations.find((d) => Number(d.id) === id)?.polygon,
    );
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const id of missing) {
        if (cancelled) return;
        try {
          const res = await fetch(
            withBasePath(`/api/destination?id=${encodeURIComponent(id)}`),
          );
          if (!res.ok || cancelled) continue;
          const payload = await res.json().catch(() => null);
          const full = Array.isArray(payload?.destinations)
            ? (payload.destinations[0] as MapDestination | undefined)
            : undefined;
          if (!full?.polygon || cancelled) continue;
          setDestinations((prev) =>
            prev.map((d) =>
              Number(d.id) === id ? { ...d, polygon: full.polygon } : d,
            ),
          );
        } catch {
          /* the next change retries */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [destinations, routeHighlightKey]);

  async function recalcRouteForNavMode() {
    const ok = await showRoute();
    if (ok) return;
    setNavigating(false);
    setPath(PATH_RESET);
    routeCoordsRef.current = [];
    setRouteCoords([]);
    setRouteOutdoorSegments([]);
    setRouteModeSegments([]);
    setRoutePortals([]);
    setRouteEta(null);
    setRouteSteps([]);
    setMapStage(
      selectedDest > 0 ? MAP_STAGES.BUILDING : MAP_STAGES.IDLE,
    );
  }

  async function startTracking() {
    if (path.firstNodeId < 0)
      return toast.error("Show a route before live navigation.");
    if (!userPos)
      return toast.error("Allow location to follow the route live.");

    const firstNode =
      path.startNode ??
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
        const { longitude, latitude, heading, accuracy } = pos.coords;
        const nextPos = {
          lng: longitude,
          lat: latitude,
          heading,
          accuracy,
        };
        userPosRef.current = nextPos;
        if (
          !shouldPublishGpsUi(
            lastGpsUiAtRef.current,
            Date.now(),
            GPS_NAV_UI_INTERVAL_MS,
          )
        ) {
          return;
        }
        lastGpsUiAtRef.current = Date.now();
        setUserPos((up) => (up ? { ...up, ...nextPos } : nextPos));

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

        const MIN_OFF_ROUTE_M = 25;
        const OFF_ROUTE_DEBOUNCE_MS = 2500;
        const coords = routeCoordsRef.current;
        if (
          trackingRef.current &&
          navigatingRef.current &&
          coords.length >= 2
        ) {
          const dist = distanceToPolylineMeters(longitude, latitude, coords);
          const threshold = Math.max(accuracy ?? 0, MIN_OFF_ROUTE_M);
          if (dist > threshold) {
            if (offRouteSinceRef.current == null) {
              offRouteSinceRef.current = Date.now();
            } else if (
              Date.now() - offRouteSinceRef.current >=
              OFF_ROUTE_DEBOUNCE_MS
            ) {
              offRouteSinceRef.current = null;
              void showRoute({ lat: latitude, lng: longitude });
            }
          } else {
            offRouteSinceRef.current = null;
          }
        }
      },
      (err) => {
        toast.error(err.message || "Tracking error");
        endLiveFollow();
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        // Allow reused fixes so the browser queries GPS less often during nav.
        maximumAge: GPS_NAV_UI_INTERVAL_MS,
      },
    );

    watchIdRef.current = id;
    setTracking(true);
    setMapStage(MAP_STAGES.TRACKING);
  }

  function endLiveFollow() {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setTracking(false);
    setNavigating(true);
    setMapStage(MAP_STAGES.ROUTE);
    disableCompass();
    const map = mapRef.current?.getMap?.();
    map?.easeTo({ bearing: 0, pitch: 0, duration: 400, essential: true });
    if (routeCoordsRef.current.length >= 2) {
      fitToUserAndDest(routeCoordsRef.current, { duration: 600 });
    }
  }

  function stopTracking() {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    const map = mapRef.current?.getMap?.();
    map?.flyTo({
      center: [defViewState.longitude, defViewState.latitude],
      zoom: defViewState.zoom,
      bearing: 0,
      pitch: 0,
      duration: 900,
      essential: true,
    });
    routeCoordsRef.current = [];
    setRouteCoords([]);
    setRouteOutdoorSegments([]);
    setRouteModeSegments([]);
    setRoutePortals([]);

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
      const req = await fetch(
        withBasePath("/api/destination?navigatableOnly=1"),
      );
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
    void fetch(withBasePath("/api/map/campusEntrance"))
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data?.entrances)) setCampusEntrances(data.entrances);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // Recalculate route if user is previewing a route and nav mode changes
    const isViewingRoute =
      mapStage === MAP_STAGES.ROUTE && navigating && !tracking;

    if (!isViewingRoute) return;
    const from = tripFromRef.current;
    const to = tripToRef.current;
    if (!from || !to) return;
    if ((tripEndNeedsGps(from) || tripEndNeedsGps(to)) && !userPosRef.current) {
      return;
    }

    void recalcRouteForNavMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curNavConditions]);

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
        showCampusOverview();
        setZoomed(false);
        return;
      }
    }
  }

  function requestGpsFix(): Promise<UserPos | null> {
    return new Promise((resolve) => {
      if (!("geolocation" in navigator) || !window.isSecureContext) {
        resolve(null);
        return;
      }
      let settled = false;
      const finish = (pos: UserPos | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(pos);
      };
      const timer = window.setTimeout(() => finish(null), 8000);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { longitude, latitude, accuracy } = position.coords;
          finish({ lng: longitude, lat: latitude, accuracy });
        },
        () => finish(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
      );
    });
  }

  async function locateMe() {
    if (locatingSelf) return;
    setLocatingSelf(true);
    const existing = userPosRef.current;
    if (existing) ensureCenter(existing.lng, existing.lat, 16);
    try {
      const fix = await requestGpsFix();
      if (!fix) {
        toast.error("Could not get your location.");
        return;
      }
      setUserPos(fix);
      userPosRef.current = fix;
      setGpsFieldStatus("ready");
      ensureCenter(fix.lng, fix.lat, 16);
    } finally {
      setLocatingSelf(false);
    }
  }

  function dropRoutePreview(nextStage?: MapStage) {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setTracking(false);
    setNavigating(false);
    setPath(PATH_RESET);
    routeCoordsRef.current = [];
    setRouteCoords([]);
    setRouteOutdoorSegments([]);
    setRouteModeSegments([]);
    setRoutePortals([]);
    setRouteEta(null);
    setRouteSteps([]);
    navProgress.resetProgress();
    disableCompass();
    setMapStage(
      nextStage ??
        (selectedDest > 0 ? MAP_STAGES.BUILDING : MAP_STAGES.IDLE),
    );
  }

  function focusEntrance(end: Extract<TripEnd, { kind: "entrance" }>) {
    const row = campusEntrances.find((item) => item.id === end.id);
    if (!row) return;
    setDestPos({ lat: row.lat, lng: row.lng });
    ensureCenter(row.lng, row.lat, 16);
  }

  function onFromChange(end: TripEnd | null) {
    dropRoutePreview();
    setTripFrom(end);
    if (!end || end.kind === "gps") return;
    if (end.kind === "place") {
      const place = destinations.find((d) => Number(d.id) === end.id);
      if (place) ensureCenter(place.lng, place.lat, 16);
      return;
    }
    focusEntrance(end);
  }

  function onToChange(end: TripEnd | null) {
    if (!end) {
      dropRoutePreview(MAP_STAGES.IDLE);
      setTripTo(null);
      setSelectedDest(0);
      setDestinationStops([]);
      setPreferredParkingLotId(null);
      setDestPos(null);
      setBuildingNodes(new Set());
      setBuildingMarkers([]);
      return;
    }
    if (tripFrom && sameTripEnd(tripFrom, end)) {
      toast.error("Start and destination are the same.");
      return;
    }
    if (end.kind === "place") {
      void handleDestinationChange(end.id);
      return;
    }
    dropRoutePreview(MAP_STAGES.BUILDING);
    setTripTo(end);
    setSelectedDest(0);
    setDestinationStops([]);
    setPreferredParkingLotId(null);
    setSheetPosition(0);
    setZoomed(true);
    if (end.kind === "entrance") focusEntrance(end);
  }

  function swapEnds() {
    const nextFrom = tripTo;
    const nextTo = tripFrom;
    if (nextFrom && nextTo && sameTripEnd(nextFrom, nextTo)) return;
    setTripFrom(nextFrom);
    if (nextTo?.kind === "place") {
      void handleDestinationChange(nextTo.id);
      return;
    }
    dropRoutePreview(nextTo ? MAP_STAGES.BUILDING : MAP_STAGES.IDLE);
    setTripTo(nextTo);
    setSelectedDest(0);
    setDestinationStops([]);
    setPreferredParkingLotId(null);
    if (nextTo?.kind === "entrance") {
      setSheetPosition(0);
      focusEntrance(nextTo);
      return;
    }
    setDestPos(null);
    setBuildingNodes(new Set());
    setBuildingMarkers([]);
  }

  async function handelTheButton() {
    if (!navigating && !tracking) {
      if (!tripFrom || !tripTo) {
        toast.error("Choose a start and a destination.");
        return;
      }
      if (sameTripEnd(tripFrom, tripTo)) {
        toast.error("Start and destination are the same.");
        return;
      }
      if (
        (tripEndNeedsGps(tripFrom) || tripEndNeedsGps(tripTo)) &&
        !userPosRef.current
      ) {
        const fix = await requestGpsFix();
        if (!fix) {
          setGpsFieldStatus("unavailable");
          toast.error(
            "Location unavailable. Pick a place or a campus entrance instead.",
          );
          return;
        }
        setUserPos(fix);
        userPosRef.current = fix;
        setGpsFieldStatus("ready");
      }
      await showRoute();
      return;
    }

    if (navigating) {
      if (tracking) {
        setSheetPosition(0);
        endLiveFollow();
      } else {
        setSheetPosition(effectiveSheetPeek);
        startTracking();
      }
    }
  }

  const sheetVisible =
    selectedDest > 0 || navigating || tripTo != null;

  /** ---------------- Render ---------------- */

  return (
    <main
      id="main-content"
      className={`relative w-full bg-background text-foreground ${mapPageClass}`}
    >
      <h1 className="sr-only">IC Maps &ndash; Campus Navigation</h1>

      {/* Top brand + search bar */}
      <div
        className={`absolute inset-x-3 top-0 ${tripSearchOpen ? "z-40" : "z-30"} ${safeAreaTopClass} md:left-1/2 md:w-[720px] md:-translate-x-1/2`}
      >
        <div className="flex w-full items-stretch gap-2">
          <TripEndsFields
            from={tripFrom}
            to={tripTo}
            places={destinations.map((d) => ({
              id: Number(d.id),
              name: d.name,
            }))}
            entrances={campusEntrances}
            onFromChange={onFromChange}
            onToChange={onToChange}
            onSwap={swapEnds}
            gpsStatus={gpsFieldStatus}
            onRetryGps={() => void locateMe()}
            showAddStop={
              tripFrom?.kind === "place" && tripTo?.kind === "place"
            }
            stopCount={destinationStops.length}
            onAddStop={openStopsEditor}
            disabled={
              destinationsFirstLoadPending && destinations.length === 0
            }
            onSearchOpenChange={setTripSearchOpen}
            leading={
              <EditorToolsMenu
                isAdmin={isAdmin}
                isIcUser={isIcUser}
                isSignedIn={isSignedIn}
                devMode={devMode}
                userName={realSession?.user.name}
                basemap={basemap}
                onBasemapChange={setBasemap}
                chipLabel="Menu"
                chipClassName={`${mapBarActionClass} border-r border-border`}
              />
            }
          />

          {showZoomReadout ? (
            <div
              className={`${mapChromeClass} hidden min-h-11 shrink-0 items-center justify-center rounded-2xl px-2 font-mono text-xs tabular-nums sm:inline-flex`}
              aria-live="polite"
              title="Zoom readout"
            >
              z{mapZoom.toFixed(2)}
            </div>
          ) : null}
        </div>
      </div>

      {showZoomReadout ? (
        <div
          className={`${mapHeaderChipClass} pointer-events-none absolute right-3 z-20 top-[calc(env(safe-area-inset-top,0px)+15.75rem)] px-2 font-mono text-[11px] tabular-nums sm:hidden`}
          aria-live="polite"
          title="Zoom readout"
        >
          z{mapZoom.toFixed(2)}
        </div>
      ) : null}

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

      {!tracking && !tripSearchOpen ? (
        <div
          className={`absolute inset-x-3 z-30 ${mapModeRowOffsetClass} space-y-2 md:left-1/2 md:w-[720px] md:-translate-x-1/2`}
        >
          <div
            role="radiogroup"
            aria-label="Navigation mode"
            className="flex justify-center gap-2 overflow-x-auto pb-1 no-scrollbar"
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

      <button
        type="button"
        className={`fixed right-3 z-40 ${mapFloatingActionClass} disabled:opacity-60`}
        style={{
          bottom: sheetVisible
              ? `calc((1 - ${sheetPosition}) * (100dvh - max(4.75rem, env(safe-area-inset-top) + 3.5rem)) + 4.75rem)`
              : "calc(env(safe-area-inset-bottom, 0px) + 1rem)",
        }}
        onClick={() => void locateMe()}
        disabled={locatingSelf}
        aria-label="Locate me"
      >
        <LocateFixed
          className={locatingSelf ? "animate-pulse" : undefined}
          size={22}
        />
      </button>

      <MapBottomSheet
        hidden={!sheetVisible}
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
          ) : tripTo ? (
            <p className="w-full truncate text-center text-lg font-semibold">
              {tripTo.kind === "gps"
                ? "Current location"
                : tripTo.kind === "entrance"
                  ? (campusEntrances.find((row) => row.id === tripTo.id)?.name ??
                    "Campus entrance")
                  : "Destination"}
            </p>
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
        {curNavConditions.is_vehicular &&
        !tracking &&
        recommendedParkingLotIds.length > 0 ? (
          <div
            className={`mx-auto mt-3 mb-2 w-full max-w-md rounded-2xl border px-3 py-3 ${borderMutedClass} ${surfaceSubtleClass}`}
          >
            <p className="mb-2 text-center text-sm font-semibold">
              {recommendedParkingLotIds.length === 1
                ? `Parking lot: ${
                    destinations.find(
                      (d) => Number(d.id) === recommendedParkingLotIds[0],
                    )?.name ?? "Recommended lot"
                  }`
                : "Parking lot"}
            </p>
            {recommendedParkingLotIds.length > 1 ? (
            <>
            <ComboboxSelect
              placeholder="Choose parking lot"
              value={preferredParkingLotId ?? 0}
              items={parkingLotSelectItems}
              onChange={(value) => {
                setPreferredParkingLotId(value === 0 ? null : value);
              }}
              widthClassName="w-full"
              searchPlaceholder="Search parking…"
            />
            <p className="mt-2 text-center text-xs text-panel-muted-foreground">
              Changing the lot recalculates drive then walk to your building.
            </p>
            </>
            ) : null}
          </div>
        ) : null}

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

            {destinationStops.length > 1 &&
            tripFrom?.kind === "place" &&
            tripTo?.kind === "place" ? (
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
        startPlaceId={tripFrom?.kind === "place" ? tripFrom.id : null}
        onStartPlaceChange={(id) => onFromChange({ kind: "place", id })}
        onStopsChange={(next) => {
          setDestinationStops(next);
          if (next.length > 0) {
            const lastId = next[next.length - 1]!;
            setSelectedDest(lastId);
            setTripTo({ kind: "place", id: lastId });
          }
        }}
        onPickDestination={(id, index) => {
          if (tripFrom?.kind === "place" && index === 0) return;
          void handleStopPick(id);
        }}
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
            initialViewState={defViewState}
            mapLib={maplibregl}
            mapStyle={resolvedMapStyle as any}
            onMove={
              showZoomReadout
                ? (e) => setMapZoom(e.viewState.zoom)
                : undefined
            }
            onLoad={() => {
              setMapReady(true);
              const map = mapRef.current?.getMap?.();
              map?.on("error", (e: any) => {
                console.error("[maplibre error]", e?.error ?? e);
              });
              if (map && showZoomReadout) setMapZoom(map.getZoom());
              const attrib = map
                ?.getContainer?.()
                ?.querySelector?.(".maplibregl-ctrl-attrib");
              if (
                attrib &&
                (map?.getCanvasContainer?.()?.offsetWidth ?? 0) <= 640
              ) {
                attrib.classList.remove("maplibregl-compact-show");
                attrib.removeAttribute("open");
              }
              const pending = pendingCenterRef.current;
              if (pending && map) {
                pendingCenterRef.current = null;
                map.flyTo({
                  center: [pending.lng, pending.lat],
                  zoom: pending.zoom,
                  essential: true,
                });
              }
            }}
          >
            {buildingNodesFC && !navigating && (
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

            {(routeOutdoorSegments.length > 0 ||
              routePortals.length > 0 ||
              routeCoords.length >= 2) && (
              <RoutePathLayer
                coordinates={routeCoords}
                segments={routeOutdoorSegments}
                modeSegments={routeModeSegments}
                portals={routePortals}
              />
            )}

            <TripStopMarkers stops={tripStopMarkers} />

            {accuracyGeoJSON && (
              <AccuracyRingLayer data={accuracyGeoJSON} isDark={isDark} />
            )}

            {startPlaceId > 0 &&
            startPlaceId !== selectedDest &&
            startBuildingPoly ? (
              <Source
                id="start-boundary"
                type="geojson"
                data={startBuildingPoly as any}
              >
                <Layer
                  id="start-boundary-fill"
                  type="fill"
                  paint={{
                    "fill-color": "#FFB81C",
                    "fill-opacity": 0.35,
                  }}
                />
                <Layer
                  id="start-boundary-outline"
                  type="line"
                  paint={{
                    "line-color": "#FFB81C",
                    "line-width": 2,
                  }}
                />
              </Source>
            ) : null}

            {routeDestPoly ? (
              <Source
                id="route-dest-boundaries"
                type="geojson"
                data={routeDestPoly as any}
              >
                <Layer
                  id="route-dest-boundaries-fill"
                  type="fill"
                  paint={{
                    "fill-color": "#35D5A4",
                    "fill-opacity": 0.2,
                  }}
                />
                <Layer
                  id="route-dest-boundaries-outline"
                  type="line"
                  paint={{
                    "line-color": "#35D5A4",
                    "line-width": 2,
                  }}
                />
              </Source>
            ) : null}

            <TripParkingHighlight data={tripParkingPoly} />

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
