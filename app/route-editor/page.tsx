// src/components/MapEditor.tsx
"use client";
import apiClient from "@/lib/apiClient";
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

import NavModes from "../../components/NavModeEditor";
import ComboboxSelect, { type ComboboxItem } from "@/components/DropDown";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppTheme } from "@/hooks/use-app-theme";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";
import { HomeLogoLink } from "@/components/home-logo-link";
import { ThemeToggleButton } from "@/components/theme-toggle-button";

import {
  addNode,
  addEdge,
  editNode,
  deleteFeature,
  setNavModeStatus,
  getAllBuildings,
  getAllBuildingNodes,
  attachNodeToBuilding,
  detachNodeFromBuilding,
  getAllMapFeaturesNavModeIds,
  getAllNavModes,
  setBlueLight,
} from "../../lib/icmapsApi";

/** ---------------- Types ---------------- */

type LngLat = { lng: number; lat: number };

type MarkerNode = {
  id: string;
  lng: number;
  lat: number;
  isBlueLight?: boolean;
};

type EdgeIndexEntry = {
  key: string;
  from: string;
  to: string;
  biDirectional?: boolean;
};

type Building = {
  id: string | number;
  name: string;
};

type NavMode = {
  id: string | number;
  name: string;
  fromThrough: boolean;
};

type ViewStateLite = {
  longitude: number;
  latitude: number;
  zoom: number;
};

