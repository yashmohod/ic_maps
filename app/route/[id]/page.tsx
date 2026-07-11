"use client";

import React, { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { withBasePath } from "@/lib/base-path";
import {
  Map as ReactMap,
  Marker,
  type MapRef,
  type ViewStateChangeEvent,
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
import {
  CAMPUS_BOUNDS,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
} from "@/lib/map-constants";
import { HomeLogoLink } from "@/components/home-logo-link";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import type { NavConditions } from "@/lib/navigation";
import { bearingTo, makeCircleGeoJSON } from "@/lib/geo";
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
  SimpleMarkerNode,
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

import NavModeMap from "@/components/NavModeMap";
import ComboboxSelect from "@/components/ComboboxSelect";
import { MapBottomSheet } from "@/components/MapBottomSheet";
import { NavigationNextTurnBanner } from "@/components/NavigationNextTurnBanner";
import { NavigationStepsPanel } from "@/components/NavigationStepsPanel";
import { RoutePathLayer } from "@/components/RoutePathLayer";
import { AccuracyRingLayer } from "@/components/AccuracyRingLayer";
import type { NavStep } from "@/lib/navigation-types";
import { useDistanceUnits } from "@/hooks/use-distance-units";

type MarkerNode = SimpleMarkerNode;
type RouteEdgeEntry = {
  id: string;
  from: string | number;
  to: string | number;
};

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

  type RouteInfo = {
    name: string;
    destinationId: number;
    parkingLots: Array<{
      id: number;
      name: string;
      lat?: number;
      lng?: number;
    }>;
  } | null;

  const [routeInfo, setRouteInfo] = useState<RouteInfo>(null);
  const [selectedParkingId, setSelectedParkingId] = useState<number | null>(
    null,
  );
  const [routeLoadPending, setRouteLoadPending] = useState(true);

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
        `/api/shareableroute?id=${encodeURIComponent(routeIdRaw)}`,
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
      const parkingLots = Array.isArray(data.parkingLots)
        ? data.parkingLots.map(
            (p: { id: number; name: string; lat?: number; lng?: number }) => ({
              id: Number(p.id),
              name: String(p.name),
              lat: p.lat != null ? Number(p.lat) : undefined,
              lng: p.lng != null ? Number(p.lng) : undefined,
            }),
          )
        : [];
      setRouteInfo({
        name: data.name ?? "Route",
        destinationId: Number(firstDest.id),
        parkingLots,
      });
      if (parkingLots.length === 1) {
        setSelectedParkingId(parkingLots[0].id);
      } else {
        setSelectedParkingId(null);
      }
      void prefetchGraph();
    } catch (e) {
      console.error(e);
      toast.error("Failed to load route.");
      setRouteInfo(null);
    } finally {
      setRouteLoadPending(false);
    }
  }

  const graphPrefetchRef = useRef<Promise<void> | null>(null);
  const [markers, setMarkers] = useState<MarkerNode[]>([]);
  const [edgeIndex, setEdgeIndex] = useState<RouteEdgeEntry[]>([]);

  async function prefetchGraph() {
    if (markers.length > 0) return;
    if (graphPrefetchRef.current) return graphPrefetchRef.current;
    graphPrefetchRef.current = (async () => {
      try {
        const res = await fetch(withBasePath("/api/map/all"));
        if (res.status !== 200) return;
        const data = await res.json();
        setMarkers(data.nodes ?? []);
        setEdgeIndex(
          (data.edges ?? []).map(
            (e: { id: number; from: number; to: number }) => ({
              id: String(e.id),
              from: e.from,
              to: e.to,
            }),
          ),
        );
      } catch (e) {
        console.error(e);
      } finally {
        graphPrefetchRef.current = null;
      }
    })();
    return graphPrefetchRef.current;
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
  const [locating, setLocating] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [isZoomed, setZoomed] = useState(false);
  const [sheetPosition, setSheetPosition] = useState(SHARE_SHEET_PEEK);
  const [effectiveSheetPeek, setEffectiveSheetPeek] =
    useState(SHARE_SHEET_PEEK);
  const [routePending, setRoutePending] = useState(false);
  const [routeCoords, setRouteCoords] = useState<Array<[number, number]>>([]);
  const [routeEta, setRouteEta] = useState<{
    distanceMeters: number;
    durationSeconds: number;
    legs: RouteLegMetrics[];
  } | null>(null);
  const [routeSteps, setRouteSteps] = useState<NavStep[]>([]);
  const { units: distanceUnits } = useDistanceUnits();
  const [destPos, setDestPos] = useState<LngLat | null>(null);
  const [parkingPos, setParkingPos] = useState<LngLat | null>(null);

  const routeCoordsRef = useRef<Array<[number, number]>>([]);
  const watchIdRef = useRef<number | null>(null);
  const pendingRouteStartRef = useRef(false);
  const routeStartNodeRef = useRef<{
    id: number;
    lat: number;
    lng: number;
  } | null>(null);

  const sheetCollapsed = sheetPosition >= effectiveSheetPeek * 0.92;
  const navigating = routeCoords.length >= 2;

  const navProgress = useNavigationProgress(
    routeSteps,
    userPos,
    routeCoords,
    tracking,
  );

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
      () => {
        toast.error("Could not get your location.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
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
    setViewState((v) => ({
      ...v,
      longitude: lng,
      latitude: lat,
      zoom,
      bearing: bearingDeg ?? 0,
      pitch,
    }));
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
    if (routeCoordsRef.current.length >= 2) {
      fitToUserAndRoute(routeCoordsRef.current);
      setViewState((v) => ({ ...v, bearing: 0, pitch: 0 }));
    } else {
      setViewState(defViewState);
    }
  }

  function startTracking() {
    if (!userPos) {
      toast.error("Tap Locate Me first so I know where you are.");
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
        const { longitude, latitude, heading } = pos.coords;
        setUserPos((up) =>
          up
            ? { ...up, lng: longitude, lat: latitude, heading }
            : { lng: longitude, lat: latitude, heading },
        );

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
    if (!userPos) {
      pendingRouteStartRef.current = true;
      await locateOnce();
      return;
    }
    if (showParkingOptions && selectedParkingId == null) {
      toast.error("Select a parking lot first.");
      return;
    }

    if (!navigating && !tracking) {
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

  const hasParkingLots = (routeInfo?.parkingLots.length ?? 0) > 0;
  const showParkingOptions = hasParkingLots && curNavConditions.is_vehicular;

  const parkingComboboxItems = useMemo(
    () =>
      (routeInfo?.parkingLots ?? []).map((lot) => ({
        value: lot.id,
        label: lot.name,
      })),
    [routeInfo?.parkingLots],
  );

  const canNavigate =
    !!userPos &&
    !!routeInfo?.destinationId &&
    (!showParkingOptions || selectedParkingId != null);

  async function refreshRoute() {
    if (!routeIdRaw || !userPos || !routeInfo?.destinationId || routePending)
      return;
    if (showParkingOptions && selectedParkingId == null) {
      toast.error("Select a parking lot first.");
      return;
    }

    setRoutePending(true);
    try {
      const body: Record<string, unknown> = {
        lat: userPos.lat,
        lng: userPos.lng,
        navConditions: curNavConditions,
      };

      if (showParkingOptions && selectedParkingId != null) {
        body.viaDestIds = [selectedParkingId, routeInfo.destinationId];
      } else {
        body.destId = routeInfo.destinationId;
      }

      const res = await fetch(withBasePath("/api/map/navigateTo"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res
        .json()
        .catch(() => ({}))) as NavigateToResponse & {
        error?: string;
      };

      if (!res.ok || !Array.isArray(data.path) || data.path.length === 0) {
        setRouteCoords([]);
        routeCoordsRef.current = [];
        routeStartNodeRef.current = null;
        setRouteEta(null);
        setRouteSteps([]);
        setDestPos(null);
        setParkingPos(null);
        toast.error(data?.error ?? "No path returned.");
        return;
      }

      const coords = data.geometry?.coordinates ?? [];
      setRouteCoords(coords);
      routeCoordsRef.current = coords;
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

      if (showParkingOptions && selectedParkingId != null) {
        const lot = routeInfo.parkingLots.find(
          (p) => p.id === selectedParkingId,
        );
        if (lot?.lat != null && lot?.lng != null) {
          setParkingPos({ lat: Number(lot.lat), lng: Number(lot.lng) });
        }
      } else {
        setParkingPos(null);
      }
    } catch (e) {
      console.error(e);
      setRouteCoords([]);
      routeCoordsRef.current = [];
      routeStartNodeRef.current = null;
      setRouteEta(null);
      setRouteSteps([]);
      setDestPos(null);
      toast.error("Failed to load route.");
    } finally {
      setRoutePending(false);
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
    if (!canNavigate) return;
    void refreshRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    routeInfo?.destinationId,
    selectedParkingId,
    userPos?.lat,
    userPos?.lng,
    curNavConditions,
  ]);

  useEffect(() => {
    if (!pendingRouteStartRef.current) return;
    if (!userPos || !canNavigate) return;
    pendingRouteStartRef.current = false;
    void refreshRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPos, canNavigate]);

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

  const emptyPath = useMemo(
    () => ({ path: new Set<number>(), firstNodeId: -1, lastNodeId: -1 }),
    [],
  );

  return (
    <div className="relative h-[100dvh] w-full bg-background text-foreground">
      <div className="absolute left-3 top-3 z-40 flex items-center gap-2">
        <HomeLogoLink className="h-11 min-h-[44px] px-3 py-2 shadow-xl backdrop-blur" />
        <ThemeToggleButton className="h-11 min-h-[44px] w-11 shadow-xl backdrop-blur" />
      </div>

      <div className="h-full w-full">
        {!canRenderMap ? (
          <div className="grid h-full w-full place-items-center text-sm opacity-70">
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
            <NavModeMap
              path={emptyPath}
              curNavConditions={curNavConditions}
              markers={markers}
              edgeIndex={edgeIndex}
              showBaseGraph={edgeIndex.length > 0 && routeCoords.length > 0}
            />

            {accuracyGeoJSON && (
              <AccuracyRingLayer data={accuracyGeoJSON} isDark={isDark} />
            )}

            {routeCoords.length >= 2 && (
              <RoutePathLayer coordinates={routeCoords} id="share-route" />
            )}

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
                disabled={routePending || locating}
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
          <span className="text-xs font-semibold uppercase tracking-wide text-panel-muted-foreground">
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
                      setSelectedParkingId(null);
                      setParkingPos(null);
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

        {showParkingOptions && routeInfo && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-panel-muted-foreground">
              Parking lot
            </p>
            <p className="mt-1 text-xs text-panel-muted-foreground">
              Drive to parking, then walk to the destination.
            </p>
            <div className="mt-2">
              <ComboboxSelect
                placeholder="Select parking…"
                searchPlaceholder="Search parking lots…"
                value={selectedParkingId}
                items={parkingComboboxItems}
                onChange={(id) => setSelectedParkingId(Number(id))}
                widthClassName="w-full min-h-11"
                disabled={routePending}
              />
            </div>
          </div>
        )}

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
              : showParkingOptions && !selectedParkingId
                ? "Choose parking, then tap the route button above."
                : userPos
                  ? "Tap the route button above to build your path."
                  : "Allow location to build your route."}
        </p>
      </MapBottomSheet>
    </div>
  );
}
