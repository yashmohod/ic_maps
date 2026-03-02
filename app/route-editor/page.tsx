// src/components/MapEditor.tsx
"use client";
import React, { useMemo, useRef, useState, useEffect, type JSX } from "react";
import toast, { Toaster } from "react-hot-toast";
import {
  Map as ReactMap,
  Marker,
  Source,
  Layer,
  type MapRef,
  type ViewStateChangeEvent,
} from "@vis.gl/react-maplibre";

import maplibregl, {
  type MapLayerMouseEvent,
  type MapMouseEvent,
  type LineLayerSpecification,
  type SymbolLayerSpecification,
} from "maplibre-gl";
import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
  GeoJsonProperties,
} from "geojson";

import "maplibre-gl/dist/maplibre-gl.css";

import ComboboxSelect, { type ComboboxItem } from "@/components/DropDown";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppTheme } from "@/hooks/use-app-theme";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";
import { HomeLogoLink } from "@/components/home-logo-link";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import apiClient from "@/lib/apiClient";
/** ---------------- Types ---------------- */

type LngLat = { lng: number; lat: number };

type MarkerNode = {
  id: number;
  lng: number;
  lat: number;
  isBlueLight: boolean;
  isPedestrian: boolean;
  isVehicular: boolean;
  isStairs: boolean;
  isElevator: boolean;
};

type EdgeIndexEntry = {
  id: number;
  from: number;
  to: number;
  biDirectional: boolean;
  incline: number;
};

type Destination = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  polygon: string; // JSON string of a GeoJSON Feature
  isParkingLot: boolean;
};


