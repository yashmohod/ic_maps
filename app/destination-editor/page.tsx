"use client";
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  JSX,
} from "react";
import { toast } from "sonner";
import { withBasePath } from "@/lib/base-path";
import { Map as ReactMap, type MapRef } from "@vis.gl/react-maplibre";
import maplibregl, {
  type Map as MlMap,
  type MapMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import type {
  Feature,
  FeatureCollection,
  Polygon,
  GeoJsonProperties,
} from "geojson";

import "maplibre-gl/dist/maplibre-gl.css";
import "./page.css";

import EditPanel, {
  type BuildingRow,
  type DestinationEditorMode,
} from "@/components/BuildingInfoEditPanel";
import DrawControl from "@/components/BuildingDrawControls";
import {
  BuildingsOverlay,
  ParkingLotsOverlay,
  BUILDINGS_OVERLAY_FILL_LAYER,
  PARKING_OVERLAY_FILL_LAYER,
} from "@/components/ParkingLotsOverlay";
import { useMapStyle } from "@/hooks/use-map-style";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";
import { useBasemapStyle } from "@/hooks/use-basemap";
import { BasemapToggle } from "@/components/basemap-toggle";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/map-constants";
import { HomeLogoLink } from "@/components/home-logo-link";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import { useRequireAdmin } from "@/hooks/use-require-admin";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mapPageClass } from "@/lib/panel-classes";

import type { ViewStateLite } from "@/lib/types/map";

type DrawEvent = {
  features: Array<Feature>;
};

type MapSectionProps = {
  buildingPolys: Array<Feature<Polygon, GeoJsonProperties>>;
  parkingPolys: Array<Feature<Polygon, GeoJsonProperties>>;
  drawPolys: Array<Feature<Polygon, GeoJsonProperties>>;
  drawEnabled: boolean;
  recommendedParkingIds: number[];
  selectedBuildingId: number | null;
  mlMap: MlMap | null;
  mapRef: React.RefObject<MapRef | null>;
  stableViewState: ViewStateLite;
  mapStyle: StyleSpecification;
  onMapClick: (e: MapMouseEvent) => void;
  onMapDblClick: (e: MapMouseEvent) => void;
  onLoad: () => void;
  onReady?: (draw: unknown) => void;
  onCreate: (e: DrawEvent, draw?: unknown) => void;
  onUpdate: (e: DrawEvent, draw?: unknown) => void;
  onDelete: (e: DrawEvent, draw?: unknown) => void;
  onSelectionChange: (e: DrawEvent, draw?: unknown) => void;
  onModeChange: (e: unknown, draw?: unknown) => void;
};

/** ---------------- Map Section: memoized OUTSIDE the component ---------------- */

const MapSection = React.memo(function MapSection({
  buildingPolys,
  parkingPolys,
  drawPolys,
  drawEnabled,
  recommendedParkingIds,
  selectedBuildingId,
  mlMap,
  mapRef,
  stableViewState,
  mapStyle,
  onMapClick,
  onMapDblClick,
  onLoad,
  onReady,
  onCreate,
  onUpdate,
  onDelete,
  onSelectionChange,
  onModeChange,
}: MapSectionProps) {
  return (
    <ReactMap
      ref={mapRef}
      initialViewState={stableViewState}
      onClick={onMapClick as any}
      onDblClick={onMapDblClick as any}
      onLoad={onLoad}
      mapLib={maplibregl}
      mapStyle={mapStyle}
      style={{ width: "100%", height: "100%" }}
      doubleClickZoom={false}
    >
      <BuildingsOverlay
        map={mlMap}
        features={buildingPolys}
        selectedId={selectedBuildingId}
      />
      <ParkingLotsOverlay
        map={mlMap}
        features={parkingPolys}
        recommendedIds={recommendedParkingIds}
      />
      {drawEnabled ? (
        <DrawControl
          map={mlMap}
          polys={drawPolys}
          position="top-right"
          displayControlsDefault={false}
          controls={{ polygon: true, trash: false }}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onSelectionChange={onSelectionChange}
          onModeChange={onModeChange}
          onReady={onReady}
        />
      ) : null}
    </ReactMap>
  );
});

