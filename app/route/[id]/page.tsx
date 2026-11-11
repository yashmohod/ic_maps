"use client";

import React, { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { withBasePath } from "@/lib/base-path";
import {
  Map as ReactMap,
  Marker,
  type MapRef,
} from "@vis.gl/react-maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { toast } from "sonner";
import { useParams } from "next/navigation";
import maplibregl from "maplibre-gl";
import {
  CheckIcon,
  Maximize2,
  Minimize2,
  Navigation,
  NavigationOff,
  Route,
  XIcon,
} from "lucide-react";

import { Toggle } from "@/components/ui/toggle";
import { Slider } from "@/components/ui/slider";

import { useMapStyle } from "@/hooks/use-map-style";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";
import { useBasemapStyle } from "@/hooks/use-basemap";
import { BasemapToggle } from "@/components/basemap-toggle";
import {
  CAMPUS_BOUNDS,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
} from "@/lib/map-constants";
import { HomeLogoLink } from "@/components/home-logo-link";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import type { NavConditions } from "@/lib/navigation";
import {
  bearingTo,
  distanceToPolylineMeters,
  makeCircleGeoJSON,
  shouldPublishGpsUi,
} from "@/lib/geo";
import {
  surfaceSubtleClass,
  borderMutedClass,
  mapFloatingActionClass,
  mapSheetPeekMinVisibleCompactPx,
  mapSheetPeekMinVisiblePx,
  mapSheetToolbarOverlapPx,
} from "@/lib/panel-classes";
import type {
  LngLat,
  UserPos,
  GeoJSONFeatureCollection,
  NavigateToResponse,
  RouteLegMetrics,
} from "@/lib/types/map";
import {
  formatRouteDistance,
  formatRouteEtaSummary,
  formatRouteDuration,
} from "@/lib/distance-display";
import { useNavigationProgress } from "@/hooks/use-navigation-progress";

import { TripEndsFields } from "@/components/TripEndsFields";
import ComboboxSelect from "@/components/ComboboxSelect";
import { MapBottomSheet } from "@/components/MapBottomSheet";
import { NavigationNextTurnBanner } from "@/components/NavigationNextTurnBanner";
import { NavigationStepsPanel } from "@/components/NavigationStepsPanel";
import { RoutePathLayer } from "@/components/RoutePathLayer";
import { AccuracyRingLayer } from "@/components/AccuracyRingLayer";
import {
  TripParkingHighlight,
  featuresFromDestinationPolygon,
} from "@/components/TripParkingHighlight";
import type { FeatureCollection, Polygon } from "geojson";
import type { NavStep } from "@/lib/navigation-types";
import { useDistanceUnits } from "@/hooks/use-distance-units";
import {
  buildNavigatePayload,
  sameTripEnd,
  tripEndNeedsGps,
  type CampusEntrance,
  type TripEnd,
} from "@/lib/trip-end";

const MAX_INCLINE = 45;
const SHARE_SHEET_PEEK = 0.7;
const SHARE_SHEET_SNAP_POINTS = [0, SHARE_SHEET_PEEK];

export default function ShareRouteNavigatePage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const routeIdRaw = params?.id ?? "";

  const defViewState = useMemo(
    () => ({
      longitude: DEFAULT_CENTER.lng as number,
      latitude: DEFAULT_CENTER.lat as number,
      zoom: DEFAULT_ZOOM,
      bearing: 0,
      pitch: 0,
    }),
    [],
  );

  const mapRef = useRef<MapRef | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const pendingCenterRef = useRef<{
    lng: number;
    lat: number;
    zoom: number;
  } | null>(null);

  const { isDark, mapStyle } = useMapStyle();
  const { baseStyle } = usePmtilesStyle({ stylePath: mapStyle });
  const { basemap, setBasemap, resolvedMapStyle, canRenderMap } =
    useBasemapStyle(baseStyle);

  type LotChoice = {
    id: number;
    name: string;
    lat?: number;
    lng?: number;
  };

  type RouteInfo = {
    name: string;
    destinationId: number;
    destinationName: string;
    parkingLots: LotChoice[];
    campusEntrances: CampusEntrance[];
    recommendedParkingLots: LotChoice[];
  } | null;

  const [routeInfo, setRouteInfo] = useState<RouteInfo>(null);
  const [routeLoadPending, setRouteLoadPending] = useState(true);
  const [tripFrom, setTripFrom] = useState<TripEnd | null>({ kind: "gps" });
  const [tripTo, setTripTo] = useState<TripEnd | null>(null);
  const [gpsStatus, setGpsStatus] = useState<
    "unknown" | "ready" | "unavailable"
  >("unknown");
  const [preferredParkingLotId, setPreferredParkingLotId] = useState<
    number | null
  >(null);
  const tripFromRef = useRef(tripFrom);
  const tripToRef = useRef(tripTo);
  tripFromRef.current = tripFrom;
  tripToRef.current = tripTo;

  const [curNavConditions, setCurNavConditions] = useState<NavConditions>({
    is_pedestrian: true,
    is_vehicular: false,
    is_through_building: true,
    is_avoid_stairs: false,
    is_incline_limit: false,
    max_incline: 0,
  });

  async function loadRoute() {
    if (!routeIdRaw) {
      setRouteLoadPending(false);
      return;
    }
    setRouteLoadPending(true);
    try {
      const res = await fetch(
        withBasePath(
          `/api/shareableroute?id=${encodeURIComponent(routeIdRaw)}`,
        ),
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? "Route not found.");
        setRouteInfo(null);
        return;
      }
      const firstDest =
        data.destinations?.find(
          (d: { isParkingLot?: boolean }) => !d.isParkingLot,
        ) ?? data.destinations?.[0];
      if (!firstDest?.id) {
        toast.error("This route has no destination.");
        setRouteInfo(null);
        return;
      }
      const mapLots = (
        rows: Array<{ id: number; name: string; lat?: number; lng?: number }>,
      ) =>
        rows.map((p) => ({
          id: Number(p.id),
          name: String(p.name),
          lat: p.lat != null ? Number(p.lat) : undefined,
          lng: p.lng != null ? Number(p.lng) : undefined,
        }));
      const parkingLots = Array.isArray(data.parkingLots)
        ? mapLots(data.parkingLots)
        : [];
      const recommendedParkingLots = Array.isArray(data.recommendedParkingLots)
        ? mapLots(data.recommendedParkingLots)
        : [];
      const campusEntrances: CampusEntrance[] = Array.isArray(
        data.campusEntrances,
      )
        ? data.campusEntrances.map(
            (row: CampusEntrance) => ({
              id: Number(row.id),
              name: String(row.name),
              nodeId: Number(row.nodeId),
              lat: Number(row.lat),
              lng: Number(row.lng),
            }),
          )
        : [];
      const destinationId = Number(firstDest.id);
      setRouteInfo({
        name: data.name ?? "Route",
        destinationId,
        destinationName: String(firstDest.name ?? data.name ?? "Destination"),
        parkingLots,
        campusEntrances,
        recommendedParkingLots,
      });
      setTripTo({ kind: "place", id: destinationId });
      setPreferredParkingLotId(null);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load route.");
      setRouteInfo(null);
    } finally {
      setRouteLoadPending(false);
    }
  }

  const navModeOptions = useMemo(
    () => [
      {
        id: "pedestrian",
        label: "Pedestrian",
        conditions: { is_pedestrian: true, is_vehicular: false } as const,
      },
      {
        id: "vehicular",
        label: "Vehicular",
        conditions: { is_pedestrian: false, is_vehicular: true } as const,
      },
    ],
    [],
  );

  const [userPos, setUserPos] = useState<UserPos | null>(null);
  const [tracking, setTracking] = useState(false);
  const [isZoomed, setZoomed] = useState(false);
  const [sheetPosition, setSheetPosition] = useState(SHARE_SHEET_PEEK);
  const [effectiveSheetPeek, setEffectiveSheetPeek] =
    useState(SHARE_SHEET_PEEK);
  const [routePending, setRoutePending] = useState(false);
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
  const [routeEta, setRouteEta] = useState<{
    distanceMeters: number;
    durationSeconds: number;
    legs: RouteLegMetrics[];
  } | null>(null);
  const [routeSteps, setRouteSteps] = useState<NavStep[]>([]);
  const { units: distanceUnits } = useDistanceUnits();
  const [destPos, setDestPos] = useState<LngLat | null>(null);
  const [parkingPos, setParkingPos] = useState<LngLat | null>(null);
  const [tripParkingPoly, setTripParkingPoly] =
    useState<FeatureCollection<Polygon> | null>(null);

  const routeCoordsRef = useRef<Array<[number, number]>>([]);
  const watchIdRef = useRef<number | null>(null);
  const skipParkingRecalcRef = useRef(false);
  const routeRequestIdRef = useRef(0);
  const offRouteSinceRef = useRef<number | null>(null);
  const routePendingRef = useRef(false);
  const userPosRef = useRef<UserPos | null>(null);
  const lastGpsUiAtRef = useRef(0);
  const routeStartNodeRef = useRef<{
    id: number;
    lat: number;
    lng: number;
  } | null>(null);

  const sheetCollapsed = sheetPosition >= effectiveSheetPeek * 0.92;
  const navigating = routeCoords.length >= 2;
  const navigatingRef = useRef(navigating);
  navigatingRef.current = navigating;
  routePendingRef.current = routePending;
  userPosRef.current = userPos;

  const navProgress = useNavigationProgress(
    routeSteps,
    userPos,
    routeCoords,
    tracking,
  );

  function ensureCenter(lng: number, lat: number, minZoom = 16) {
    const map = mapRef.current?.getMap?.();
    const zoom = Math.max(map?.getZoom?.() ?? DEFAULT_ZOOM, minZoom);
    if (map && mapReady) {
      map.flyTo({ center: [lng, lat], zoom, essential: true });
    } else {
      pendingCenterRef.current = { lng, lat, zoom };
    }
  }

  function locateOnce(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!("geolocation" in navigator)) {
        toast.error("Geolocation not supported.");
        resolve(false);
        return;
      }
      if (!window.isSecureContext) {
        toast.error("Location requires HTTPS (or localhost).");
        resolve(false);
        return;
      }

      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(ok);
      };
      const timer = window.setTimeout(() => {
        toast.error("Could not get your location.");
        finish(false);
      }, 8000);

      const applyFix = (
        longitude: number,
        latitude: number,
        accuracy?: number,
      ) => {
        const next = { lng: longitude, lat: latitude, accuracy };
        userPosRef.current = next;
        setUserPos(next);
        setGpsStatus("ready");
        ensureCenter(longitude, latitude, 16);
        finish(true);
      };

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
        () => {
          if (!settled) toast.error("Could not get your location.");
          finish(false);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
      );
    });
  }

  const accuracyGeoJSON = useMemo<GeoJSONFeatureCollection | null>(() => {
    if (!userPos?.accuracy) return null;
    return makeCircleGeoJSON(
      userPos.lng,
      userPos.lat,
      Math.max(userPos.accuracy, 5),
      64,
    );
  }, [userPos]);

  function fitToUserAndRoute(coords: Array<[number, number]>) {
    const map = mapRef.current?.getMap?.();
    if (!map || !coords.length) return;

    const all: Array<[number, number]> = [];
    if (userPos) all.push([userPos.lng, userPos.lat]);
    all.push(...coords);
    if (all.length < 2) return;

    const lngs = all.map((c) => c[0]);
    const lats = all.map((c) => c[1]);
    const padding = { top: 90, right: 24, bottom: 220, left: 24 };

    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding, maxZoom: 19, duration: 900, essential: true },
    );
  }

  function aimCamera(
    map: maplibregl.Map | undefined,
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

  function showCampusOverview() {
    const map = mapRef.current?.getMap?.();
    if (!map) return;

    map.fitBounds(CAMPUS_BOUNDS, {
      padding: { top: 48, bottom: 80, left: 48, right: 48 },
      duration: 900,
      essential: true,
    });
  }

  function stopTracking() {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setTracking(false);
    const map = mapRef.current?.getMap?.();
    if (routeCoordsRef.current.length >= 2) {
      fitToUserAndRoute(routeCoordsRef.current);
      map?.easeTo({ bearing: 0, pitch: 0, duration: 400, essential: true });
    } else {
      map?.flyTo({
        center: [defViewState.longitude, defViewState.latitude],
        zoom: defViewState.zoom,
        bearing: 0,
        pitch: 0,
        duration: 900,
        essential: true,
      });
    }
  }

  function startTracking() {
    if (!userPos) {
      toast.error("Allow location to follow the route live.");
      return;
    }
    if (routeCoordsRef.current.length < 2) {
      toast.error("Build a route before starting live navigation.");
      return;
    }

    const firstNode =
      routeStartNodeRef.current ??
      (routeCoordsRef.current[1]
        ? {
            lng: routeCoordsRef.current[1][0],
            lat: routeCoordsRef.current[1][1],
          }
        : null);

    if (!firstNode) {
      toast.error("Navigation could not start.");
      return;
    }

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
        if (shouldPublishGpsUi(lastGpsUiAtRef.current)) {
          lastGpsUiAtRef.current = Date.now();
          setUserPos((up) => (up ? { ...up, ...nextPos } : nextPos));

          let brg: number;
          if (typeof heading === "number" && !Number.isNaN(heading)) {
            brg = heading;
          } else if (routeCoordsRef.current.length >= 2) {
            const [nx, ny] = routeCoordsRef.current[1];
            brg = bearingTo(longitude, latitude, nx, ny);
          } else {
            brg = mapRef.current?.getMap?.()?.getBearing?.() ?? 0;
          }

          aimCamera(mapRef.current?.getMap?.(), longitude, latitude, brg, {
            pitch: 60,
            duration: 300,
            zoom: 20,
          });
        }

        // Off-route recalc: GPS ticks stay local unless we leave the polyline.
        const MIN_OFF_ROUTE_M = 25;
        const OFF_ROUTE_DEBOUNCE_MS = 2500;
        const coords = routeCoordsRef.current;
        if (navigatingRef.current && coords.length >= 2) {
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
              void refreshRoute({ fromGps: { lat: latitude, lng: longitude } });
            }
          } else {
            offRouteSinceRef.current = null;
          }
        }
      },
      (err) => {
        toast.error(err.message || "Tracking error");
        stopTracking();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 1000 },
    );

    watchIdRef.current = id;
    setTracking(true);
  }

  async function handleZoom() {
    if (isZoomed) {
      showCampusOverview();
      setZoomed(false);
      return;
    }

    if (navigating) {
      if (tracking) {
        setSheetPosition(effectiveSheetPeek);
        setZoomed(true);
        return;
      }
      if (routeCoordsRef.current.length >= 2) {
        fitToUserAndRoute(routeCoordsRef.current);
        setSheetPosition(0);
      }
      setZoomed(true);
      return;
    }

    if (userPos) {
      ensureCenter(userPos.lng, userPos.lat, 16);
    } else {
      await locateOnce();
    }
    setZoomed(true);
  }

  async function handleNavButton() {
    if (!routeInfo?.destinationId) {
      toast.error("Route not loaded.");
      return;
    }
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
        const ok = await locateOnce();
        if (!ok) {
          setGpsStatus("unavailable");
          toast.error(
            "Location unavailable. Pick a campus entrance instead.",
          );
          return;
        }
      }
      await refreshRoute();
      setSheetPosition(effectiveSheetPeek);
      setZoomed(true);
      return;
    }

    if (navigating) {
      if (tracking) {
        setSheetPosition(0);
        stopTracking();
      } else {
        setSheetPosition(effectiveSheetPeek);
        startTracking();
      }
    }
  }

  async function refreshRoute(options?: {
    keepOnFailure?: boolean;
    fromGps?: { lat: number; lng: number };
  }) {
    if (!routeIdRaw || !routeInfo?.destinationId || routePendingRef.current) {
      return false;
    }
    const built = buildNavigatePayload({
      from: options?.fromGps ? { kind: "gps" } : tripFromRef.current,
      to: tripToRef.current,
      gps: options?.fromGps ?? userPosRef.current,
      navConditions: curNavConditions,
      preferredParkingLotId,
      parkingLotIds:
        routeInfo.parkingLots.length > 0
          ? routeInfo.parkingLots.map((lot) => lot.id)
          : null,
    });
    if (!built.ok) {
      if (built.reason === "same") {
        toast.error("Start and destination are the same.");
      } else if (built.reason === "gps") {
        toast.error(
          "Location unavailable. Pick a campus entrance instead.",
        );
      } else {
        toast.error("Choose a start and a destination.");
      }
      return false;
    }
    const reqId = ++routeRequestIdRef.current;
    setRoutePending(true);
    routePendingRef.current = true;
    try {
      const body = built.body;

      const res = await fetch(withBasePath("/api/map/navigateTo"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (reqId !== routeRequestIdRef.current) return true;

      const data = (await res
        .json()
        .catch(() => ({}))) as NavigateToResponse & {
        error?: string;
      };
      if (reqId !== routeRequestIdRef.current) return true;

      if (!res.ok || !Array.isArray(data.path) || data.path.length === 0) {
        if (!options?.keepOnFailure) {
          setRouteCoords([]);
          setRouteOutdoorSegments([]);
          setRouteModeSegments([]);
          setRoutePortals([]);
          routeCoordsRef.current = [];
          routeStartNodeRef.current = null;
          setRouteEta(null);
          setRouteSteps([]);
          setDestPos(null);
          setParkingPos(null);
          setTripParkingPoly(null);
        }
        toast.error(data?.error ?? "No path returned.");
        return false;
      }

      const coords = data.geometry?.coordinates ?? [];
      setRouteCoords(coords);
      setRouteOutdoorSegments(
        Array.isArray(data.geometry?.outdoorSegments)
          ? data.geometry.outdoorSegments
          : coords.length >= 2
            ? [coords]
            : [],
      );
      setRouteModeSegments(
        Array.isArray(data.geometry?.modeSegments) ? data.geometry.modeSegments : [],
      );
      setRoutePortals(
        Array.isArray(data.geometry?.portals) ? data.geometry.portals : [],
      );
      routeCoordsRef.current = coords;
      offRouteSinceRef.current = null;
      if (data.startNode) {
        routeStartNodeRef.current = data.startNode;
      }
      if (
        typeof data.distanceMeters === "number" &&
        typeof data.durationSeconds === "number"
      ) {
        setRouteEta({
          distanceMeters: data.distanceMeters,
          durationSeconds: data.durationSeconds,
          legs: Array.isArray(data.legs) ? data.legs : [],
        });
      } else {
        setRouteEta(null);
      }
      setRouteSteps(Array.isArray(data.steps) ? data.steps : []);

      if (coords.length >= 2) {
        const end = coords[coords.length - 1];
        setDestPos({ lng: end[0], lat: end[1] });
        setTimeout(() => fitToUserAndRoute(coords), 0);
      }

      const parkingLeg = Array.isArray(data.legs)
        ? data.legs.find((l) => l.kind === "parking")
        : undefined;
      if (parkingLeg) {
        const lot = routeInfo.parkingLots.find(
          (p) => p.id === parkingLeg.destinationId,
        );
        if (lot?.lat != null && lot?.lng != null) {
          setParkingPos({ lat: Number(lot.lat), lng: Number(lot.lng) });
        } else {
          setParkingPos(null);
        }
        try {
          const lotRes = await fetch(
            withBasePath(
              `/api/destination?id=${encodeURIComponent(parkingLeg.destinationId)}`,
            ),
          );
          if (reqId !== routeRequestIdRef.current) return true;
          const lotPayload = lotRes.ok
            ? await lotRes.json().catch(() => null)
            : null;
          const lotDest = Array.isArray(lotPayload?.destinations)
            ? lotPayload.destinations[0]
            : null;
          const polyStr =
            typeof lotDest?.polygon === "string" ? lotDest.polygon : null;
          if (polyStr) {
            const features = featuresFromDestinationPolygon(
              polyStr,
              parkingLeg.destinationId,
            );
            setTripParkingPoly(
              features.length > 0
                ? { type: "FeatureCollection", features }
                : null,
            );
          } else {
            setTripParkingPoly(null);
          }
        } catch {
          if (reqId !== routeRequestIdRef.current) return true;
          setTripParkingPoly(null);
        }
      } else {
        setParkingPos(null);
        setTripParkingPoly(null);
      }
      return true;
    } catch (e) {
      if (reqId !== routeRequestIdRef.current) return true;
      console.error(e);
      if (!options?.keepOnFailure) {
        setRouteCoords([]);
        setRouteOutdoorSegments([]);
        setRouteModeSegments([]);
        setRoutePortals([]);
        routeCoordsRef.current = [];
        routeStartNodeRef.current = null;
        setRouteEta(null);
        setRouteSteps([]);
        setDestPos(null);
        setTripParkingPoly(null);
      }
      toast.error("Failed to load route.");
      return false;
    } finally {
      if (reqId === routeRequestIdRef.current) {
        setRoutePending(false);
        routePendingRef.current = false;
      }
    }
  }

  useEffect(() => {
    if (!routeIdRaw) {
      toast.error("Missing route id in URL.");
      setRouteLoadPending(false);
      return;
    }
    void loadRoute();
    void locateOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeIdRaw]);

  useEffect(() => {
    if (routeCoordsRef.current.length < 2) return;
    void refreshRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curNavConditions]);

  const prevParkingLotRef = useRef(preferredParkingLotId);
  useEffect(() => {
    const prev = prevParkingLotRef.current;
    prevParkingLotRef.current = preferredParkingLotId;
    if (skipParkingRecalcRef.current) {
      skipParkingRecalcRef.current = false;
      return;
    }
    if (routeCoordsRef.current.length < 2 || tracking) return;
    if (!curNavConditions.is_vehicular) return;
    if (prev === preferredParkingLotId) return;
    const t = window.setTimeout(() => {
      void (async () => {
        const ok = await refreshRoute({ keepOnFailure: true });
        if (!ok) {
          skipParkingRecalcRef.current = true;
          setPreferredParkingLotId(prev);
        }
      })();
    }, 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredParkingLotId, tracking, curNavConditions.is_vehicular]);

  useEffect(() => {
    setSheetPosition((pos) =>
      pos >= effectiveSheetPeek * 0.92 ? effectiveSheetPeek : pos,
    );
  }, [effectiveSheetPeek]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  function clearSharePreview() {
    setRouteCoords([]);
    setRouteOutdoorSegments([]);
    setRouteModeSegments([]);
    setRoutePortals([]);
    routeCoordsRef.current = [];
    routeStartNodeRef.current = null;
    setRouteEta(null);
    setRouteSteps([]);
    setParkingPos(null);
    setTripParkingPoly(null);
    if (tracking) stopTracking();
  }

  const shareParkingLots =
    routeInfo == null
      ? []
      : routeInfo.parkingLots.length > 0
        ? routeInfo.parkingLots
        : routeInfo.recommendedParkingLots;

  return (
    <div className="relative h-[100dvh] w-full bg-background text-foreground">
      <div className="absolute left-3 top-3 z-40 flex items-center gap-2">
        <HomeLogoLink className="h-11 min-h-[44px] px-3 py-2 shadow-xl backdrop-blur" />
        <ThemeToggleButton className="h-11 min-h-[44px] w-11 shadow-xl backdrop-blur" />
        <BasemapToggle
          basemap={basemap}
          onChange={setBasemap}
          className="h-11 min-h-[44px] w-11 shadow-xl backdrop-blur"
        />
      </div>

      <div className="h-full w-full">
        {!canRenderMap ? (
          <div className="grid h-full w-full place-items-center text-sm opacity-70">
            Loading basemap...
          </div>
        ) : (
          <ReactMap
            ref={mapRef}
            initialViewState={defViewState}
            mapLib={maplibregl}
            mapStyle={resolvedMapStyle as any}
            onLoad={() => {
              setMapReady(true);
              const map = mapRef.current?.getMap?.();
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
            {accuracyGeoJSON && (
              <AccuracyRingLayer data={accuracyGeoJSON} isDark={isDark} />
            )}

            {(routeOutdoorSegments.length > 0 ||
              routePortals.length > 0 ||
              routeCoords.length >= 2) && (
              <RoutePathLayer
                coordinates={routeCoords}
                segments={routeOutdoorSegments}
                modeSegments={routeModeSegments}
                portals={routePortals}
                id="share-route"
              />
            )}

            <TripParkingHighlight
              data={tripParkingPoly}
              sourceId="share-trip-parking"
            />

            {parkingPos && (
              <Marker
                longitude={parkingPos.lng}
                latitude={parkingPos.lat}
                anchor="center"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-brand text-[10px] font-bold text-brand-foreground shadow-lg">
                  P
                </div>
              </Marker>
            )}

            {destPos && (
              <Marker
                longitude={destPos.lng}
                latitude={destPos.lat}
                anchor="center"
              >
                <div className="relative flex items-center justify-center">
                  <div className="absolute h-8 w-8 animate-ping rounded-full bg-brand-cta opacity-40" />
                  <div className="h-4 w-4 rounded-full border-2 border-white bg-brand-cta shadow-lg" />
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
                  title={`You are here (${userPos.lat.toFixed(6)}, ${userPos.lng.toFixed(6)})`}
                  className="h-3.5 w-3.5 rounded-full border-2 border-white bg-blue-600 shadow-lg ring-4 ring-blue-500/30"
                />
              </Marker>
            )}
          </ReactMap>
        )}
      </div>

      <MapBottomSheet
        hidden={routeLoadPending && !routeInfo}
        fitContent
        maxHeight="88dvh"
        snapPoints={SHARE_SHEET_SNAP_POINTS}
        position={sheetPosition}
        onPositionChange={setSheetPosition}
        onEffectivePeekChange={setEffectiveSheetPeek}
        toolbarOverlapPx={mapSheetToolbarOverlapPx}
        compactHeader={navigating && sheetCollapsed}
        peekMinVisiblePx={
          navigating && sheetCollapsed
            ? mapSheetPeekMinVisibleCompactPx
            : mapSheetPeekMinVisiblePx
        }
        title={
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">
            Shareable Route
          </p>
        }
        subtitle={
          <>
            {navigating && sheetCollapsed && routeEta ? (
              <p className="w-full text-center text-base font-semibold text-brand-cta">
                {formatRouteDistance(routeEta.distanceMeters)}
              </p>
            ) : (
              <>
                <p className="truncate text-base font-semibold">
                  {routeLoadPending
                    ? "Loading…"
                    : (routeInfo?.name ?? `Route ${routeIdRaw || "—"}`)}
                </p>
                {routeEta && routeCoords.length > 0 ? (
                  <p className="mt-1 text-sm font-semibold text-brand-cta">
                    {formatRouteEtaSummary(
                      routeEta.durationSeconds,
                      routeEta.distanceMeters,
                    )}
                  </p>
                ) : null}
              </>
            )}
          </>
        }
        toolbar={
          routeInfo ? (
            <div className="pointer-events-none grid w-full grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-end gap-x-2">
              <button
                type="button"
                className={`pointer-events-auto shrink-0 ${mapFloatingActionClass}`}
                onClick={() => void handleZoom()}
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
                onClick={() => void handleNavButton()}
                disabled={routePending}
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
          ) : null
        }
      >
        <div className="mt-2">
          {routeInfo ? (
            <TripEndsFields
              from={tripFrom}
              to={tripTo}
              places={[
                {
                  id: routeInfo.destinationId,
                  name: routeInfo.destinationName,
                },
              ]}
              entrances={routeInfo.campusEntrances}
              onFromChange={(end) => {
                clearSharePreview();
                setTripFrom(end);
              }}
              onToChange={(end) => {
                if (end && tripFrom && sameTripEnd(tripFrom, end)) {
                  toast.error("Start and destination are the same.");
                  return;
                }
                clearSharePreview();
                setTripTo(end);
              }}
              onSwap={() => {
                const nextFrom = tripTo;
                const nextTo = tripFrom;
                if (nextFrom && nextTo && sameTripEnd(nextFrom, nextTo)) return;
                clearSharePreview();
                setTripFrom(nextFrom);
                setTripTo(nextTo);
              }}
              gpsStatus={gpsStatus}
              onRetryGps={() => void locateOnce()}
            />
          ) : null}
          <span className="mt-4 block text-xs font-semibold uppercase tracking-wide text-panel-muted-foreground">
            Mode
          </span>
          <div className="mt-2 flex gap-2">
            {navModeOptions.map((opt) => {
              const active =
                (opt.id === "pedestrian" && curNavConditions.is_pedestrian) ||
                (opt.id === "vehicular" && curNavConditions.is_vehicular);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setCurNavConditions((prev) => ({
                      ...prev,
                      ...opt.conditions,
                    }));
                    if (opt.id === "pedestrian") {
                      setParkingPos(null);
                      setTripParkingPoly(null);
                    }
                  }}
                  disabled={routePending}
                  className={[
                    "min-h-[44px] flex-1 rounded-[15px] px-4 py-2 text-xs font-semibold uppercase transition",
                    active
                      ? "bg-brand-cta text-brand-cta-foreground"
                      : `border ${borderMutedClass} bg-panel-muted text-panel-muted-foreground`,
                    routePending && "opacity-60",
                  ].join(" ")}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {curNavConditions.is_vehicular &&
        !tracking &&
        tripTo?.kind === "place" &&
        shareParkingLots.length > 0 ? (
          <div
            className={`mt-4 rounded-2xl border px-3 py-3 ${borderMutedClass} ${surfaceSubtleClass}`}
          >
            <p className="mb-2 text-center text-sm font-semibold">
              {shareParkingLots.length === 1
                ? `Parking lot: ${shareParkingLots[0]?.name ?? "Recommended lot"}`
                : "Parking lot"}
            </p>
            {shareParkingLots.length > 1 ? (
              <>
                <ComboboxSelect
                  placeholder="Choose parking lot"
                  value={preferredParkingLotId ?? 0}
                  items={[
                    { value: 0, label: "Closest recommended" },
                    ...shareParkingLots.map((lot) => ({
                      value: lot.id,
                      label: lot.name,
                    })),
                  ]}
                  onChange={(value) => {
                    setPreferredParkingLotId(value === 0 ? null : value);
                  }}
                  widthClassName="w-full"
                  searchPlaceholder="Search parking…"
                />
                <p className="mt-2 text-center text-xs text-panel-muted-foreground">
                  Changing the lot recalculates drive then walk.
                </p>
              </>
            ) : null}
          </div>
        ) : null}

        {curNavConditions.is_pedestrian ? (
          <details
            className={`mt-4 rounded-2xl border ${borderMutedClass} ${surfaceSubtleClass}`}
          >
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold min-h-11">
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
                    id="share-route-max-incline-slider"
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

        {routeSteps.length > 0 && routeCoords.length > 0 ? (
          <NavigationStepsPanel
            steps={routeSteps}
            currentStepIndex={navProgress.currentStepIndex}
            distanceToNextMeters={navProgress.distanceToNextMeters}
            units={distanceUnits}
            tracking={tracking}
            onAdvance={navProgress.advanceStep}
            hideLiveBanner
            className="mt-4"
          />
        ) : null}

        {routeEta && routeEta.legs.length > 1 && routeCoords.length > 0 ? (
          <div
            className={`mt-4 rounded-2xl border px-4 py-3 ${borderMutedClass} ${surfaceSubtleClass}`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-panel-muted-foreground">
              Leg estimates
            </p>
            <ul className="mt-2 space-y-2">
              {routeEta.legs.map((leg, index) => {
                const parkingName = routeInfo?.parkingLots.find(
                  (p) => p.id === leg.destinationId,
                )?.name;
                const destName =
                  leg.destinationId === routeInfo?.destinationId
                    ? routeInfo?.name
                    : parkingName;
                const label = destName ?? `Leg ${index + 1}`;
                return (
                  <li
                    key={`${leg.destinationId}-${index}`}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate">{label}</span>
                    <span className="shrink-0 font-medium text-brand-cta">
                      ~{formatRouteDuration(leg.durationSeconds)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <p className="mt-4 text-center text-xs text-panel-muted-foreground">
          {routePending
            ? "Building route…"
            : routeCoords.length
              ? tracking
                ? "Live navigation active — follow the teal path."
                : "Follow the teal path on the map. Tap the navigation button for live tracking."
              : userPos
                  ? "Tap the route button above to build your path."
                  : "Choose a start and a destination, then tap the route button."}
        </p>
      </MapBottomSheet>
    </div>
  );
}
