// src/components/BuildingEditor.tsx
"use client";
import apiClient from "@/lib/apiClient"
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

/** ---------------- Types ---------------- */

type ViewStateLite = {
  longitude: number;
  latitude: number;
  zoom: number;
};

export type BuildingRow = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  polygon: string; // JSON string of a GeoJSON Feature
  isParkingLot: boolean;
  openTime: string;
  closeTime: string;
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



  const [currentBuilding, setCurrentBuilding] = useState<BuildingRow>(
    {
      id: -1,
      name: "",
      lat: -1,
      lng: -1,
      polygon: "", // JSON string of a GeoJSON Feature
      isParkingLot: false,
      openTime: "00:00:00",
      closeTime: "23:59:59",
    }
  );

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

  async function loadDestinations() {
    const resp: any = await apiClient.get("/api/destination").then((r) => r.json());
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
            return polyJ
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Array<Feature<Polygon, GeoJsonProperties>>;
      setPolys(features);
    }
  }
  async function onChangeIsParkingLot(v: boolean) {
    if (!currentBuilding) return;
    const req = await apiClient.post("/api/destination/setParkingLot", { id: currentBuilding.id, isParkingLot: v })
    if (req.status !== 200) {
      const resp = await req.json();
      toast.error(resp.error);
      console.log(resp.detail)
    }

    setCurrentBuilding((prev) => {
      prev.isParkingLot = v;
      if (v) {
        prev.openTime = "00:00:00";
        prev.closeTime = "23:59:59";
      }
      return prev;
    })
  }

  useEffect(() => {
    loadDestinations();
  }, []);

  /** Handlers */
  const onLoad = useCallback(() => {
    const map = mapRef.current?.getMap?.();
    if (map) setMlMap(map as unknown as MlMap);
  }, []);

  const onMapClick = useCallback((_e: MapMouseEvent) => {
    setCurrentBuilding({
      id: -1,
      name: "",
      lat: -1,
      lng: -1,
      polygon: "", // JSON string of a GeoJSON Feature
      isParkingLot: false,
      openTime: "00:00:00",
      closeTime: "23:59:59",
    });
  }, []);

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


    const req: any = await apiClient.post("/api/destination",
      { name, lat, lng, polygon: JSON.stringify(feature) });

    const resp = await req.json();


    if (req.status !== 201) {
      toast.error(resp?.error);
      console.log(resp?.detail);
      return;
    }

    draw?.setFeatureProperty?.(drawId, "destId", Number(resp.id));
    draw?.setFeatureProperty?.(drawId, "name", name);
    const normalizedFeature = {
      ...(feature as any),
      properties: { destId: resp.id, name: name }
    } as Feature<Polygon, GeoJsonProperties>;
    const polygon = JSON.stringify(normalizedFeature);


    setPolys((p) => [...p, normalizedFeature]);
    setBuildings((prev) => {
      const newList: BuildingRow[] = [
        ...prev,
        { id: Number(resp.id), name, lat, lng, polygon, isParkingLot: false, openTime: "00:00:00", closeTime: "23:59:59" },
      ];
      buildingsRef.current = newList;
      return newList;
    });
    // loadDestinations();
    setCurrentBuilding({ id: Number(resp.id), name, lat, lng, polygon, isParkingLot: false, openTime: "00:00:00", closeTime: "23:59:59" });

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


    const polygon = JSON.stringify(feature);

    const req: any = await apiClient.put("/api/destination", { id: feature?.properties?.destId, name: feature?.properties?.name, polygon, lat, lng });
    const resp = await req.json();
    if (resp) {
      setPolys((old) =>
        old.map((p) => (Number(p.properties?.destId) === feature?.properties?.destId ? feature : p)),
      );
      setCurrentBuilding((prev) => { return { ...prev, id: Number(feature?.properties?.destId), name: feature?.properties?.name, lat, lng, polygon } });
    } else {
      toast.error(resp?.error ?? "Failed to update polygon");
      console.log(resp.detail)
    }
  }, []);

  const onDelete = useCallback(
    async (e: DrawEvent, draw?: any) => {
      // const f = e.features?.[0] as Feature | undefined;
      // if (!f) return;

      // const id = String(f.properties?.id ?? "");
      // const resp: any = await deleteBuilding(id);

      // if (resp) {
      //   setPolys((old) => old.filter((p) => String((p.properties?.id) !== id)));
      //   if (String(currentBuilding.id ?? "") === id) {
      //     setCurrentBuilding({});
      //     setcurEditName("");
      //   }
      // } else {
      //   toast.error(resp?.message ?? "Failed to delete building");
      // }
    },
    [currentBuilding.id],
  );

  const onSelectionChange = useCallback((e: DrawEvent, draw?: any) => {
    if (!e.features || e.features.length === 0) return;
    const id = Number(e.features[0].properties?.destId);
    const b = buildingsRef.current.find((x) => Number(x.id) === id);
    if (b) {
      setCurrentBuilding(b);
    }
  }, []);

  const onModeChange = useCallback(() => { }, []);

  const buildingInfoSave = async () => {
    if (!currentBuilding.id) return toast.error("Select a building first.");
    let curBuildingCopy = currentBuilding;
    console.log(curBuildingCopy)
    const resp: any = await apiClient.put("/api/destination", { ...curBuildingCopy })
    if (resp) {
      toast.success("Name Updated!");
      // keep local list in sync

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
        currentBuilding={currentBuilding}
        setCurrentBuilding={setCurrentBuilding}
        submitName={buildingInfoSave}
        onChangeIsParkingLot={onChangeIsParkingLot}
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