const emptyBuilding = (): BuildingRow => ({
  id: -1,
  name: "",
  lat: -1,
  lng: -1,
  polygon: "",
  isParkingLot: false,
  navigatableDestination: false,
  openTime: "00:00:00",
  closeTime: "23:59:59",
  parkingLotIds: [],
});

function normalizeBuildingRow(raw: Record<string, unknown>): BuildingRow {
  return {
    id: Number(raw.id),
    name: String(raw.name ?? ""),
    lat: Number(raw.lat),
    lng: Number(raw.lng),
    polygon: raw.polygon == null ? "" : String(raw.polygon),
    isParkingLot: Boolean(raw.isParkingLot),
    navigatableDestination: Boolean(raw.navigatableDestination),
    openTime: String(raw.openTime ?? "00:00:00"),
    closeTime: String(raw.closeTime ?? "23:59:59"),
    parkingLotIds: Array.isArray(raw.parkingLotIds)
      ? raw.parkingLotIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [],
  };
}

function featureWithDestId(
  feature: Feature<Polygon, GeoJsonProperties>,
  destId: number,
  extraProps?: GeoJsonProperties,
): Feature<Polygon, GeoJsonProperties> {
  const id = String(destId);
  return {
    ...feature,
    id,
    properties: {
      ...(feature.properties ?? {}),
      ...extraProps,
      destId,
      id,
    },
  };
}

/** ---------------- Main Component ---------------- */

