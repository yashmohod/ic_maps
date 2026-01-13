// src/components/BuildingEditor.tsx
"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  JSX,
} from "react";
import toast, { Toaster } from "react-hot-toast";
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

import EditPanel from "@/components/BuildingInfoEditPanel";
import DrawControl from "@/components/BuildingDrawControls";
import { useAppTheme } from "@/hooks/use-app-theme";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";
import { HomeLogoLink } from "@/components/home-logo-link";
import { ThemeToggleButton } from "@/components/theme-toggle-button";

import {
  getAllBuildings,
  addBuilding,
  editBuildingName,
  updateBuildingPolyGon,
  deleteBuilding,
} from "@/lib/icmapsApi";

/** ---------------- Types ---------------- */

type ViewStateLite = {
  longitude: number;
  latitude: number;
  zoom: number;
};

type BuildingRow = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  polyGon: string; // JSON string of a GeoJSON Feature
};

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
        controls={{ polygon: true, trash: true }}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onSelectionChange={onSelectionChange}
        onModeChange={onModeChange}
      />
    </ReactMap>
  );
});

/** ---------------- Main Component ---------------- */

export default function BuildingEditor(): JSX.Element {
  const mapRef = useRef<MapRef | null>(null);
  const buildingsRef = useRef<BuildingRow[]>([]);
  const { isDark } = useAppTheme();

  const [mlMap, setMlMap] = useState<MlMap | null>(null);
  const [buildings, setBuildings] = useState<BuildingRow[]>([]);
  const [polys, setPolys] = useState<
    Array<Feature<Polygon, GeoJsonProperties>>
  >([]);

  const [currentBuilding, setCurrentBuilding] = useState<Partial<BuildingRow>>(
    {},
  );
  const [curEditName, setcurEditName] = useState<string>("");

  const stylePath = isDark
    ? "/styles/osm-bright/style-local-dark.json"
    : "/styles/osm-bright/style-local-light.json";
  const { baseStyle } = usePmtilesStyle({ stylePath });
  const canRenderMap = !!baseStyle;

  /** Stable initial map view */
  const stableViewState = useMemo<ViewStateLite>(
    () => ({
      longitude: -76.494131,
      latitude: 42.422108,
      zoom: 15.5,
    }),
    [],
  );

  /** Load buildings once */
  useEffect(() => {
    async function load() {
      const resp: any = await getAllBuildings();
      if (!resp) {
        toast.error("Buildings failed to load");
        return;
      }

      const list: BuildingRow[] = resp.buildings || [];
      setBuildings(list);
      buildingsRef.current = list;

      if (list.length > 0) {
        const features = list
          .map((b) => {
            try {
              return JSON.parse(b.polyGon) as Feature<
                Polygon,
                GeoJsonProperties
              >;
            } catch {
              return null;
            }
          })
          .filter(Boolean) as Array<Feature<Polygon, GeoJsonProperties>>;
        setPolys(features);
      }
    }
    void load();
  }, []);

  /** Handlers */
  const onLoad = useCallback(() => {
    const map = mapRef.current?.getMap?.();
    if (map) setMlMap(map as unknown as MlMap);
  }, []);

  const onMapClick = useCallback((_e: MapMouseEvent) => {
    setCurrentBuilding({});
    setcurEditName("");
  }, []);

  const onCreate = useCallback(async (e: DrawEvent) => {
    const feature = e.features?.[0] as
      | Feature<Polygon, GeoJsonProperties>
      | undefined;
    if (!feature) return;

    const name = `B-${Date.now()}`;

    const ring = feature.geometry?.coordinates?.[0];
    if (!ring || ring.length === 0) return;

    let lat = 0;
    let lng = 0;
    for (const pt of ring) {
      lng += pt[0];
      lat += pt[1];
    }
    lat /= ring.length;
    lng /= ring.length;

    // MapboxDraw ids can be string|number; normalize to string
    const buildingId = String(
      (feature as any).id ?? feature.properties?.id ?? "",
    );
    const polyGon = JSON.stringify({ ...feature, id: buildingId });

    const resp: any = await addBuilding(buildingId, name, lat, lng, polyGon);
    if (resp?.status !== 200) {
      toast.error("Could not add building");
      return;
    }

    const normalizedFeature = {
      ...(feature as any),
      id: buildingId,
    } as Feature<Polygon, GeoJsonProperties>;

    setPolys((p) => [...p, normalizedFeature]);
    setBuildings((prev) => {
      const newList: BuildingRow[] = [
        ...prev,
        { id: buildingId, name, lat, lng, polyGon },
      ];
      buildingsRef.current = newList;
      return newList;
    });

    setCurrentBuilding({ id: buildingId, name, lat, lng, polyGon });
    setcurEditName(name);
  }, []);

  const onUpdate = useCallback(async (e: DrawEvent) => {
    const f = e.features?.[0] as
      | Feature<Polygon, GeoJsonProperties>
      | undefined;
    if (!f) return;

    const ring = f.geometry?.coordinates?.[0];
    if (!ring || ring.length === 0) return;

    let lat = 0;
    let lng = 0;
    for (const pt of ring) {
      lng += pt[0];
      lat += pt[1];
    }
    lat /= ring.length;
    lng /= ring.length;

    const id = String((f as any).id ?? f.properties?.id ?? "");
    const updated: Feature<Polygon, GeoJsonProperties> = {
      ...(f as any),
      id,
    };
    const polyGon = JSON.stringify(updated);
    console.log(polyGon)

    const resp: any = await updateBuildingPolyGon(id, polyGon, lat, lng);
    if (resp) {
      setPolys((old) =>
        old.map((p) => (String((p as any).id) === id ? updated : p)),
      );
    } else {
      toast.error(resp?.message ?? "Failed to update polygon");
    }
  }, []);

  const onDelete = useCallback(
    async (e: DrawEvent) => {
      const f = e.features?.[0] as Feature | undefined;
      if (!f) return;

      const id = String((f as any).id ?? f.properties?.id ?? "");
      const resp: any = await deleteBuilding(id);

      if (resp) {
        setPolys((old) => old.filter((p) => String((p as any).id) !== id));
        if (String(currentBuilding.id ?? "") === id) {
          setCurrentBuilding({});
          setcurEditName("");
        }
      } else {
        toast.error(resp?.message ?? "Failed to delete building");
      }
    },
    [currentBuilding.id],
  );

  const onSelectionChange = useCallback((e: DrawEvent) => {
    if (!e.features || e.features.length === 0) return;
    const id = String(
      (e.features[0] as any).id ?? e.features[0].properties?.id ?? "",
    );
    const b = buildingsRef.current.find((x) => String(x.id) === id);
    if (b) {
      setCurrentBuilding(b);
      setcurEditName(b.name);
    } else {
      // Not fatal; Draw can have features not yet in backend
      console.log("building not found!");
    }
  }, []);

  const onModeChange = useCallback(() => { }, []);

  const buildingInfoSave = async () => {
    if (!currentBuilding.id) return toast.error("Select a building first.");
    const resp: any = await editBuildingName(
      String(currentBuilding.id),
      curEditName,
    );
    if (resp) {
      toast.success("Name Updated!");
      // keep local list in sync
      setBuildings((prev) => {
        const next = prev.map((b) =>
          String(b.id) === String(currentBuilding.id)
            ? { ...b, name: curEditName }
            : b,
        );
        buildingsRef.current = next;
        return next;
      });
      setCurrentBuilding((prev) => ({ ...prev, name: curEditName }));
    } else {
      toast.error(resp?.message ?? "Name could not be updated!");
    }
  };

  /** Render */
  return (
    <div className="relative h-screen w-full bg-background text-foreground">
      <Toaster position="top-right" reverseOrder />

      <div className="absolute left-3 top-3 z-30 flex items-center gap-2">
        <HomeLogoLink className="h-12 px-3 py-2 shadow-xl backdrop-blur" />
        <ThemeToggleButton className="h-12 w-12 shadow-xl backdrop-blur" />
      </div>

      <EditPanel
        curEditName={curEditName}
        currentBuilding={currentBuilding}
        setcurEditName={setcurEditName}
        submitName={buildingInfoSave}
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
            onCreate={onCreate}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onSelectionChange={onSelectionChange}
            onModeChange={onModeChange}
          />
        )}
      </div>
    </div>
  );
}