type ViewStateLite = {
  longitude: number;
  latitude: number;
  zoom: number;
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
/** ---------------- Component ---------------- */

export default function RouteEditor(): JSX.Element {
  const [viewState, setViewState] = useState<ViewStateLite>({
    longitude: -76.494131,
    latitude: 42.422108,
    zoom: 15.5,
  });
  const { isDark } = useAppTheme();
  const stylePath = isDark
    ? "/styles/osm-bright/style-local-dark.json"
    : "/styles/osm-bright/style-local-light.json";
  const { baseStyle } = usePmtilesStyle({ stylePath });
  const canRenderMap = !!baseStyle;
  const panelClass =
    "border border-border bg-panel text-panel-foreground shadow backdrop-blur";

  // Graph
  const [markers, setMarkers] = useState<MarkerNode[]>([]);
  const [edgeIndex, setEdgeIndex] = useState<EdgeIndexEntry[]>([]);
  const [biDirectionalEdges, setBiDirectionalEdges] = useState<boolean>(true);

  const [markersToNormalize, setMarkersToNormalize] = useState<number[]>([]);

  const curEdgeIndexRef = useRef<EdgeIndexEntry[]>(edgeIndex);
  useEffect(() => {
    curEdgeIndexRef.current = edgeIndex;
  }, [edgeIndex]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<number | null>(null);
  const [inclineInput, setInclineInput] = useState<string>("0");



  // Buildings
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [currentDestination, setCurrentDestination] = useState<
    Destination | null
  >(null);
  const [curDestinationNodes, setCurDestinationNodes] = useState<Set<number>>(
    () => new Set()
  );

  type NavModeKey = 0 | 1 | 3 | 4 | 5;

  type MarkerFlagKey = keyof Pick<
    MarkerNode,
    "isPedestrian" | "isVehicular" | "isElevator" | "isStairs" | "isBlueLight"
  >;

  type NavModeInfo = { name: string; param: MarkerFlagKey };

  const [curNavMode, setCurNavMode] = useState<NavModeKey>(0);

  const navModes = {
    0: { name: "Pedestrian", param: "isPedestrian" },
    1: { name: "Vehicular", param: "isVehicular" },
    3: { name: "Elevator", param: "isElevator" },
    4: { name: "Stairs", param: "isStairs" },
    5: { name: "Blue Light", param: "isBlueLight" },
  } satisfies Record<NavModeKey, NavModeInfo>;
  // UI
  type EditorMode =
    | "select"
    | "edit"
    | "delete"
    | "navMode"
    | "destination"
    ;
  const [mode, setMode] = useState<EditorMode>("select");
  const [showNodes, setShowNodes] = useState<boolean>(true);


  const mapRef = useRef<MapRef | null>(null);
  const modeRef = useRef<EditorMode>(mode);
  const selectedRef = useRef<number | null>(selectedId);
  modeRef.current = mode;
  selectedRef.current = selectedId;

  /** ---------------- Helpers ---------------- */

  const findMarker = (id: number) => markers.find((m) => m.id === id) ?? null;


  /** ---------------- GeoJSON (Edges) ---------------- */

  const edgesGeoJSON = useMemo<
    FeatureCollection<LineString, GeoJsonProperties>
  >(() => {
    const features: Array<Feature<LineString, GeoJsonProperties>> = [];

    for (const e of edgeIndex) {
      const a = markers.find((m) => m.id === e.from);
      const b = markers.find((m) => m.id === e.to);

      if (!a || !b) continue;
      let nmc = false;
      if (mode == "navMode" && a[navModes[curNavMode].param] && b[navModes[curNavMode].param]) nmc = true;

      const edgeId = e.id ?? (e as { key?: number }).key;
      features.push({
        type: "Feature",
        properties: {
          key: edgeId,
          from: e.from,
          to: e.to,
          ada: nmc,
          bidir: Boolean(e.biDirectional),
        },
        geometry: { type: "LineString", coordinates: [[a.lng, a.lat], [b.lng, b.lat]] },
      });
    }

    return { type: "FeatureCollection", features };
  }, [markers, edgeIndex, mode]);

  /** ---------------- Layer specs (typed) ---------------- */

  const lineLayer = useMemo<LineLayerSpecification>(
    () => ({
      id: "graph-edges",
      type: "line",
      source: "edges",
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-width": ["case", ["boolean", ["get", "ada"], false], 6, 5],
        "line-color": [
          "case",
          ["boolean", ["get", "ada"], true],
          "#16a34a",
          ["boolean", ["get", "bidir"], true],
          "#1E88E5",
          "#F57C00",
        ],
        "line-opacity": 0.95,
      },
    }),
    []
  );

  const oneWayArrows = useMemo<SymbolLayerSpecification>(
    () => ({
      id: "oneway-arrows",
      type: "symbol",
      source: "edges",
      filter: ["all", ["!", ["to-boolean", ["get", "bidir"]]]],
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 60,
        "text-field": "▶",
        "text-size": 14,
        "text-rotation-alignment": "map",
        "text-keep-upright": false,
        "text-offset": [0, 0],
      },
      paint: {
        "text-color": "#a35a00ff",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1,
      },
    }),
    []
  );

  /** ---------------- Graph ops ---------------- */

  async function addEdgeIfMissing(from: number, to: number) {
    if (from === to) return;
    if (!findMarker(from) || !findMarker(to)) return;

    const req = await apiClient.post("/api/map/edge", {
      from,
      to,
      biDirectionalEdges,
    });
    console.log(req)
    const resp = await req.json()
    console.log(resp)
    if (req.status === 201) {
      setEdgeIndex((list) => [
        ...list,
        {
          id: resp?.id ?? "",
          from: resp?.a ?? "",
          to: resp?.b ?? "",
          biDirectional: biDirectionalEdges,
          incline: 0,
        },
      ]);
    } else {
      toast.error("Edge could not be added.");
    }
  }

  async function deleteNode(id: number) {
    const req = await apiClient.del("/api/map/node", { id });
    if (req.status !== 200) return toast.error("Feature could not be deleted.");

    setMarkers((prev) => prev.filter((m) => m.id !== id));
    setEdgeIndex((list) => list.filter((e) => e.from !== id && e.to !== id));


    setCurDestinationNodes((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    if (selectedRef.current === id) setSelectedId(null);
  }

  async function deleteEdgeByKey(id: number) {
    const req = await apiClient.del("/api/map/edge", { id });
    if (req.status !== 200) return toast.error("Feature could not be deleted.");

    setEdgeIndex((list) =>
      list.filter(
        (e) => e.id !== id && (e as { key?: number }).key !== id,
      ),
    );
  }

  async function setEdgeIncline(edgeId: number, incline: number) {
    const req = await apiClient.post("/api/map/incline", { id: edgeId, incline });
    if (req.status !== 200) {
      toast.error("Could not update incline.");
      return;
    }
    setEdgeIndex((list) =>
      list.map((e) =>
        e.id === edgeId || (e as { key?: number }).key === edgeId
          ? { ...e, id: e.id ?? edgeId, incline }
          : e,
      ),
    );
    toast.success("Incline updated.");
  }



  /** ---------------- NavMode ops (Sets) ---------------- */

  async function setNavModeNode(id: number) {
    const nm = navModes[curNavMode];
    if (!nm) return toast.error("Select a navigation mode first.");

    const cur = markers.find((m) => m.id === id);
    if (!cur) return;

    let nextValue = !cur[nm.param];
    console.log(id, nm.param)
    const req = await apiClient.post("/api/map/setFeatureStatus", { id, value: nextValue, navMode: nm.param })
    const resp = await req.json();
    console.log(req, resp)

    if (req.status === 200) {
      setMarkers((prev) =>
        prev.map((m) => (m.id === id ? { ...m, [nm.param]: nextValue } : m)),
      );
    } else {
      toast.error("Could not add node to the Navmode.");
    }
  }



  /** ---------------- Buildings ---------------- */

  async function handelBuildingSelect(id: number) {
    const curDest = destinations.find((cur) => cur.id == id);
    if (!curDest) {
      toast.error("Could not load the current building");
      return;
    }
    console.log(id, curDest)
    setCurrentDestination(curDest);
    const req: any = await apiClient.get(`/api/destination/outsideNode?id=${encodeURIComponent(id)}`);
    const resp = await req.json();
    console.log(resp)
    const ids: number[] = (resp?.nodes || [])
    setCurDestinationNodes(new Set(ids));
  }

  async function addToBuildingGroup(nodeId: number) {
    if (!currentDestination) return toast.error("Select a building first.");

    const isSelected = curDestinationNodes.has(nodeId);

    if (isSelected) {
      const req = await apiClient.del("/api/destination/outsideNode", { destId: currentDestination.id, nodeId });
      if (req.status !== 200) return toast.error("Failed to detach node.");

      setCurDestinationNodes((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });

    } else {
      const req = await apiClient.post("/api/destination/outsideNode", { destId: currentDestination.id, nodeId });

      if (req.status !== 200) return toast.error("Failed to attach node.");

      setCurDestinationNodes((prev) => {
        const next = new Set(prev);
        next.add(nodeId);
        return next;
      });

    }
  }

  async function clearAllBuildingNodes() {
    if (!currentDestination || curDestinationNodes.size === 0) return;

    const ids = Array.from(curDestinationNodes);
    const results = await Promise.allSettled(
      ids.map((nid) => apiClient.del("/api/destination/outsideNode", { destId: currentDestination.id, nodeId: nid }))
    );
    // setCurDestinationNodes(new Set())
  }


  /** ---------------- Map events ---------------- */

  //add node
  async function handleMapClick(e: MapMouseEvent) {
    if ((e.originalEvent as MouseEvent | undefined)?.altKey) {
      const { lng, lat } = e.lngLat;
      const req = await apiClient.post("/api/map/node", { lng, lat });
      const resp = await req.json();
      console.log(resp)
      if (req.status === 201) setMarkers((prev) => [...prev, {
        id: resp.id,
        lng,
        lat,
        isPedestrian: false,
        isVehicular: false,
        isStairs: false,
        isElevator: false,
        isBlueLight: false
      }]);
      else {
        const msg = (resp as { detail?: string; error?: string }).detail
          ?? (resp as { detail?: string; error?: string }).error
          ?? "Node could not be added.";
        toast.error(msg);
      }
      return;
    }

    if (modeRef.current === "select") {
      if (selectedRef.current !== null) setSelectedId(null);
      setSelectedEdgeId(null);
    }
  }

  function handleMarkerClick(e: React.MouseEvent, id: number) {
    e.stopPropagation();

    if (modeRef.current === "delete") return void deleteNode(id);
    if (modeRef.current === "destination") return void addToBuildingGroup(id);
    if (modeRef.current === "navMode") return void setNavModeNode(id);

    if (modeRef.current === "select") {
      const cur = selectedRef.current;
      if (cur === null) return void setSelectedId(id);
      if (cur === id) return void setSelectedId(null);
      void addEdgeIfMissing(cur, id);
      setSelectedId(null);
      return;
    }
  }

  async function handleMarkerDragEnd(e: any, id: number) {
    const { lng, lat } = e.lngLat as LngLat;
    const req = await apiClient.put("/api/map/node", { id, lng, lat });
    if (req.status === 200) {
      setMarkers((prev) =>
        prev.map((m) => (m.id === id ? { ...m, lng, lat } : m))
      );
    } else {
      toast.error("Node could not be edited.");
    }
  }

  function handleEdgeLayerClick(e: MapLayerMouseEvent) {
    const f = e.features?.[0] as any;
    const key = f?.properties?.key as number | undefined;
    if (!key) return;
    if (modeRef.current === "delete") return void deleteEdgeByKey(key);
    if (modeRef.current === "select") {
      setSelectedEdgeId(key);
      return;
    }
  }

  function handleEdgeEnter() {
    const map = mapRef.current?.getMap?.();
    if (map) map.getCanvas().style.cursor = "pointer";
  }
  function handleEdgeLeave() {
    const map = mapRef.current?.getMap?.();
    if (map) map.getCanvas().style.cursor = "";
  }

  function handleLoad() {
    const map = mapRef.current?.getMap?.();
    if (!map) return;

    map.off("click", "graph-edges", handleEdgeLayerClick);
    map.off("mouseenter", "graph-edges", handleEdgeEnter);
    map.off("mouseleave", "graph-edges", handleEdgeLeave);

    map.on("click", "graph-edges", handleEdgeLayerClick);
    map.on("mouseenter", "graph-edges", handleEdgeEnter);
    map.on("mouseleave", "graph-edges", handleEdgeLeave);
  }

  /** ---------------- Data loading ---------------- */

  async function getAllFeature() {
    const req = await apiClient.get("/api/map/all")
    if (req.status !== 200) {
      toast.error("Failed to fetch map features!");
      return;
    }
    const data = await req.json()
    setMarkers(
      data.nodes as MarkerNode[]
    );
    setEdgeIndex(
      data.edges as EdgeIndexEntry[]
    );
  }

  async function getBuildingsList() {
    const req = await apiClient.get("/api/destination");
    if (req.status !== 200) {
      toast.error("Buildings did not load!");
      return;
    }
    const resp = await req.json();
    setDestinations(resp.destinations || []);
  }




  // Selected edge for toolbox (support both id and key from API)
  const selectedEdge =
    selectedEdgeId === null
      ? null
      : edgeIndex.find((e) => e.id === selectedEdgeId) ??
      edgeIndex.find((e) => (e as { key?: number }).key === selectedEdgeId);

  useEffect(() => {
    if (selectedEdgeId === null) return;
    const edge =
      edgeIndex.find((e) => e.id === selectedEdgeId) ??
      edgeIndex.find((e) => (e as { key?: number }).key === selectedEdgeId);
    setInclineInput(String(edge?.incline ?? 0));
  }, [selectedEdgeId, edgeIndex]);

  useEffect(() => {
    void getAllFeature();
    void getBuildingsList();
    return () => {
      const map = mapRef.current?.getMap?.();
      if (!map) return;
      map.off("click", "graph-edges", handleEdgeLayerClick);
      map.off("mouseenter", "graph-edges", handleEdgeEnter);
      map.off("mouseleave", "graph-edges", handleEdgeLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  function toggleNodes() {
    setShowNodes((v) => {
      if (v && selectedRef.current) setSelectedId(null);
      return !v;
    });
  }


  /** ---------------- Combobox items ---------------- */
  const navModeItems: ComboboxItem<NavModeKey>[] =
    (Object.keys(navModes) as unknown as NavModeKey[]).map((k) => ({
      value: k,
      label: navModes[k].name,
    }));


  const destinationItems = useMemo<ComboboxItem<string | number>[]>(() => {
    return destinations.map((b) => ({ value: b.id, label: b.name }));
  }, [destinations]);


  /* --------------------- Import / Export ----------------------*/

  function exportMapData() {

  }

  function importMapData() {

  }

  /** ---------------- Render ---------------- */

  return (
    <div className="relative h-screen w-full bg-background text-foreground">
      <Toaster position="top-right" reverseOrder />

      <div className="absolute right-3 top-3 z-30 flex items-center gap-2">
        <HomeLogoLink className="h-12 px-3 py-2 shadow-xl backdrop-blur" />
        <ThemeToggleButton className="h-12 w-12 shadow-xl backdrop-blur" />
      </div>

      {/* Top Toolbar */}
      <div
        className={`absolute z-20 top-3 left-3 rounded-xl px-3 py-2 flex flex-wrap items-center gap-2 ${panelClass}`}
      >
        <span className="text-sm font-medium">Mode:</span>

        <button
          className={`px-2 py-1 rounded ${mode === "select"
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground"
            }`}
          onClick={() => setMode("select")}
        >
          Draw
        </button>

        <button
          className={`px-2 py-1 rounded ${mode === "edit"
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground"
            }`}
          onClick={() => setMode("edit")}
        >
          Edit
        </button>

        <button
          className={`px-2 py-1 rounded ${mode === "delete"
            ? "bg-destructive text-white"
            : "bg-secondary text-secondary-foreground"
            }`}
          onClick={() => setMode("delete")}
        >
          Delete
        </button>

        <button
          className={`px-2 py-1 rounded ${mode === "navMode"
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground"
            }`}
          onClick={() => setMode("navMode")}
        >
          Map Mode Select
        </button>

        <button
          className={`px-2 py-1 rounded ${mode === "destination"
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground"
            }`}
          onClick={() => setMode("destination")}
        >
          Building Select
        </button>


        <div className="mx-2 w-px h-5 bg-border" />

        {/* <button
          className="px-2 py-1 rounded bg-primary text-primary-foreground"
        // onClick={exportMapData}
        >
          Export
        </button>

        <label className="px-2 py-1 rounded bg-secondary text-secondary-foreground cursor-pointer">
          Import
          <input
            type="file"
            accept=".json,.geojson,application/geo+json"
            // onChange={importMapData}
            hidden
          />
        </label> */}

        <div className="mx-2 w-px h-5 bg-border" />

        <button
          className="px-2 py-1 rounded bg-secondary text-secondary-foreground"
          onClick={toggleNodes}
        >
          {showNodes ? "Hide Nodes" : "Show Nodes"}
        </button>
      </div>



      {mode === "select" && (
        <div
          className={`absolute z-20 top-16 left-3 rounded-xl px-3 py-2 flex items-center gap-3 ${panelClass}`}
        >
          <span className="text-sm font-medium">Bi Directional Mode</span>
          <button
            onClick={() => {
              setBiDirectionalEdges(!biDirectionalEdges);
            }}
            className={`px-2 py-1 rounded ${!biDirectionalEdges
              ? "bg-destructive text-white"
              : "bg-secondary text-secondary-foreground"
              }`}
          >
            {biDirectionalEdges ? "On" : "Off"}
          </button>

          {!biDirectionalEdges ? (
            <>
              <div className="mx-2 w-px h-5 bg-border" />
              <span className="text-sm font-medium">
                Note: The order of marker selection decides the direction of the
                edge!
              </span>
            </>
          ) : null}
        </div>
      )}

      {/* Edge incline toolbox: shown in select mode when an edge is selected */}
      {mode === "select" && selectedEdgeId !== null && (
        <div
          className={`absolute z-20 top-40 left-3 rounded-xl px-3 py-2 flex flex-wrap items-center gap-3 ${panelClass}`}
        >
          <span className="text-sm font-medium">Edge incline (m)</span>
          <Input
            type="number"
            step="0.1"
            min="-100"
            max="100"
            value={inclineInput}
            onChange={(e) => setInclineInput(e.target.value)}
            className="w-24 h-8"
            placeholder="0"
          />
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const value = Number.parseFloat(inclineInput);
              if (!Number.isFinite(value)) {
                toast.error("Enter a valid number.");
                return;
              }
              void setEdgeIncline(selectedEdgeId, value);
            }}
          >
            Set incline
          </Button>
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setSelectedEdgeId(null)}
            aria-label="Close"
          >
            Close
          </button>
        </div>
      )}

      {/* Nav mode selector (left, under toolbar) */}
      {mode === "navMode" && (
        <div
          className={`absolute z-20 top-16 left-3 rounded-xl px-3 py-2 flex flex-wrap items-center gap-3 ${panelClass}`}
        >
          <ComboboxSelect
            label="Navigation Mode"
            placeholder="Select Nav Mode..."
            items={navModeItems}
            value={curNavMode}
            onChange={(v) => {
              setCurNavMode(v);
            }}
            widthClassName="w-[280px]"
          />
          {/* 
          <button
            className={`px-2 py-1 rounded ${showOnlyNavMode
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground"
              }`}
            onClick={() => setShowOnlyNavMode((v) => !v)}
            title={
              showOnlyNavMode ? "Show all edges" : "Show only selected edges"
            }
          >
            {showOnlyNavMode ? "Show All" : "Show Only Selected"}
          </button>

          <Button
            type="button"
            variant="secondary"
            onClick={() => { console.log(curNavMode) }}
          >
            Manage Nav Modes
          </Button>
          */}
        </div>
      )}

      {/* Building selector (left, under toolbar) */}
      {mode === "destination" && (
        <div
          className={`absolute z-20 top-16 left-3 rounded-xl px-3 py-2 flex flex-wrap items-center gap-3 ${panelClass}`}
        >
          <ComboboxSelect
            label="Current Building"
            placeholder="Select building..."
            items={destinationItems}
            value={currentDestination?.name ?? ""}
            onChange={(v) => void handelBuildingSelect(Number(v))}
            widthClassName="w-[320px]"
          />

          <button
            className="text-xs px-2 py-1 rounded bg-secondary text-secondary-foreground disabled:opacity-50"
            disabled={!currentDestination || curDestinationNodes.size === 0}
            onClick={clearAllBuildingNodes}
            title="Detach all nodes from current building"
          >
            Clear all
          </button>
        </div>
      )}

      <div className="w-full h-full">
        {!canRenderMap ? (
          <div className="h-full w-full grid place-items-center text-sm opacity-70">
            Loading basemap...
          </div>
        ) : (
          <ReactMap
            ref={mapRef}
            longitude={viewState.longitude}
            latitude={viewState.latitude}
            zoom={viewState.zoom}
            onMove={(evt: ViewStateChangeEvent) =>
              setViewState({
                longitude: evt.viewState.longitude,
                latitude: evt.viewState.latitude,
                zoom: evt.viewState.zoom,
              })
            }
            onClick={handleMapClick as any}
            mapLib={maplibregl}
            mapStyle={baseStyle as any}
            onLoad={handleLoad}
            style={{ width: "100%", height: "100%" }}
          >
            <Source id="edges" type="geojson" data={edgesGeoJSON}>
              <Layer {...(lineLayer as any)} />
              <Layer {...(oneWayArrows as any)} />
            </Source>


            {markers.map((m) => {
              const isBuildingSel =
                mode === "destination" && curDestinationNodes.has(m.id);
              const isNavModeSet =
                mode === "navMode" && Boolean(m[navModes[curNavMode].param]);
              const isDrawSel = mode === "select" && m.id === selectedId;
              if (mode === "navMode" && false)
                return null;

              const colorClass = isBuildingSel
                ? "bg-amber-500"
                : isNavModeSet || isDrawSel
                  ? "bg-destructive"
                  : "bg-brand";

              return (
                <Marker
                  key={m.id}
                  longitude={m.lng}
                  latitude={m.lat}
                  anchor="center"
                  draggable={mode === "edit"}
                  onDragEnd={(e) => handleMarkerDragEnd(e, m.id)}
                >
                  <button
                    onClick={(e) => handleMarkerClick(e, m.id)}
                    onContextMenu={(e) => e.preventDefault()}
                    aria-label={`marker-${m.id}`}
                    className={`rounded-full border-2 shadow ${colorClass} border-white`}
                    style={{
                      width: 16,
                      height: 16,
                      cursor: "pointer",
                      boxSizing: "content-box",
                      opacity: showNodes ? 1 : 0,
                      pointerEvents: showNodes ? "auto" : "none",
                    }}
                    title={`${m.id} (${m.lng.toFixed(5)}, ${m.lat.toFixed(5)})`}
                  />
                </Marker>
              );
            })}

            {mode === "destination" && currentDestination && (
              <Source id="boundary" type="geojson" data={(JSON.parse(currentDestination.polygon) as GeoJSONFeatureCollection) ?? null}>
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


          </ReactMap>
        )}
      </div>

    </div>
  );
}