type DragState = { draggingId: string | null };

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

  const curEdgeIndexRef = useRef<EdgeIndexEntry[]>(edgeIndex);
  useEffect(() => {
    curEdgeIndexRef.current = edgeIndex;
  }, [edgeIndex]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // NavMode (Sets)
  const [curNavModeNodes, setCurNavModeNodes] = useState<Set<string>>(
    () => new Set()
  );
  const [curNavModeEdges, setCurNavModeEdges] = useState<Set<string>>(
    () => new Set()
  );
  const [showOnlyNavMode, setShowOnlyNavMode] = useState<boolean>(false);
  const [curNavMode, setCurNavMode] = useState<string | number | null>(null);

  // Buildings
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [currentBuilding, setCurrentBuilding] = useState<
    string | number | null
  >(null);
  const [curBuildingNodes, setCurBuildingNodes] = useState<Set<string>>(
    () => new Set()
  );
  const [curBuildingOrder, setCurBuildingOrder] = useState<string[]>([]);
  const [showNavModeModal, setShowNavModeModal] = useState<boolean>(false);
  const [navModes, setNavModes] = useState<NavMode[]>([]);

  // UI
  type EditorMode =
    | "select"
    | "edit"
    | "delete"
    | "navMode"
    | "buildingGroup"
    | "blueLight";
  const [mode, setMode] = useState<EditorMode>("select");
  const [showNodes, setShowNodes] = useState<boolean>(true);

  const curNavModeRef = useRef<string | number | null>(curNavMode);
  useEffect(() => {
    curNavModeRef.current = curNavMode;
  }, [curNavMode]);

  const mapRef = useRef<MapRef | null>(null);
  const modeRef = useRef<EditorMode>(mode);
  const selectedRef = useRef<string | null>(selectedId);
  modeRef.current = mode;
  selectedRef.current = selectedId;

  /** ---------------- Helpers ---------------- */

  const edgeKey = (a: string, b: string) => [a, b].join("__");

  const findMarker = (id: string) => markers.find((m) => m.id === id) ?? null;

  const isNodeSelectedNavMode = (id: string) => curNavModeNodes.has(id);
  const isEdgeSelectedNavMode = (key: string) => curNavModeEdges.has(key);

  const getEdgeByKey = (key: string) =>
    edgeIndex.find((e) => e.key === key) ?? null;

  const hasAdjSelectedEdge = (nodeId: string) => {
    const edges = curEdgeIndexRef.current;
    return edges.some(
      (e) =>
        curNavModeEdges.has(e.key) && (e.from === nodeId || e.to === nodeId)
    );
  };

  /** ---------------- GeoJSON (Edges) ---------------- */

  const edgesGeoJSON = useMemo<
    FeatureCollection<LineString, GeoJsonProperties>
  >(() => {
    const coord = new Map<string, [number, number]>(
      markers.map((m) => [m.id, [m.lng, m.lat]])
    );

    const features: Array<Feature<LineString, GeoJsonProperties>> = [];

    for (const e of edgeIndex) {
      const a = coord.get(e.from);
      const b = coord.get(e.to);
      if (!a || !b) continue;

      if (
        showOnlyNavMode &&
        mode === "navMode" &&
        !isEdgeSelectedNavMode(e.key)
      ) {
        continue;
      }

      features.push({
        type: "Feature",
        properties: {
          key: e.key,
          from: e.from,
          to: e.to,
          ada: isEdgeSelectedNavMode(e.key) && mode === "navMode",
          bidir: Boolean(e.biDirectional),
        },
        geometry: { type: "LineString", coordinates: [a, b] },
      });
    }

    return { type: "FeatureCollection", features };
  }, [markers, edgeIndex, curNavModeEdges, mode, showOnlyNavMode]);

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

  async function addEdgeIfMissing(a: string, b: string) {
    if (a === b) return;
    if (!findMarker(a) || !findMarker(b)) return;
    const key = edgeKey(a, b);
    if (edgeIndex.some((e) => e.key === key)) return;

    const ok = await apiClient.post("/api/map", {
      key,
      a,
      b,
      type: "edge",
      biDirectionalEdges,
    });
    if (ok) {
      setEdgeIndex((list) => [
        ...list,
        { key, from: a, to: b, biDirectional: biDirectionalEdges },
      ]);
    } else {
      toast.error("Edge could not be added.");
    }
  }

  async function deleteNode(id: string) {
    const ok = await apiClient.del("/api/map", { featureKey: id, featureType: "node" });
    if (!ok) return toast.error("Feature could not be deleted.");

    setMarkers((prev) => prev.filter((m) => m.id !== id));
    setEdgeIndex((list) => list.filter((e) => e.from !== id && e.to !== id));

    setCurNavModeNodes((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    setCurBuildingNodes((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    setCurNavModeEdges((prev) => {
      const remove = new Set(
        edgeIndex.filter((e) => e.from === id || e.to === id).map((e) => e.key)
      );
      if (remove.size === 0) return prev;
      return new Set([...prev].filter((k) => !remove.has(k)));
    });

    setCurBuildingOrder((prev) => prev.filter((nid) => nid !== id));
    if (selectedRef.current === id) setSelectedId(null);
  }

  async function deleteEdgeByKey(key: string) {
    const ok = await apiClient.del("/api/map", { featureKey: key, featureType: "edge" });
    if (!ok) return toast.error("Feature could not be deleted.");

    setEdgeIndex((list) => list.filter((e) => e.key !== key));

    setCurNavModeEdges((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  /** ---------------- NavMode ops (Sets) ---------------- */

  function setNavModeNode(
    id: string,
    status: boolean,
    navModeId: string | number | null
  ) {
    if (!navModeId) return toast.error("Select a navigation mode first.");

    if (!status && hasAdjSelectedEdge(id)) {
      toast.error("Can't deselect a node adjacent to a selected ADA edge.");
      return;
    }

    setCurNavModeNodes((prev) => {
      const next = new Set(prev);
      if (status) next.add(id);
      else next.delete(id);
      void setNavModeStatus(id, status, "Node", String(navModeId));
      return next;
    });
  }

  function setNavModeEdge(key: string) {
    const navModeId = curNavModeRef.current;
    if (!navModeId) return toast.error("Select a navigation mode first.");

    const eic = curEdgeIndexRef.current;
    const edge = eic.find((e) => e.key === key) ?? null;
    if (!edge) return;

    const from = edge.from;
    const to = edge.to;

    setCurNavModeEdges((prev) => {
      const next = new Set(prev);
      const wasSelected = next.has(key);

      if (wasSelected) {
        next.delete(key);
        void setNavModeStatus(key, false, "Edge", String(navModeId));

        const stillAdj = (nodeId: string) =>
          [...next].some((k) => {
            const e = getEdgeByKey(k);
            return e && (e.from === nodeId || e.to === nodeId);
          });

        setCurNavModeNodes((prevNode) => {
          const nextNode = new Set(prevNode);
          if (!stillAdj(from)) {
            nextNode.delete(from);
            void setNavModeStatus(from, false, "Node", String(navModeId));
          }
          if (!stillAdj(to)) {
            nextNode.delete(to);
            void setNavModeStatus(to, false, "Node", String(navModeId));
          }
          return nextNode;
        });
      } else {
        next.add(key);
        void setNavModeStatus(key, true, "Edge", String(navModeId));

        setCurNavModeNodes((prevNode) => {
          const nextNode = new Set(prevNode);
          nextNode.add(to);
          nextNode.add(from);
          void setNavModeStatus(to, true, "Node", String(navModeId));
          void setNavModeStatus(from, true, "Node", String(navModeId));
          return nextNode;
        });
      }
      return next;
    });
  }

  /** ---------------- Buildings ---------------- */

  async function handelBuildingSelect(id: string | number) {
    setCurrentBuilding(id);
    const resp: any = await apiClient.get(`/api/building/nodesget?id=${encodeURIComponent(id)}`);

    const ids: string[] = (resp?.nodes || [])
      .map((n: any) => (typeof n === "string" ? n : n?.id))
      .filter(Boolean)
      .map((x: any) => String(x));

    setCurBuildingNodes(new Set(ids));
    setCurBuildingOrder(ids);
  }

  async function addToBuildingGroup(nodeId: string) {
    if (!currentBuilding) return toast.error("Select a building first.");

    const isSelected = curBuildingNodes.has(nodeId);

    if (isSelected) {
      const resp = await apiClient.post("/api/building/noderemove", { buildingId: String(currentBuilding), nodeId });
      if (!resp) return toast.error("Failed to detach node.");

      setCurBuildingNodes((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
      setCurBuildingOrder((prev) => prev.filter((id) => id !== nodeId));
    } else {
      const resp = await apiClient.post("/api/building/nodeadd", { buildingId: String(currentBuilding), nodeId });
      if (!resp) return toast.error("Failed to attach node.");

      setCurBuildingNodes((prev) => {
        const next = new Set(prev);
        next.add(nodeId);
        return next;
      });
      setCurBuildingOrder((prev) =>
        prev.includes(nodeId) ? prev : [...prev, nodeId]
      );
    }
  }

  async function clearAllBuildingNodes() {
    if (!currentBuilding || curBuildingNodes.size === 0) return;

    const ids = Array.from(curBuildingNodes);
    const results = await Promise.allSettled(
      ids.map((nid) => apiClient.post("/api/building/noderemove", { buildingId: String(currentBuilding), nid }))
    );

    const succeeded = ids.filter(
      (_, i) => results[i].status === "fulfilled" && (results[i] as any).value
    );

    if (succeeded.length === ids.length) {
      setCurBuildingNodes(new Set());
      setCurBuildingOrder([]);
    } else {
      toast.error("Some nodes failed to detach.");
      setCurBuildingNodes((prev) => {
        const next = new Set(prev);
        for (const id of succeeded) next.delete(id);
        return next;
      });
      setCurBuildingOrder((prev) =>
        prev.filter((id) => !succeeded.includes(id))
      );
    }
  }

  async function setBlueLightStatus(id: string) {
    const cur = markers.find((m) => m.id === id);
    if (!cur) return;

    const nextValue = !Boolean(cur.isBlueLight);
    const resp = await apiClient.post("/api/map/bluelight", { nodeId: id, isBlueLight: nextValue });

    if (resp) {
      setMarkers((prev) =>
        prev.map((m) => (m.id === id ? { ...m, isBlueLight: nextValue } : m))
      );
    } else {
      toast.error("Could not set marker as Blue Light.");
    }
  }

  /** ---------------- Map events ---------------- */

  async function handleMapClick(e: MapMouseEvent) {
    if ((e.originalEvent as MouseEvent | undefined)?.altKey) {
      const { lng, lat } = e.lngLat;
      const id = `n-${Date.now()}`;
      const ok = await apiClient.post("/api/map", { id, lng, lat, type: "node" });
      if (ok) setMarkers((prev) => [...prev, { id, lng, lat }]);
      else toast.error("Node could not be added.");
      return;
    }

    if (modeRef.current === "select" && selectedRef.current !== null) {
      setSelectedId(null);
    }
  }

  function handleMarkerClick(e: React.MouseEvent, id: string) {
    e.stopPropagation();

    if (modeRef.current === "delete") return void deleteNode(id);
    if (modeRef.current === "buildingGroup") return void addToBuildingGroup(id);
    if (modeRef.current === "navMode")
      return void setNavModeNode(
        id,
        !isNodeSelectedNavMode(id),
        curNavModeRef.current
      );
    if (modeRef.current === "blueLight") return void setBlueLightStatus(id);

    if (modeRef.current === "select") {
      const cur = selectedRef.current;
      if (cur === null) return void setSelectedId(id);
      if (cur === id) return void setSelectedId(null);
      void addEdgeIfMissing(cur, id);
      setSelectedId(null);
      return;
    }
  }

  async function handleMarkerDragEnd(e: any, id: string) {
    const { lng, lat } = e.lngLat as LngLat;
    const ok = await apiClient.put("/api/map", { id, lng, lat });
    if (ok) {
      setMarkers((prev) =>
        prev.map((m) => (m.id === id ? { ...m, lng, lat } : m))
      );
    } else {
      toast.error("Node could not be edited.");
    }
  }

  function handleEdgeLayerClick(e: MapLayerMouseEvent) {
    const f = e.features?.[0] as any;
    const key = f?.properties?.key as string | undefined;
    if (!key) return;

    if (modeRef.current === "navMode") return void setNavModeEdge(key);
    if (modeRef.current === "delete") return void deleteEdgeByKey(key);
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
    const resp: any = await apiClient.get("/api/map/all");;
    console.log(resp)
    setMarkers(
      (resp?.nodes ?? []).map((n: any) => ({
        id: String(n.id),
        lng: Number(n.lng),
        lat: Number(n.lat),
        isBlueLight: Boolean(n.isBlueLight),
      }))
    );

    setEdgeIndex(
      (resp?.edges ?? []).map((e: any) => ({
        key: String(e.key),
        from: String(e.from),
        to: String(e.to),
        biDirectional: Boolean(e.biDirectional),
      }))
    );
  }

  async function getBuildingsList() {
    const resp: any = await apiClient.get("/api/building");
    if (resp) setBuildings(resp.buildings || []);
    else toast.error("Buildings did not load!");
  }

  async function getNavModesList() {
    const resp: any = await apiClient.get("/api/navmode");
    const curNavModes: NavMode[] = resp?.NavModes ?? [];
    setNavModes(curNavModes);
    if (curNavModes.length > 0) {
      setCurNavMode(curNavModes[0].id);
      void getNavModeFeatures(curNavModes[0].id);
    }
  }

  async function getNavModeFeatures(navModeId: string | number) {
    const resp: any = await apiClient.get(
      `/api/navmode/allids?navModeId=${encodeURIComponent(String(navModeId))}`,
    );
    setCurNavModeEdges(new Set((resp?.edges ?? []).map((x: any) => String(x))));
    setCurNavModeNodes(new Set((resp?.nodes ?? []).map((x: any) => String(x))));
  }

  useEffect(() => {
    void getAllFeature();
    void getBuildingsList();
    //void getNavModesList();
    return () => {
      const map = mapRef.current?.getMap?.();
      if (!map) return;
      map.off("click", "graph-edges", handleEdgeLayerClick);
      map.off("mouseenter", "graph-edges", handleEdgeEnter);
      map.off("mouseleave", "graph-edges", handleEdgeLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode !== "navMode" && showOnlyNavMode) setShowOnlyNavMode(false);
  }, [mode, showOnlyNavMode]);

  /** ---------------- Export / Import ---------------- */

  function exportGeoJSON() {
    const nodeFeatures: Array<Feature<Point, GeoJsonProperties>> = markers.map(
      (m) => ({
        type: "Feature",
        id: m.id,
        properties: { id: m.id },
        geometry: { type: "Point", coordinates: [m.lng, m.lat] },
      })
    );

    const data: FeatureCollection = {
      type: "FeatureCollection",
      features: [...nodeFeatures, ...edgesGeoJSON.features],
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "graph.geojson";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importGeoJSON(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const fc = JSON.parse(String(reader.result));
        if (fc?.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
          alert("Invalid GeoJSON FeatureCollection.");
          return;
        }

        const nextMarkers: MarkerNode[] = [];
        const nextEdges: Array<{ key: string; from: string; to: string }> = [];

        for (const f of fc.features) {
          if (f?.geometry?.type === "Point") {
            const id = String(f.id ?? f.properties?.id ?? "");
            const [lng, lat] = f.geometry.coordinates || [];
            if (id && Number.isFinite(lng) && Number.isFinite(lat)) {
              nextMarkers.push({ id, lng, lat });
            }
          } else if (f?.geometry?.type === "LineString") {
            const from = f.properties?.from;
            const to = f.properties?.to;
            if (from && to) {
              nextEdges.push({
                key: edgeKey(String(from), String(to)),
                from: String(from),
                to: String(to),
              });
            }
          }
        }

        const ids = new Set(nextMarkers.map((m) => m.id));
        if (ids.size !== nextMarkers.length) {
          alert("Duplicate node ids in import.");
          return;
        }

        setMarkers(nextMarkers);

        const uniq: EdgeIndexEntry[] = [];
        const seen = new Set<string>();
        for (const e of nextEdges) {
          if (seen.has(e.key)) continue;
          seen.add(e.key);
          uniq.push({ ...e, biDirectional: true });
        }
        setEdgeIndex(uniq);

        setSelectedId(null);
        ev.target.value = "";
      } catch {
        alert("Failed to parse GeoJSON.");
      }
    };

    reader.readAsText(file);
  }

  function toggleNodes() {
    setShowNodes((v) => {
      if (v && selectedRef.current) setSelectedId(null);
      return !v;
    });
  }

  /** ---------------- DnD (building order) ---------------- */

  const dragState = useRef<DragState>({ draggingId: null });

  function onDragStart(id: string) {
    dragState.current.draggingId = id;
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function onDrop(overId: string) {
    const fromId = dragState.current.draggingId;
    dragState.current.draggingId = null;
    if (!fromId || fromId === overId) return;

    setCurBuildingOrder((prev) => {
      const ids = prev.filter((id) => curBuildingNodes.has(id));
      const fromIdx = ids.indexOf(fromId);
      const toIdx = ids.indexOf(overId);
      if (fromIdx < 0 || toIdx < 0) return prev;

      ids.splice(toIdx, 0, ids.splice(fromIdx, 1)[0]);

      const rest = prev.filter((id) => !curBuildingNodes.has(id));
      return [...ids, ...rest];
    });
  }

  function zoomToNode(id: string) {
    const m = findMarker(id);
    const map = mapRef.current?.getMap?.();
    if (!m || !map) return;
    map.flyTo({ center: [m.lng, m.lat], zoom: 18, essential: true });
  }

  /** ---------------- Combobox items ---------------- */

  const navModeItems = useMemo<ComboboxItem<string | number>[]>(() => {
    return navModes.map((m) => ({ value: m.id, label: m.name }));
  }, [navModes]);

  const buildingItems = useMemo<ComboboxItem<string | number>[]>(() => {
    return buildings.map((b) => ({ value: b.id, label: b.name }));
  }, [buildings]);

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
          className={`px-2 py-1 rounded ${mode === "buildingGroup"
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground"
            }`}
          onClick={() => setMode("buildingGroup")}
        >
          Building Select
        </button>

        <button
          className={`px-2 py-1 rounded ${mode === "blueLight"
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground"
            }`}
          onClick={() => setMode("blueLight")}
        >
          Blue Light
        </button>

        <div className="mx-2 w-px h-5 bg-border" />

        <button
          className="px-2 py-1 rounded bg-primary text-primary-foreground"
          onClick={exportGeoJSON}
        >
          Export
        </button>

        <label className="px-2 py-1 rounded bg-secondary text-secondary-foreground cursor-pointer">
          Import
          <input
            type="file"
            accept=".json,.geojson,application/geo+json"
            onChange={importGeoJSON}
            hidden
          />
        </label>

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
              void getNavModeFeatures(v);
            }}
            widthClassName="w-[280px]"
          />

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
            onClick={() => setShowNavModeModal(true)}
          >
            Manage Nav Modes
          </Button>
        </div>
      )}

      {/* Building selector (left, under toolbar) */}
      {mode === "buildingGroup" && (
        <div
          className={`absolute z-20 top-16 left-3 rounded-xl px-3 py-2 flex flex-wrap items-center gap-3 ${panelClass}`}
        >
          <ComboboxSelect
            label="Current Building"
            placeholder="Select building..."
            items={buildingItems}
            value={currentBuilding}
            onChange={(v) => void handelBuildingSelect(v)}
            widthClassName="w-[320px]"
          />

          <button
            className="text-xs px-2 py-1 rounded bg-secondary text-secondary-foreground disabled:opacity-50"
            disabled={!currentBuilding || curBuildingNodes.size === 0}
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
                mode === "buildingGroup" && curBuildingNodes.has(m.id);
              const isNavModeSel =
                mode === "navMode" && isNodeSelectedNavMode(m.id);
              const isBlueLightSel =
                mode === "blueLight" && Boolean(m.isBlueLight);
              const isDrawSel = mode === "select" && m.id === selectedId;

              if (mode === "navMode" && showOnlyNavMode && !isNavModeSel)
                return null;

              const colorClass = isBuildingSel
                ? "bg-amber-500"
                : isNavModeSel || isDrawSel || isBlueLightSel
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
          </ReactMap>
        )}
      </div>

      <Dialog open={showNavModeModal} onOpenChange={setShowNavModeModal}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Navigation Modes</DialogTitle>
          </DialogHeader>
          <NavModes navModes={navModes} getNavModes={getNavModesList} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
