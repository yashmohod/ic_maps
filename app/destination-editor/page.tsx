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
} from "@/components/BuildingInfoEditPanel";
import DrawControl from "@/components/BuildingDrawControls";
import { useMapStyle } from "@/hooks/use-map-style";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";
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
  polys: Array<Feature<Polygon, GeoJsonProperties>>;
  mlMap: MlMap | null;
  mapRef: React.RefObject<MapRef | null>;
  stableViewState: ViewStateLite;
  mapStyle: StyleSpecification;
  onMapClick: (e: MapMouseEvent) => void;
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
  polys,
  mlMap,
  mapRef,
  stableViewState,
  mapStyle,
  onMapClick,
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
      onLoad={onLoad}
      // Some versions don't accept className; wrapper handles sizing anyway
      mapLib={maplibregl}
      mapStyle={mapStyle}
      style={{ width: "100%", height: "100%" }}
    >
      <DrawControl
        map={mlMap}
        polys={polys}
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
  openTime: "00:00:00",
  closeTime: "23:59:59",
});

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
    changeMode: (mode: string) => void;
  } | null>(null);
  const { isDark, mapStyle } = useMapStyle();

  const [mlMap, setMlMap] = useState<MlMap | null>(null);
  const [buildings, setBuildings] = useState<BuildingRow[]>([]);
  const [importingOsmBuildings, setImportingOsmBuildings] = useState(false);
  const [polys, setPolys] = useState<
    Array<Feature<Polygon, GeoJsonProperties>>
  >([]);

  const [currentBuilding, setCurrentBuilding] = useState<BuildingRow>(emptyBuilding);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);

  const { baseStyle } = usePmtilesStyle({ stylePath: mapStyle });
  const canRenderMap = !!baseStyle;

  /** Stable initial map view */
  const stableViewState = useMemo<ViewStateLite>(
    () => ({
      longitude: DEFAULT_CENTER.lng,
      latitude: DEFAULT_CENTER.lat,
      zoom: DEFAULT_ZOOM,
    }),
    [],
  );

  async function loadDestinations() {
    try {
      const resp: any = await fetch(withBasePath("/api/destination")).then(
        (r) => r.json(),
      );
      if (!resp) {
        toast.error("Buildings failed to load");
        return;
      }

      const list: BuildingRow[] = resp.destinations || [];
      setBuildings(list);
      buildingsRef.current = list;

      if (list.length > 0) {
        const features = list
          .map((b) => {
            try {
              const polyJ = JSON.parse(b.polygon) as Feature<
                Polygon,
                GeoJsonProperties
              >;
              return featureWithDestId(polyJ, b.id, { name: b.name });
            } catch {
              return null;
            }
          })
          .filter(Boolean) as Array<Feature<Polygon, GeoJsonProperties>>;
        setPolys(features);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load destinations.");
    }
  }
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

      setCurrentBuilding((prev) => ({
        ...prev,
        isParkingLot: v,
        ...(v ? { openTime: "00:00:00", closeTime: "23:59:59" } : {}),
      }));
      setBuildings((prev) => {
        const next = prev.map((b) =>
          b.id === currentBuilding.id
            ? {
                ...b,
                isParkingLot: v,
                ...(v ? { openTime: "00:00:00", closeTime: "23:59:59" } : {}),
              }
            : b,
        );
        buildingsRef.current = next;
        return next;
      });
    } catch (err) {
      console.error(err);
      toast.error("Failed to update parking lot status.");
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

  const onMapClick = useCallback((_e: MapMouseEvent) => {
    setDeleteOpen(false);
    setCurrentBuilding(emptyBuilding());
  }, []);

  const dropDestinationLocally = useCallback((destId: number) => {
    buildingsRef.current = buildingsRef.current.filter((b) => b.id !== destId);
    setBuildings(buildingsRef.current);
    setPolys((prev) =>
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

      setPolys((p) => [...p, normalizedFeature]);
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
            openTime: "00:00:00",
            closeTime: "23:59:59",
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
        openTime: "00:00:00",
        closeTime: "23:59:59",
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
        setPolys((old) =>
          old.map((p) =>
            Number(p.properties?.destId) === destId ? stamped : p,
          ),
        );
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
        <ThemeToggleButton className="h-12 w-12 shadow-xl backdrop-blur" />
        <Button
          type="button"
          className="h-12 bg-brand-cta text-brand-cta-foreground shadow-xl backdrop-blur hover:bg-brand-cta/90"
          disabled={importingOsmBuildings}
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
        currentBuilding={currentBuilding}
        setCurrentBuilding={setCurrentBuilding}
        submitName={buildingInfoSave}
        onChangeIsParkingLot={onChangeIsParkingLot}
        onDeleteBuilding={() => setDeleteOpen(true)}
      />

      <div className="w-full h-full">
        {!canRenderMap ? (
          <div className="h-full w-full grid place-items-center text-sm opacity-70">
            Loading basemap...
          </div>
        ) : (
          <MapSection
            polys={polys}
            mlMap={mlMap}
            mapRef={mapRef}
            stableViewState={stableViewState}
            mapStyle={baseStyle as StyleSpecification}
            onMapClick={onMapClick}
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