export default function BuildingEditor(): JSX.Element {
  const { isPending, allowed } = useRequireAdmin();
  const mapRef = useRef<MapRef | null>(null);
  const buildingsRef = useRef<BuildingRow[]>([]);
  const drawRef = useRef<{
    delete: (id: string) => void;
    changeMode: (
      mode: string,
      opts?: { featureIds?: string[]; featureId?: string },
    ) => void;
    get?: (id: string) => unknown;
    getMode?: () => string;
    add?: (feature: unknown) => void;
  } | null>(null);
  const { isDark, mapStyle } = useMapStyle();
  const { baseStyle } = usePmtilesStyle({ stylePath: mapStyle });
  const { basemap, setBasemap, resolvedMapStyle, canRenderMap } =
    useBasemapStyle(baseStyle);

  const [mlMap, setMlMap] = useState<MlMap | null>(null);
  const [buildings, setBuildings] = useState<BuildingRow[]>([]);
  const [importingOsmBuildings, setImportingOsmBuildings] = useState(false);
  const [buildingPolys, setBuildingPolys] = useState<
    Array<Feature<Polygon, GeoJsonProperties>>
  >([]);
  const [parkingPolys, setParkingPolys] = useState<
    Array<Feature<Polygon, GeoJsonProperties>>
  >([]);

  const [currentBuilding, setCurrentBuilding] = useState<BuildingRow>(emptyBuilding);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [editorMode, setEditorMode] =
    useState<DestinationEditorMode>("shapes");
  const editorModeRef = useRef(editorMode);
  editorModeRef.current = editorMode;

  /** Stable initial map view */
  const stableViewState = useMemo<ViewStateLite>(
    () => ({
      longitude: DEFAULT_CENTER.lng,
      latitude: DEFAULT_CENTER.lat,
      zoom: DEFAULT_ZOOM,
    }),
    [],
  );

  const applyDestinationList = useCallback((list: BuildingRow[]) => {
    setBuildings(list);
    buildingsRef.current = list;
    const buildingFeatures: Array<Feature<Polygon, GeoJsonProperties>> = [];
    const parkingFeatures: Array<Feature<Polygon, GeoJsonProperties>> = [];
    for (const b of list) {
      try {
        const polyJ = JSON.parse(b.polygon) as Feature<
          Polygon,
          GeoJsonProperties
        >;
        const feature = featureWithDestId(polyJ, b.id, {
          name: b.name,
          isParkingLot: b.isParkingLot,
        });
        if (b.isParkingLot) parkingFeatures.push(feature);
        else buildingFeatures.push(feature);
      } catch {
        /* skip bad polygon */
      }
    }
    setBuildingPolys(buildingFeatures);
    setParkingPolys(parkingFeatures);
  }, []);

  async function loadDestinations() {
    try {
      const resp: any = await fetch(
        withBasePath("/api/destination?include=polygon"),
      ).then((r) => r.json());
      if (!resp) {
        toast.error("Buildings failed to load");
        return;
      }

      const list: BuildingRow[] = (resp.destinations || []).map(
        (d: Record<string, unknown>) => normalizeBuildingRow(d),
      );
      applyDestinationList(list);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load destinations.");
    }
  }

  const persistRecommendedParking = useCallback(
    async (buildingId: number, parkingLotIds: number[]) => {
      const req = await fetch(withBasePath("/api/destination/parkingLots"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildingId, parkingLotIds }),
      });
      if (!req.ok) {
        const data = await req.json().catch(() => ({}));
        toast.error(data?.error ?? "Could not update recommended parking");
        return false;
      }
      return true;
    },
    [],
  );

  const setRecommendedParkingIds = useCallback(
    async (buildingId: number, parkingLotIds: number[]) => {
      const ok = await persistRecommendedParking(buildingId, parkingLotIds);
      if (!ok) return;
      setBuildings((prev) => {
        const next = prev.map((b) =>
          b.id === buildingId ? { ...b, parkingLotIds } : b,
        );
        buildingsRef.current = next;
        return next;
      });
      setCurrentBuilding((prev) =>
        prev.id === buildingId ? { ...prev, parkingLotIds } : prev,
      );
    },
    [persistRecommendedParking],
  );

  const toggleRecommendedParking = useCallback(
    async (parkingLotId: number) => {
      const building = currentBuilding;
      if (building.id < 0 || building.isParkingLot) return;
      const has = building.parkingLotIds.includes(parkingLotId);
      const next = has
        ? building.parkingLotIds.filter((id) => id !== parkingLotId)
        : [...building.parkingLotIds, parkingLotId];
      await setRecommendedParkingIds(building.id, next);
    },
    [currentBuilding, setRecommendedParkingIds],
  );

  async function onChangeIsParkingLot(v: boolean) {
    if (!currentBuilding) return;
    try {
      const req = await fetch(withBasePath("/api/destination/setParkingLot"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: currentBuilding.id, isParkingLot: v }),
      });
      if (req.status !== 200) {
        const resp = await req.json();
        toast.error(resp.error);
        return;
      }

      await loadDestinations();
      const refreshed = buildingsRef.current.find(
        (b) => b.id === currentBuilding.id,
      );
      if (refreshed) setCurrentBuilding(refreshed);
    } catch (err) {
      console.error(err);
      toast.error("Failed to update parking lot status.");
    }
  }

  async function onChangeNavigatableDestination(v: boolean) {
    if (currentBuilding.id < 0) return;
    const prev = currentBuilding.navigatableDestination;
    try {
      const req = await fetch(
        withBasePath("/api/destination/setNavigatable"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: currentBuilding.id,
            navigatableDestination: v,
          }),
        },
      );
      if (req.status !== 200) {
        const resp = await req.json().catch(() => null);
        setCurrentBuilding((row) =>
          row.id === currentBuilding.id
            ? { ...row, navigatableDestination: prev }
            : row,
        );
        toast.error(resp?.error ?? "Could not update navigatable status.");
        return;
      }

      setBuildings((list) => {
        const next = list.map((b) =>
          b.id === currentBuilding.id
            ? { ...b, navigatableDestination: v }
            : b,
        );
        buildingsRef.current = next;
        return next;
      });
    } catch (err) {
      console.error(err);
      setCurrentBuilding((row) =>
        row.id === currentBuilding.id
          ? { ...row, navigatableDestination: prev }
          : row,
      );
      toast.error("Failed to update navigatable destination status.");
    }
  }

  useEffect(() => {
    loadDestinations();
  }, []);

  async function importOsmBuildings() {
    if (importingOsmBuildings) return;
    const previewRes = await fetch(withBasePath("/api/map/import-osm"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: true, mode: "buildings" }),
    });
    if (!previewRes.ok) {
      const err = await previewRes.json().catch(() => ({}));
      toast.error(err.error ?? "OSM buildings preview failed");
      return;
    }
    const preview = await previewRes.json();
    const ok = window.confirm(
      `Import named Ithaca College building footprints from OpenStreetMap?\n\n` +
        `Named campus buildings: ${preview.osmBuildings ?? 0}\n` +
        `New destinations: ${preview.buildingsToInsert ?? 0}\n\n` +
        `Only features inside the Ithaca College campus outline are included.\n` +
        `Existing destinations with the same name are skipped.`,
    );
    if (!ok) return;

    setImportingOsmBuildings(true);
    try {
      const req = await fetch(withBasePath("/api/map/import-osm"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, mode: "buildings" }),
      });
      if (!req.ok) {
        const err = await req.json().catch(() => ({}));
        toast.error(err.error ?? "OSM buildings import failed");
        return;
      }
      const result = await req.json();
      toast.success(
        `Imported ${result.insertedBuildings ?? 0} buildings` +
          ` (${result.osmBuildings ?? 0} named in OSM)`,
      );
      await loadDestinations();
    } catch (err) {
      console.error(err);
      toast.error("OSM buildings import failed");
    } finally {
      setImportingOsmBuildings(false);
    }
  }

  /** Handlers */
  const onLoad = useCallback(() => {
    const map = mapRef.current?.getMap?.();
    if (map) setMlMap(map as unknown as MlMap);
  }, []);

  const onDrawReady = useCallback((draw: unknown) => {
    drawRef.current = (draw as typeof drawRef.current) ?? null;
  }, []);

  const drawPolys = useMemo(
    () => [...buildingPolys, ...parkingPolys],
    [buildingPolys, parkingPolys],
  );

  const beginPolygonEdit = useCallback((destId: number) => {
    const draw = drawRef.current;
    if (!draw) return;
    const id = String(destId);
    try {
      // Ensure feature exists in Draw, then open vertex editors.
      if (typeof draw.get === "function" && !draw.get(id)) {
        const feat =
          buildingPolys.find((p) => Number(p.properties?.destId) === destId) ??
          parkingPolys.find((p) => Number(p.properties?.destId) === destId);
        if (feat && typeof (draw as any).add === "function") {
          (draw as any).add(feat);
        }
      }
      draw.changeMode("direct_select", { featureId: id });
    } catch (err) {
      console.warn("Could not enter polygon edit mode", err);
      try {
        draw.changeMode("simple_select", { featureIds: [id] });
      } catch {
        /* ignore */
      }
    }
  }, [buildingPolys, parkingPolys]);

  const hitDestinationAtPoint = useCallback(
    (map: MlMap, point: MapMouseEvent["point"]) => {
      const layers = [
        PARKING_OVERLAY_FILL_LAYER,
        BUILDINGS_OVERLAY_FILL_LAYER,
      ].filter((id) => {
        try {
          return Boolean(map.getLayer(id));
        } catch {
          return false;
        }
      });
      if (layers.length === 0) return null;
      const hits = map.queryRenderedFeatures(point, { layers });
      const destId = Number(hits[0]?.properties?.destId);
      if (!Number.isFinite(destId) || destId <= 0) return null;
      return buildingsRef.current.find((b) => b.id === destId) ?? null;
    },
    [],
  );
  const onMapClick = useCallback(
    (e: MapMouseEvent) => {
      setDeleteOpen(false);
      const map = mapRef.current?.getMap?.();
      if (!map) {
        setCurrentBuilding(emptyBuilding());
        return;
      }

      if (editorModeRef.current === "recommended_parking") {
        const parkingHits = map.getLayer(PARKING_OVERLAY_FILL_LAYER)
          ? map.queryRenderedFeatures(e.point, {
              layers: [PARKING_OVERLAY_FILL_LAYER],
            })
          : [];
        const parkingId = Number(parkingHits[0]?.properties?.destId);
        if (Number.isFinite(parkingId) && parkingId > 0) {
          const lot = buildingsRef.current.find((b) => b.id === parkingId);
          if (!lot) return;
          if (
            currentBuilding.id >= 0 &&
            !currentBuilding.isParkingLot
          ) {
            void toggleRecommendedParking(parkingId);
            return;
          }
          toast.message("Select a building first, then click parking lots.");
          return;
        }

        const buildingHits = map.getLayer(BUILDINGS_OVERLAY_FILL_LAYER)
          ? map.queryRenderedFeatures(e.point, {
              layers: [BUILDINGS_OVERLAY_FILL_LAYER],
            })
          : [];
        const buildingId = Number(buildingHits[0]?.properties?.destId);
        if (Number.isFinite(buildingId) && buildingId > 0) {
          const b = buildingsRef.current.find((x) => x.id === buildingId);
          if (b && !b.isParkingLot) {
            setCurrentBuilding(b);
            return;
          }
        }
        return;
      }

      // shapes mode — Let MapLibre Draw own clicks while creating / vertex-editing.
      const mode = drawRef.current?.getMode?.() ?? "";
      if (mode.startsWith("draw_") || mode === "direct_select") {
        return;
      }

      const hit = hitDestinationAtPoint(map, e.point);
      if (hit) {
        setCurrentBuilding(hit);
        try {
          drawRef.current?.changeMode?.("simple_select", {
            featureIds: [String(hit.id)],
          });
        } catch {
          /* ignore */
        }
        return;
      }

      setCurrentBuilding(emptyBuilding());
    },
    [
      currentBuilding.id,
      currentBuilding.isParkingLot,
      hitDestinationAtPoint,
      toggleRecommendedParking,
    ],
  );

  const onMapDblClick = useCallback(
    (e: MapMouseEvent) => {
      e.preventDefault();
      if (editorModeRef.current !== "shapes") return;
      const map = mapRef.current?.getMap?.();
      if (!map) return;
      const hit = hitDestinationAtPoint(map, e.point);
      if (!hit) return;
      setCurrentBuilding(hit);
      beginPolygonEdit(hit.id);
    },
    [beginPolygonEdit, hitDestinationAtPoint],
  );

  const switchEditorMode = useCallback((next: DestinationEditorMode) => {
    setEditorMode(next);
    drawRef.current = null;
    if (next === "recommended_parking") {
      setCurrentBuilding((prev) =>
        prev.id >= 0 && prev.isParkingLot ? emptyBuilding() : prev,
      );
    }
  }, []);

  const dropDestinationLocally = useCallback((destId: number) => {
    buildingsRef.current = buildingsRef.current.filter((b) => b.id !== destId);
    setBuildings(buildingsRef.current);
    setBuildingPolys((prev) =>
      prev.filter((p) => Number(p.properties?.destId ?? p.id) !== destId),
    );
    setParkingPolys((prev) =>
      prev.filter((p) => Number(p.properties?.destId ?? p.id) !== destId),
    );
    setCurrentBuilding((prev) =>
      prev.id === destId ? emptyBuilding() : prev,
    );
    const draw = drawRef.current;
    try {
      draw?.changeMode?.("simple_select");
      draw?.delete?.(String(destId));
    } catch {
      /* draw may already have dropped it */
    }
  }, []);

  const confirmDeleteDestination = useCallback(async () => {
    const destId = currentBuilding.id;
    if (destId < 0 || deletePending) return;
    const label = currentBuilding.name.trim() || `#${destId}`;
    setDeletePending(true);
    try {
      const resp = await fetch(withBasePath("/api/destination"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: destId }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        toast.error(data?.error ?? "Could not delete destination");
        return;
      }
        dropDestinationLocally(destId);
        setDeleteOpen(false);
        toast.success(`Deleted ${label}`);
    } catch (err) {
      console.error(err);
      toast.error("Could not delete destination");
    } finally {
      setDeletePending(false);
    }
  }, [currentBuilding.id, currentBuilding.name, deletePending, dropDestinationLocally]);

  const onCreate = useCallback(async (e: DrawEvent, draw?: any) => {
    const feature = e.features?.[0] as
      | Feature<Polygon, GeoJsonProperties>
      | undefined;
    if (!feature) return;
    const drawId = String((feature as any).id);
    const name = `B-${Date.now()}`;

    const ring = feature.geometry?.coordinates?.[0];
    if (!ring || ring.length < 2) return;

    let lat = 0;
    let lng = 0;
    for (const pt of ring.slice(0, -1)) {
      lng += pt[0];
      lat += pt[1];
    }
    lat /= ring.length - 1;
    lng /= ring.length - 1;

    try {
      const req: any = await fetch(withBasePath("/api/destination"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          lat,
          lng,
          polygon: JSON.stringify(feature),
        }),
      });

      const resp = await req.json();

      if (req.status !== 201) {
        toast.error(resp?.error);
        return;
      }

      const destId = Number(resp.id);
      const normalizedFeature = featureWithDestId(feature, destId, { name });
      try {
        draw?.delete?.(drawId);
        draw?.add?.(normalizedFeature);
      } catch {
        /* Draw id swap is best-effort; polys is the source of truth */
      }
      const polygon = JSON.stringify(normalizedFeature);

      setBuildingPolys((p) => [...p, normalizedFeature]);
      setBuildings((prev) => {
        const newList: BuildingRow[] = [
          ...prev,
          {
            id: Number(resp.id),
            name,
            lat,
            lng,
            polygon,
            isParkingLot: false,
            navigatableDestination: false,
            openTime: "00:00:00",
            closeTime: "23:59:59",
            parkingLotIds: [],
          },
        ];
        buildingsRef.current = newList;
        return newList;
      });
      setCurrentBuilding({
        id: Number(resp.id),
        name,
        lat,
        lng,
        polygon,
        isParkingLot: false,
        navigatableDestination: false,
        openTime: "00:00:00",
        closeTime: "23:59:59",
        parkingLotIds: [],
      });
    } catch (err) {
      console.error(err);
      toast.error("Failed to create destination.");
    }
  }, []);

  const onUpdate = useCallback(async (e: DrawEvent, draw?: any) => {
    const feature = e.features?.[0] as
      | Feature<Polygon, GeoJsonProperties>
      | undefined;
    if (!feature) return;
    const ring = feature.geometry?.coordinates?.[0];
    if (!ring || ring.length < 2) return;

    let lat = 0;
    let lng = 0;
    for (const pt of ring.slice(0, -1)) {
      lng += pt[0];
      lat += pt[1];
    }
    lat /= ring.length - 1;
    lng /= ring.length - 1;

    const destId = Number(feature?.properties?.destId);
    const stamped =
      Number.isFinite(destId) && destId > 0
        ? featureWithDestId(feature, destId)
        : feature;
    const polygon = JSON.stringify(stamped);

    try {
      const req: any = await fetch(withBasePath("/api/destination"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: destId,
          name: feature?.properties?.name,
          polygon,
          lat,
          lng,
        }),
      });
      const resp = await req.json();
      if (resp) {
        const row = buildingsRef.current.find((b) => b.id === destId);
        if (row?.isParkingLot) {
          setParkingPolys((old) =>
            old.map((p) =>
              Number(p.properties?.destId) === destId ? stamped : p,
            ),
          );
        } else {
          setBuildingPolys((old) =>
            old.map((p) =>
              Number(p.properties?.destId) === destId ? stamped : p,
            ),
          );
        }
        setCurrentBuilding((prev) => {
          return {
            ...prev,
            id: destId,
            name: feature?.properties?.name,
            lat,
            lng,
            polygon,
          };
        });
        setBuildings((prev) => {
          const next = prev.map((b) =>
            b.id === destId
              ? {
                  ...b,
                  name: feature?.properties?.name as string,
                  lat,
                  lng,
                  polygon,
                }
              : b,
          );
          buildingsRef.current = next;
          return next;
        });
      } else {
        toast.error(resp?.error ?? "Failed to update polygon");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to update destination polygon.");
    }
  }, []);

  const onDelete = useCallback((e: DrawEvent, draw?: any) => {
    for (const feature of e.features ?? []) {
      const destId = Number(feature.properties?.destId ?? feature.id);
      if (!buildingsRef.current.some((b) => b.id === destId)) continue;
      try {
        draw?.add?.(feature);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const onSelectionChange = useCallback((e: DrawEvent, draw?: any) => {
    if (!e.features || e.features.length === 0) return;
    const id = Number(e.features[0].properties?.destId);
    const b = buildingsRef.current.find((x) => Number(x.id) === id);
    if (b) {
      setCurrentBuilding(b);
    }
  }, []);

  const onModeChange = useCallback(() => {}, []);

  const buildingInfoSave = async () => {
    if (!currentBuilding.id) return toast.error("Select a building first.");
    let curBuildingCopy = currentBuilding;
    try {
      const resp = await fetch(withBasePath("/api/destination"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...curBuildingCopy }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        toast.error(data?.error ?? "Name could not be updated!");
        return;
      }
      toast.success("Name Updated!");
      setBuildings((prev) => {
        const next = prev.map((b) =>
          b.id === curBuildingCopy.id ? { ...b, ...curBuildingCopy } : b,
        );
        buildingsRef.current = next;
        return next;
      });
    } catch (err) {
      console.error(err);
      toast.error("Failed to save building info.");
    }
  };

  /** Render */
  if (isPending || !allowed) {
    return (
      <div
        className={`grid place-items-center bg-background text-foreground ${mapPageClass}`}
      >
        <Spinner className="size-10" />
      </div>
    );
  }

  return (
    <div
      className={`relative w-full bg-background text-foreground ${mapPageClass}`}
    >
      <div className="absolute left-3 top-3 z-30 flex items-center gap-2">
        <HomeLogoLink className="h-12 px-3 py-2 shadow-xl backdrop-blur" />
        <BasemapToggle
          basemap={basemap}
          onChange={(next) => {
            const map = mapRef.current?.getMap?.();
            setBasemap(next);
            if (!map) return;
            setMlMap(null);
            map.once("style.load", () => setMlMap(map as unknown as MlMap));
          }}
          className="h-12 w-12 shadow-xl backdrop-blur"
        />
        <ThemeToggleButton className="h-12 w-12 shadow-xl backdrop-blur" />
        <div className="flex h-12 overflow-hidden rounded-xl border border-border bg-background/90 shadow-xl backdrop-blur">
          <button
            type="button"
            className={[
              "min-h-12 px-3 text-xs font-semibold uppercase tracking-wide",
              editorMode === "shapes"
                ? "bg-brand-cta text-brand-cta-foreground"
                : "text-muted-foreground hover:bg-muted",
            ].join(" ")}
            onClick={() => switchEditorMode("shapes")}
          >
            Create / Edit
          </button>
          <button
            type="button"
            className={[
              "min-h-12 px-3 text-xs font-semibold uppercase tracking-wide",
              editorMode === "recommended_parking"
                ? "bg-brand-cta text-brand-cta-foreground"
                : "text-muted-foreground hover:bg-muted",
            ].join(" ")}
            onClick={() => switchEditorMode("recommended_parking")}
          >
            Recommended parking
          </button>
        </div>
        <Button
          type="button"
          className="h-12 bg-brand-cta text-brand-cta-foreground shadow-xl backdrop-blur hover:bg-brand-cta/90"
          disabled={importingOsmBuildings || editorMode !== "shapes"}
          onClick={() => void importOsmBuildings()}
          title="Import named campus buildings from OpenStreetMap"
        >
          {importingOsmBuildings ? (
            <>
              <Spinner className="size-4" />
              Importing…
            </>
          ) : (
            "Import OSM Buildings"
          )}
        </Button>
      </div>

      <EditPanel
        editorMode={editorMode}
        currentBuilding={currentBuilding}
        setCurrentBuilding={setCurrentBuilding}
        submitName={buildingInfoSave}
        onChangeIsParkingLot={onChangeIsParkingLot}
        onChangeNavigatableDestination={onChangeNavigatableDestination}
        onDeleteBuilding={() => setDeleteOpen(true)}
        onEditPolygon={() => {
          if (currentBuilding.id >= 0) beginPolygonEdit(currentBuilding.id);
        }}
        recommendedParkingNames={
          !currentBuilding.isParkingLot
            ? currentBuilding.parkingLotIds
                .map((id) => {
                  const lot = buildings.find((b) => b.id === id);
                  return lot
                    ? { id: lot.id, name: lot.name }
                    : { id, name: `Lot #${id}` };
                })
            : []
        }
        onRemoveRecommendedParking={(parkingLotId) => {
          void setRecommendedParkingIds(
            currentBuilding.id,
            currentBuilding.parkingLotIds.filter((id) => id !== parkingLotId),
          );
        }}
      />

      <div className="w-full h-full">
        {!canRenderMap ? (
          <div className="h-full w-full grid place-items-center text-sm opacity-70">
            Loading basemap...
          </div>
        ) : (
          <MapSection
            buildingPolys={buildingPolys}
            parkingPolys={parkingPolys}
            drawPolys={drawPolys}
            drawEnabled={editorMode === "shapes"}
            recommendedParkingIds={
              editorMode === "recommended_parking" &&
              currentBuilding.id >= 0 &&
              !currentBuilding.isParkingLot
                ? currentBuilding.parkingLotIds
                : []
            }
            selectedBuildingId={
              currentBuilding.id >= 0 && !currentBuilding.isParkingLot
                ? currentBuilding.id
                : null
            }
            mlMap={mlMap}
            mapRef={mapRef}
            stableViewState={stableViewState}
            mapStyle={resolvedMapStyle as StyleSpecification}
            onMapClick={onMapClick}
            onMapDblClick={onMapDblClick}
            onLoad={onLoad}
            onReady={onDrawReady}
            onCreate={onCreate}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onSelectionChange={onSelectionChange}
            onModeChange={onModeChange}
          />
        )}
      </div>

      <Dialog
        open={deleteOpen && currentBuilding.id >= 0}
        onOpenChange={(open) => {
          if (!open && !deletePending) setDeleteOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete destination</DialogTitle>
            <DialogDescription>
              This will permanently remove{" "}
              {currentBuilding.name.trim() ? (
                <span className="font-medium text-foreground">
                  {currentBuilding.name.trim()}
                </span>
              ) : (
                "this destination"
              )}
              , its indoor floor plan, and linked favorites / trip stops. This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deletePending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletePending}
              onClick={() => void confirmDeleteDestination()}
            >
              {deletePending ? (
                <>
                  <Spinner className="size-4" />
                  Deleting…
                </>
              ) : (
                "Delete destination"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
