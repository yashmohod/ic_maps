"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  Link2,
  MousePointer2,
  Pencil,
  Plus,
  Share2,
  Trash2,
  Type,
  UserPlus,
} from "lucide-react";
import {
  Map as ReactMap,
  Marker,
  Source,
  Layer,
  type MapRef,
  type ViewStateChangeEvent,
} from "@vis.gl/react-maplibre";
import maplibregl, {
  type LineLayerSpecification,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import type MapLibreDraw from "maplibre-gl-draw";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  LineString,
  Point,
  Polygon,
} from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

import DrawControl from "@/components/BuildingDrawControls";
import { HomeLogoLink } from "@/components/home-logo-link";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useMapStyle } from "@/hooks/use-map-style";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";
import { useRequireAuth } from "@/hooks/use-require-auth";
import apiClient from "@/lib/apiClient";
import { withBasePath } from "@/lib/base-path";
import { bearingTo, calcDistance } from "@/lib/geo";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/map-constants";
import {
  borderMutedClass,
  mapPageClass,
  panelClass,
  safeAreaTopClass,
  surfacePanelClass,
  surfaceSubtleClass,
} from "@/lib/panel-classes";
import type { EdgeIndexEntry, ViewStateLite } from "@/lib/types/map";

type OwnedMap = {
  id: number;
  name: string;
  is_public_view: boolean;
  owner_id: string;
  created_at: string | Date;
};

type SharedMap = OwnedMap & { role: string };

type Collaborator = {
  collaborator_id: string;
  role: string;
  name: string;
  email: string;
};

type SimpleNode = {
  id: number;
  lat: number;
  lng: number;
  name: string;
};

type PolygonRow = { id: number; name: string; polygon: string };
type LineRow = { id: number; name: string; geometry: string };
type PointRow = { id: number; name: string; lat: number; lng: number };
type TextRow = {
  id: number;
  text: string;
  lat: number;
  lng: number;
  font_size: number;
};

type MapAccess = {
  role: "owner" | "editor" | "viewer" | null;
  isOwner: boolean;
  canEdit: boolean;
  canManageSharing: boolean;
};

type EditorMode = "select" | "draw" | "text" | "delete";
type DrawTool = "point" | "line" | "polygon";

type DrawEvent = { features: Feature[] };

const NODE_SNAP_METERS = 14;

function clampFontSize(n: number): number {
  if (!Number.isFinite(n)) return 14;
  return Math.min(48, Math.max(10, Math.round(n)));
}

function deleteDrawFeature(
  draw: MapLibreDraw | null | undefined,
  feature: Feature,
) {
  if (!draw || feature.id == null) return;
  try {
    draw.delete(String(feature.id));
  } catch {
    /* ignore */
  }
}

function ringCentroid(
  ring: Array<[number, number]>,
): { lng: number; lat: number } | null {
  if (!ring.length) return null;
  const closed =
    ring.length > 1 &&
    ring[0]![0] === ring[ring.length - 1]![0] &&
    ring[0]![1] === ring[ring.length - 1]![1];
  const n = closed ? ring.length - 1 : ring.length;
  if (n <= 0) return null;
  let lng = 0;
  let lat = 0;
  for (let i = 0; i < n; i++) {
    lng += ring[i]![0];
    lat += ring[i]![1];
  }
  return { lng: lng / n, lat: lat / n };
}

function featureCentroid(
  feature: Feature,
): { lng: number; lat: number } | null {
  const g = feature.geometry;
  if (!g) return null;
  if (g.type === "Point") {
    return { lng: g.coordinates[0], lat: g.coordinates[1] };
  }
  if (g.type === "LineString") {
    const coords = g.coordinates as Array<[number, number]>;
    if (!coords.length) return null;
    if (coords.length >= 2) {
      const mid = Math.floor((coords.length - 1) / 2);
      const a = coords[mid]!;
      const b = coords[mid + 1] ?? a;
      return { lng: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2 };
    }
    return { lng: coords[0]![0], lat: coords[0]![1] };
  }
  if (g.type === "Polygon") {
    return ringCentroid(g.coordinates[0] as Array<[number, number]>);
  }
  return null;
}

function translateCoords(coords: unknown, dLng: number, dLat: number): unknown {
  if (
    Array.isArray(coords) &&
    coords.length >= 2 &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number"
  ) {
    return [coords[0] + dLng, coords[1] + dLat];
  }
  if (Array.isArray(coords)) {
    return coords.map((c) => translateCoords(c, dLng, dLat));
  }
  return coords;
}

function translateFeature(
  feature: Feature,
  dLng: number,
  dLat: number,
): Feature {
  if (!feature.geometry) return feature;
  const geometry = feature.geometry as {
    type: string;
    coordinates: unknown;
    bbox?: unknown;
  };
  return {
    ...feature,
    geometry: {
      type: geometry.type,
      coordinates: translateCoords(geometry.coordinates, dLng, dLat),
    } as Feature["geometry"],
  };
}

function parsePolygonFeature(
  raw: string,
): Feature<Polygon, GeoJsonProperties> | null {
  try {
    const obj = JSON.parse(raw);
    if (obj?.type === "Feature" && obj.geometry?.type === "Polygon") {
      return obj as Feature<Polygon, GeoJsonProperties>;
    }
    if (obj?.type === "Polygon") {
      return { type: "Feature", properties: {}, geometry: obj };
    }
    if (obj?.type === "FeatureCollection" && obj.features?.[0]) {
      return obj.features[0] as Feature<Polygon, GeoJsonProperties>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function parseLineFeature(
  raw: string,
): Feature<LineString, GeoJsonProperties> | null {
  try {
    const obj = JSON.parse(raw);
    if (obj?.type === "Feature" && obj.geometry?.type === "LineString") {
      return obj as Feature<LineString, GeoJsonProperties>;
    }
    if (obj?.type === "LineString") {
      return { type: "Feature", properties: {}, geometry: obj };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function pointRowToFeature(row: PointRow): Feature<Point, GeoJsonProperties> {
  return {
    type: "Feature",
    id: `point-${row.id}`,
    properties: {
      id: `point-${row.id}`,
      pointId: row.id,
      name: row.name ?? "",
    },
    geometry: {
      type: "Point",
      coordinates: [row.lng, row.lat],
    },
  };
}

export default function MyMapsWorkspacePage(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { allowed, isPending: authPending } = useRequireAuth("/mymaps");

  const mapIdParam = searchParams.get("mapId");
  const selectedMapId =
    mapIdParam && Number.isInteger(Number(mapIdParam)) && Number(mapIdParam) > 0
      ? Number(mapIdParam)
      : null;

  const [ownedMaps, setOwnedMaps] = useState<OwnedMap[]>([]);
  const [sharedMaps, setSharedMaps] = useState<SharedMap[]>([]);
  const [listLoading, setListLoading] = useState(true);

  const [newName, setNewName] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [savePending, setSavePending] = useState(false);

  const [inviteMapId, setInviteMapId] = useState<number | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"viewer" | "editor">("viewer");
  const [invitePending, setInvitePending] = useState(false);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);

  const [viewState, setViewState] = useState<ViewStateLite>({
    longitude: DEFAULT_CENTER.lng,
    latitude: DEFAULT_CENTER.lat,
    zoom: DEFAULT_ZOOM,
  });
  const { mapStyle } = useMapStyle();
  const { baseStyle } = usePmtilesStyle({ stylePath: mapStyle });
  const canRenderMap = !!baseStyle;
  const mapRef = useRef<MapRef | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [clientReady, setClientReady] = useState(false);

  useEffect(() => {
    setClientReady(true);
  }, []);

  useEffect(() => {
    setMapReady(false);
  }, [selectedMapId]);

  const [mapName, setMapName] = useState("");
  const [access, setAccess] = useState<MapAccess | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [nodes, setNodes] = useState<SimpleNode[]>([]);
  const [edges, setEdges] = useState<EdgeIndexEntry[]>([]);
  const [polygons, setPolygons] = useState<PolygonRow[]>([]);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [points, setPoints] = useState<PointRow[]>([]);
  const [texts, setTexts] = useState<TextRow[]>([]);
  const [mode, setMode] = useState<EditorMode>("select");
  const [drawTool, setDrawTool] = useState<DrawTool>("point");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [biDirectional, setBiDirectional] = useState(true);
  const biDirectionalRef = useRef(biDirectional);
  biDirectionalRef.current = biDirectional;

  const [selectedPolygonId, setSelectedPolygonId] = useState<number | null>(
    null,
  );
  const [polygonName, setPolygonName] = useState("");
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<number | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [textFontSizeInput, setTextFontSizeInput] = useState("14");

  const modeRef = useRef(mode);
  const selectedRef = useRef(selectedId);
  const canEditRef = useRef(false);
  const nodesRef = useRef<SimpleNode[]>([]);
  const polygonsRef = useRef<PolygonRow[]>([]);
  const linesRef = useRef<LineRow[]>([]);
  const drawApiRef = useRef<MapLibreDraw | null>(null);
  const geomDragRef = useRef<{
    kind: "poly" | "line";
    id: number;
    startLng: number;
    startLat: number;
    base: string;
  } | null>(null);
  modeRef.current = mode;
  selectedRef.current = selectedId;
  canEditRef.current = Boolean(access?.canEdit);
  nodesRef.current = nodes;
  polygonsRef.current = polygons;
  linesRef.current = lines;

  function selectMap(id: number | null) {
    if (id == null) {
      router.replace("/mymaps");
      return;
    }
    router.replace(`/mymaps?mapId=${id}`);
  }

  const loadMaps = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/mymaps/maps");
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Could not load maps");
        return;
      }
      const data = await res.json();
      setOwnedMaps(data.owned_maps ?? []);
      setSharedMaps(data.collaboration_maps ?? []);
    } catch {
      toast.error("Could not load maps");
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadMap = useCallback(async (mapId: number) => {
    setEditorLoading(true);
    setAccess(null);
    setNodes([]);
    setEdges([]);
    setPolygons([]);
    setLines([]);
    setPoints([]);
    setTexts([]);
    setSelectedId(null);
    setSelectedPolygonId(null);
    setSelectedTextId(null);
    setMode("select");
    try {
      const res = await apiClient.get(`/api/mymaps/maps/${mapId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Could not load map");
        return;
      }
      const data = await res.json();
      setMapName(data.map?.name ?? "Untitled");
      setAccess(data.access ?? null);
      setNodes(
        (data.nodes ?? []).map(
          (n: { id: number; lat: number; lng: number; name?: string }) => ({
            id: n.id,
            lat: n.lat,
            lng: n.lng,
            name: n.name ?? "",
          }),
        ),
      );
      setEdges(
        (data.edges ?? []).map(
          (e: {
            id: number;
            node_a_id: number;
            node_b_id: number;
            bi_directional: boolean;
            direction: boolean;
            incline?: number;
          }) => ({
            id: e.id,
            from: e.direction ? e.node_a_id : e.node_b_id,
            to: e.direction ? e.node_b_id : e.node_a_id,
            biDirectional: Boolean(e.bi_directional),
            incline: e.incline ?? 0,
          }),
        ),
      );
      setPolygons(data.polygons ?? []);
      setLines(data.lines ?? []);
      setPoints(data.points ?? []);
      setTexts(data.texts ?? []);
    } catch {
      toast.error("Could not load map");
    } finally {
      setEditorLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void loadMaps();
  }, [allowed, loadMaps]);

  useEffect(() => {
    if (!allowed || selectedMapId == null) return;
    void loadMap(selectedMapId);
  }, [allowed, selectedMapId, loadMap]);

  const polyFeatures = useMemo(() => {
    const out: Feature[] = [];
    for (const row of polygons) {
      const f = parsePolygonFeature(row.polygon);
      if (!f) continue;
      const id = `poly-${row.id}`;
      f.id = id;
      f.properties = {
        ...(f.properties ?? {}),
        id,
        polygonId: row.id,
        name: row.name,
      };
      out.push(f);
    }
    return out;
  }, [polygons]);

  const lineFeatures = useMemo(() => {
    const out: Feature[] = [];
    for (const row of lines) {
      const f = parseLineFeature(row.geometry);
      if (!f) continue;
      const id = `line-${row.id}`;
      f.id = id;
      f.properties = {
        ...(f.properties ?? {}),
        id,
        lineId: row.id,
        name: row.name,
      };
      out.push(f);
    }
    return out;
  }, [lines]);

  const pointFeatures = useMemo(() => points.map(pointRowToFeature), [points]);

  // Draw is create-only (no sync of saved features) to avoid duplicate flash.
  const drawFeatures = useMemo(() => [] as Feature[], []);

  useEffect(() => {
    const draw = drawApiRef.current;
    if (!draw || mode !== "draw") return;
    const next =
      drawTool === "point"
        ? "draw_point"
        : drawTool === "line"
          ? "draw_line_string"
          : "draw_polygon";
    try {
      (draw as { changeMode: (m: string) => void }).changeMode(next);
    } catch {
      /* ignore */
    }
  }, [mode, drawTool, mapReady]);

  const edgesGeoJSON = useMemo<
    FeatureCollection<LineString, GeoJsonProperties>
  >(() => {
    const features: Array<Feature<LineString, GeoJsonProperties>> = [];
    for (const e of edges) {
      const a = nodes.find((n) => n.id === e.from);
      const b = nodes.find((n) => n.id === e.to);
      if (!a || !b) continue;
      features.push({
        type: "Feature",
        properties: {
          id: e.id,
          // MapLibre expression-friendly 1/0 (avoid boolean property quirks)
          bidir: e.biDirectional ? 1 : 0,
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [a.lng, a.lat],
            [b.lng, b.lat],
          ],
        },
      });
    }
    return { type: "FeatureCollection", features };
  }, [edges, nodes]);

  const edgeLayerBidir = useMemo<LineLayerSpecification>(
    () => ({
      id: "mymap-edges-bidir",
      type: "line",
      source: "mymap-edges",
      filter: ["==", ["get", "bidir"], 1],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#35D5A4",
        "line-width": 4,
        "line-opacity": 0.95,
      },
    }),
    [],
  );

  const edgeLayerOneWay = useMemo<LineLayerSpecification>(
    () => ({
      id: "mymap-edges-oneway",
      type: "line",
      source: "mymap-edges",
      filter: ["==", ["get", "bidir"], 0],
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": "#003c71",
        "line-width": 4,
        "line-opacity": 0.95,
        "line-dasharray": [2, 1.5],
      },
    }),
    [],
  );

  async function createMap() {
    const name = newName.trim();
    if (!name) {
      toast.error("Enter a map name");
      return;
    }
    setCreatePending(true);
    try {
      const res = await apiClient.post("/api/mymaps/maps", { name });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Could not create map");
        return;
      }
      const data = await res.json();
      setNewName("");
      toast.success("Map created");
      await loadMaps();
      if (data.map?.id) selectMap(data.map.id);
    } finally {
      setCreatePending(false);
    }
  }

  async function saveRename(id: number) {
    const name = editName.trim();
    if (!name) {
      toast.error("Name cannot be empty");
      return;
    }
    setSavePending(true);
    try {
      const res = await apiClient.put("/api/mymaps/maps", { id, name });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Could not rename map");
        return;
      }
      setEditingId(null);
      toast.success("Map renamed");
      await loadMaps();
      if (selectedMapId === id) setMapName(name);
    } finally {
      setSavePending(false);
    }
  }

  async function togglePublic(map: OwnedMap) {
    const res = await apiClient.put("/api/mymaps/maps", {
      id: map.id,
      is_public_view: !map.is_public_view,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Could not update visibility");
      return;
    }
    toast.success(
      map.is_public_view ? "Map is now private" : "Map is now public",
    );
    await loadMaps();
  }

  async function deleteMap(id: number) {
    if (
      !confirm(
        "Delete this map and all of its nodes, edges, drawings, and texts?",
      )
    ) {
      return;
    }
    const res = await apiClient.del(`/api/mymaps/maps?id=${id}`);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Could not delete map");
      return;
    }
    toast.success("Map deleted");
    if (selectedMapId === id) selectMap(null);
    await loadMaps();
  }

  async function openInvite(mapId: number) {
    setInviteMapId(mapId);
    setInviteEmail("");
    setInviteRole("viewer");
    const res = await apiClient.get(
      `/api/mymaps/maps/collaborator?mapId=${mapId}`,
    );
    if (res.ok) {
      const data = await res.json();
      setCollaborators(data.collaborators ?? []);
    } else {
      setCollaborators([]);
    }
  }

  async function addCollaborator() {
    if (inviteMapId == null) return;
    const email = inviteEmail.trim();
    if (!email) {
      toast.error("Enter a user email");
      return;
    }
    setInvitePending(true);
    try {
      const res = await apiClient.post("/api/mymaps/maps/collaborator", {
        mapId: inviteMapId,
        email,
        role: inviteRole,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Could not add collaborator");
        return;
      }
      toast.success("Collaborator added");
      setInviteEmail("");
      await openInvite(inviteMapId);
    } finally {
      setInvitePending(false);
    }
  }

  async function removeCollaborator(collaboratorId: string) {
    if (inviteMapId == null) return;
    const res = await apiClient.del(
      `/api/mymaps/maps/collaborator?mapId=${inviteMapId}&collaboratorId=${encodeURIComponent(collaboratorId)}`,
    );
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Could not remove collaborator");
      return;
    }
    toast.success("Collaborator removed");
    await openInvite(inviteMapId);
  }

  function copyShareLink(id: number) {
    const url = `${window.location.origin}${withBasePath(`/mymaps/${id}/view`)}`;
    void navigator.clipboard.writeText(url).then(
      () => toast.success("Share link copied"),
      () => toast.error("Could not copy link"),
    );
  }

  async function addNode(lat: number, lng: number): Promise<SimpleNode | null> {
    if (!selectedMapId || !canEditRef.current) return null;
    const res = await apiClient.post(
      `/api/mymaps/maps/${selectedMapId}/nodes`,
      { lat, lng, name: "" },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Could not add node");
      return null;
    }
    const data = await res.json();
    const node = data.node as SimpleNode;
    setNodes((prev) => [...prev, node]);
    nodesRef.current = [...nodesRef.current, node];
    return node;
  }

  async function resolveNodeAt(
    lat: number,
    lng: number,
  ): Promise<SimpleNode | null> {
    const near = nodesRef.current.find(
      (n) => calcDistance(n.lat, n.lng, lat, lng) <= NODE_SNAP_METERS,
    );
    if (near) return near;
    return addNode(lat, lng);
  }

  async function connectNodes(from: number, to: number) {
    if (!selectedMapId || !canEditRef.current || from === to) return;
    const bidir = biDirectionalRef.current;
    const res = await apiClient.post(
      `/api/mymaps/maps/${selectedMapId}/edges`,
      { from, to, biDirectional: bidir },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Could not add edge");
      return;
    }
    const data = await res.json();
    setEdges((prev) => [
      ...prev,
      {
        id: data.edge.id,
        from: data.from,
        to: data.to,
        biDirectional: bidir,
        incline: 0,
      },
    ]);
  }

  async function deleteNode(id: number) {
    if (!selectedMapId || !canEditRef.current) return;
    const res = await apiClient.del(
      `/api/mymaps/maps/${selectedMapId}/nodes?nodeId=${id}`,
    );
    if (!res.ok) {
      toast.error("Could not delete node");
      return;
    }
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    if (selectedRef.current === id) setSelectedId(null);
  }

  async function deleteEdge(id: number) {
    if (!selectedMapId || !canEditRef.current) return;
    const res = await apiClient.del(
      `/api/mymaps/maps/${selectedMapId}/edges?edgeId=${id}`,
    );
    if (!res.ok) {
      toast.error("Could not delete edge");
      return;
    }
    setEdges((prev) => prev.filter((e) => e.id !== id));
  }

  async function deletePolygon(id: number) {
    if (!selectedMapId || !canEditRef.current) return;
    const res = await apiClient.del(
      `/api/mymaps/maps/${selectedMapId}/polygons?polygonId=${id}`,
    );
    if (!res.ok) {
      toast.error("Could not delete polygon");
      return;
    }
    setPolygons((prev) => prev.filter((p) => p.id !== id));
    if (selectedPolygonId === id) {
      setSelectedPolygonId(null);
      setPolygonName("");
    }
  }

  async function deleteLine(id: number) {
    if (!selectedMapId || !canEditRef.current) return;
    const res = await apiClient.del(
      `/api/mymaps/maps/${selectedMapId}/lines?lineId=${id}`,
    );
    if (!res.ok) {
      toast.error("Could not delete line");
      return;
    }
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  async function deletePoint(id: number) {
    if (!selectedMapId || !canEditRef.current) return;
    const res = await apiClient.del(
      `/api/mymaps/maps/${selectedMapId}/points?pointId=${id}`,
    );
    if (!res.ok) {
      toast.error("Could not delete point");
      return;
    }
    setPoints((prev) => prev.filter((p) => p.id !== id));
  }

  async function deleteText(id: number) {
    if (!selectedMapId || !canEditRef.current) return;
    const res = await apiClient.del(
      `/api/mymaps/maps/${selectedMapId}/texts?textId=${id}`,
    );
    if (!res.ok) {
      toast.error("Could not delete text");
      return;
    }
    setTexts((prev) => prev.filter((t) => t.id !== id));
    if (selectedTextId === id) {
      setSelectedTextId(null);
      setTextDraft("");
    }
  }

  async function addText(lat: number, lng: number) {
    if (!selectedMapId || !canEditRef.current) return;
    const res = await apiClient.post(
      `/api/mymaps/maps/${selectedMapId}/texts`,
      { text: "New text", lat, lng, font_size: 14 },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Could not add text");
      return;
    }
    const data = await res.json();
    const row = data.text as TextRow;
    setTexts((prev) => [...prev, row]);
    setSelectedTextId(row.id);
    setTextDraft(row.text);
    setTextFontSizeInput(String(row.font_size ?? 14));
  }

  async function moveText(id: number, lat: number, lng: number) {
    if (!selectedMapId || !canEditRef.current) return;
    setTexts((prev) => prev.map((t) => (t.id === id ? { ...t, lat, lng } : t)));
    const res = await apiClient.put(`/api/mymaps/maps/${selectedMapId}/texts`, {
      textId: id,
      lat,
      lng,
    });
    if (!res.ok) {
      toast.error("Could not move text");
      return;
    }
    const data = await res.json();
    setTexts((prev) => prev.map((t) => (t.id === id ? data.text : t)));
  }

  async function moveNode(id: number, lat: number, lng: number) {
    if (!selectedMapId || !canEditRef.current) return;
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, lat, lng } : n)));
    nodesRef.current = nodesRef.current.map((n) =>
      n.id === id ? { ...n, lat, lng } : n,
    );
    const res = await apiClient.put(`/api/mymaps/maps/${selectedMapId}/nodes`, {
      nodeId: id,
      lat,
      lng,
    });
    if (!res.ok) {
      toast.error("Could not move node");
      return;
    }
    const data = await res.json();
    setNodes((prev) =>
      prev.map((n) => (n.id === id ? (data.node as SimpleNode) : n)),
    );
  }

  async function movePoint(id: number, lat: number, lng: number) {
    if (!selectedMapId || !canEditRef.current) return;
    setPoints((prev) =>
      prev.map((p) => (p.id === id ? { ...p, lat, lng } : p)),
    );
    const res = await apiClient.put(
      `/api/mymaps/maps/${selectedMapId}/points`,
      {
        pointId: id,
        lat,
        lng,
      },
    );
    if (!res.ok) {
      toast.error("Could not move point");
      return;
    }
    const data = await res.json();
    setPoints((prev) =>
      prev.map((p) => (p.id === id ? (data.point as PointRow) : p)),
    );
  }

  async function persistPolygon(polygonId: number) {
    if (!selectedMapId || !canEditRef.current) return;
    const row = polygonsRef.current.find((p) => p.id === polygonId);
    if (!row) return;
    const feature = parsePolygonFeature(row.polygon);
    if (!feature) return;
    const res = await apiClient.put(
      `/api/mymaps/maps/${selectedMapId}/polygons`,
      { polygonId, polygon: feature, name: row.name },
    );
    if (!res.ok) {
      toast.error("Could not move polygon");
      return;
    }
    const data = await res.json();
    setPolygons((prev) =>
      prev.map((p) => (p.id === polygonId ? data.polygon : p)),
    );
  }

  async function persistLine(lineId: number) {
    if (!selectedMapId || !canEditRef.current) return;
    const row = linesRef.current.find((l) => l.id === lineId);
    if (!row) return;
    const feature = parseLineFeature(row.geometry);
    if (!feature) return;
    const res = await apiClient.put(`/api/mymaps/maps/${selectedMapId}/lines`, {
      lineId,
      geometry: feature,
      name: row.name,
    });
    if (!res.ok) {
      toast.error("Could not move line");
      return;
    }
    const data = await res.json();
    setLines((prev) => prev.map((l) => (l.id === lineId ? data.line : l)));
  }

  async function saveTextDraft() {
    if (!selectedMapId || selectedTextId == null || !access?.canEdit) return;
    const text = textDraft.trim();
    if (!text) {
      toast.error("Text cannot be empty");
      return;
    }
    const font_size = clampFontSize(Number(textFontSizeInput));
    setTextFontSizeInput(String(font_size));
    const res = await apiClient.put(`/api/mymaps/maps/${selectedMapId}/texts`, {
      textId: selectedTextId,
      text,
      font_size,
    });
    if (!res.ok) {
      toast.error("Could not save text");
      return;
    }
    const data = await res.json();
    setTexts((prev) =>
      prev.map((t) => (t.id === selectedTextId ? data.text : t)),
    );
    toast.success("Text saved");
  }

  const onMapClick = useCallback(
    (e: MapLayerMouseEvent) => {
      if (!canEditRef.current) return;
      const m = modeRef.current;
      if (m === "text") {
        void addText(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      const features = e.features ?? [];
      if (m === "delete") {
        const edgeHit = features.find(
          (f) =>
            f.layer?.id === "mymap-edges-bidir" ||
            f.layer?.id === "mymap-edges-oneway",
        );
        if (edgeHit?.properties?.id) {
          void deleteEdge(Number(edgeHit.properties.id));
          return;
        }
        const polyHit = features.find(
          (f) =>
            f.layer?.id === "mymap-poly-fill" ||
            f.layer?.id === "mymap-poly-line",
        );
        if (polyHit?.properties?.polygonId) {
          void deletePolygon(Number(polyHit.properties.polygonId));
          return;
        }
        const lineHit = features.find(
          (f) => f.layer?.id === "mymap-drawn-lines",
        );
        if (lineHit?.properties?.lineId) {
          void deleteLine(Number(lineHit.properties.lineId));
        }
        return;
      }
      if (m === "select") {
        const polyHit = features.find(
          (f) =>
            f.layer?.id === "mymap-poly-fill" ||
            f.layer?.id === "mymap-poly-line",
        );
        if (polyHit?.properties?.polygonId) {
          setSelectedPolygonId(Number(polyHit.properties.polygonId));
          setPolygonName(String(polyHit.properties.name ?? ""));
          setSelectedId(null);
          setSelectedTextId(null);
          setSelectedLineId(null);
          return;
        }
        const lineHit = features.find(
          (f) => f.layer?.id === "mymap-drawn-lines",
        );
        if (lineHit?.properties?.lineId) {
          setSelectedLineId(Number(lineHit.properties.lineId));
          setSelectedPolygonId(null);
          setSelectedId(null);
          setSelectedTextId(null);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedMapId],
  );

  function onNodeClick(id: number) {
    if (!canEditRef.current) {
      setSelectedId(id);
      return;
    }
    const m = modeRef.current;
    if (m === "delete") {
      void deleteNode(id);
      return;
    }
    if (m === "draw" && drawTool === "line") {
      // Click-to-connect while in line draw tool
      if (selectedRef.current == null) {
        setSelectedId(id);
      } else {
        void connectNodes(selectedRef.current, id);
        setSelectedId(null);
      }
      return;
    }
    setSelectedId(id);
    setSelectedTextId(null);
    setSelectedPolygonId(null);
    setSelectedLineId(null);
  }

  const onDrawCreate = useCallback(
    async (e: DrawEvent, draw: MapLibreDraw) => {
      if (!selectedMapId || !canEditRef.current) return;
      const feature = e.features?.[0];
      if (!feature?.geometry) return;
      const gType = feature.geometry.type;

      // Remove the temporary draw feature immediately so it never doubles.
      deleteDrawFeature(draw, feature);

      const resumeDraw = () => {
        const next =
          drawTool === "point"
            ? "draw_point"
            : drawTool === "line"
              ? "draw_line_string"
              : "draw_polygon";
        try {
          (draw as { changeMode: (m: string) => void }).changeMode(next);
        } catch {
          /* ignore */
        }
      };

      if (gType === "Polygon") {
        const name = `Area ${Date.now().toString().slice(-4)}`;
        const res = await apiClient.post(
          `/api/mymaps/maps/${selectedMapId}/polygons`,
          { name, polygon: feature },
        );
        if (!res.ok) {
          toast.error("Could not save polygon");
          resumeDraw();
          return;
        }
        const data = await res.json();
        setPolygons((prev) => [...prev, data.polygon]);
        setSelectedPolygonId(data.polygon.id);
        setPolygonName(name);
        toast.success("Polygon added");
        resumeDraw();
        return;
      }

      if (gType === "LineString") {
        const coords = (feature.geometry as LineString).coordinates as Array<
          [number, number]
        >;
        if (coords.length < 2) {
          resumeDraw();
          return;
        }
        const nodeIds: number[] = [];
        for (const [lng, lat] of coords) {
          const node = await resolveNodeAt(lat, lng);
          if (!node) {
            resumeDraw();
            return;
          }
          nodeIds.push(node.id);
        }
        for (let i = 0; i < nodeIds.length - 1; i++) {
          await connectNodes(nodeIds[i]!, nodeIds[i + 1]!);
        }
        toast.success(
          biDirectionalRef.current
            ? "Line added (bidirectional edges)"
            : "Arrow path added (one-way edges)",
        );
        resumeDraw();
        return;
      }

      if (gType === "Point") {
        const coords = (feature.geometry as Point).coordinates;
        const [lng, lat] = coords;
        const node = await resolveNodeAt(lat, lng);
        if (node) toast.success("Node added");
        resumeDraw();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedMapId, drawTool],
  );

  const onDrawUpdate = useCallback(async () => {
    // Create-only draw: existing geometry is edited via React layers / markers.
  }, []);

  const onDrawDelete = useCallback(async () => {
    // Create-only draw: deletion is handled by Delete mode.
  }, []);

  async function savePolygonName() {
    if (!selectedMapId || selectedPolygonId == null || !access?.canEdit) return;
    const res = await apiClient.put(
      `/api/mymaps/maps/${selectedMapId}/polygons`,
      {
        polygonId: selectedPolygonId,
        name: polygonName.trim() || "Untitled",
      },
    );
    if (!res.ok) {
      toast.error("Could not rename polygon");
      return;
    }
    const data = await res.json();
    setPolygons((prev) =>
      prev.map((p) => (p.id === selectedPolygonId ? data.polygon : p)),
    );
    toast.success("Polygon renamed");
  }

  const mlMap = mapReady ? (mapRef.current?.getMap?.() ?? null) : null;
  const canEdit = Boolean(access?.canEdit);

  const oneWayArrows = useMemo(() => {
    const out: Array<{
      id: number;
      lng: number;
      lat: number;
      bearing: number;
    }> = [];
    for (const e of edges) {
      if (e.biDirectional) continue;
      const a = nodes.find((n) => n.id === e.from);
      const b = nodes.find((n) => n.id === e.to);
      if (!a || !b) continue;
      out.push({
        id: e.id,
        lng: a.lng + (b.lng - a.lng) * 0.72,
        lat: a.lat + (b.lat - a.lat) * 0.72,
        bearing: bearingTo(a.lng, a.lat, b.lng, b.lat),
      });
    }
    return out;
  }, [edges, nodes]);

  function renderMapListItem(map: OwnedMap | SharedMap, owned: boolean) {
    const isSelected = selectedMapId === map.id;
    const role = "role" in map ? map.role : undefined;

    return (
      <li
        key={map.id}
        className={[
          "rounded-xl border p-3",
          borderMutedClass,
          isSelected ? "border-brand-cta bg-brand-cta/10" : surfacePanelClass,
        ].join(" ")}
      >
        {editingId === map.id ? (
          <div className="flex flex-col gap-2">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={256}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={savePending}
                onClick={() => void saveRename(map.id)}
              >
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setEditingId(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="w-full text-left"
              onClick={() => selectMap(map.id)}
            >
              <p className="truncate text-sm font-semibold">{map.name}</p>
              <p className="mt-0.5 text-[11px] text-panel-muted-foreground">
                {owned
                  ? map.is_public_view
                    ? "Public link enabled"
                    : "Private"
                  : `Role: ${role}${map.is_public_view ? " · Public" : ""}`}
              </p>
            </button>
            {owned ? (
              <div className="mt-2 flex flex-wrap gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Rename"
                  onClick={() => {
                    setEditingId(map.id);
                    setEditName(map.name);
                  }}
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Toggle public"
                  onClick={() => void togglePublic(map)}
                >
                  {map.is_public_view ? (
                    <Eye size={14} />
                  ) : (
                    <EyeOff size={14} />
                  )}
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Copy share link"
                  onClick={() => copyShareLink(map.id)}
                >
                  <Link2 size={14} />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Invite collaborator"
                  onClick={() => void openInvite(map.id)}
                >
                  <UserPlus size={14} />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Delete"
                  onClick={() => void deleteMap(map.id)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ) : (
              <div className="mt-2 flex gap-1">
                {map.is_public_view ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Copy share link"
                    onClick={() => copyShareLink(map.id)}
                  >
                    <Share2 size={14} />
                  </Button>
                ) : null}
              </div>
            )}
          </>
        )}
      </li>
    );
  }

  if (authPending || !allowed) {
    return (
      <div className={`${mapPageClass} grid place-items-center`}>
        <Spinner className="size-8" />
      </div>
    );
  }

  return (
    <div
      className={`${mapPageClass} flex w-full flex-col overflow-hidden bg-background md:flex-row`}
    >
      <aside
        className={`flex max-h-[40vh] w-full shrink-0 flex-col overflow-hidden border-b md:max-h-none md:h-full md:w-80 md:max-w-80 md:border-b-0 md:border-r ${borderMutedClass} ${surfacePanelClass}`}
      >
        <div
          className={`flex items-center justify-between gap-2 border-b px-3 py-2 ${safeAreaTopClass} ${borderMutedClass}`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <HomeLogoLink />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">My Maps</h1>
              <p className="text-[11px] text-panel-muted-foreground">
                Owned & shared
              </p>
            </div>
          </div>
          <ThemeToggleButton />
        </div>

        <div className={`border-b p-3 ${borderMutedClass}`}>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New map name"
              maxLength={256}
            />
            <Button
              type="button"
              size="icon"
              disabled={createPending}
              onClick={() => void createMap()}
              aria-label="Create map"
            >
              {createPending ? (
                <Spinner className="size-4" />
              ) : (
                <Plus size={16} />
              )}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {listLoading ? (
            <div className="grid place-items-center py-8">
              <Spinner className="size-6" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-panel-muted-foreground">
                  My maps
                </h2>
                {ownedMaps.length === 0 ? (
                  <p
                    className={`rounded-xl border p-3 text-xs ${borderMutedClass} ${surfaceSubtleClass}`}
                  >
                    No maps yet.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {ownedMaps.map((m) => renderMapListItem(m, true))}
                  </ul>
                )}
              </section>
              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-panel-muted-foreground">
                  Shared with me
                </h2>
                {sharedMaps.length === 0 ? (
                  <p
                    className={`rounded-xl border p-3 text-xs ${borderMutedClass} ${surfaceSubtleClass}`}
                  >
                    Nothing shared yet.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {sharedMaps.map((m) => renderMapListItem(m, false))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </div>
      </aside>

      <main className="relative h-full min-h-[55vh] min-w-0 flex-1 md:min-h-0">
        {selectedMapId == null ? (
          <div className="grid h-full place-items-center p-6 text-center">
            <div>
              <p className="text-sm font-medium">Select a map to edit</p>
              <p className="mt-1 text-xs text-panel-muted-foreground">
                Choose from the list, or create a new map.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-2 px-3 py-2">
              <div
                className={`min-w-0 rounded-2xl border px-3 py-1.5 ${borderMutedClass} ${surfacePanelClass}`}
              >
                <p className="truncate text-sm font-semibold">
                  {mapName || "Loading…"}
                </p>
                <p className="text-[11px] text-panel-muted-foreground">
                  {access?.role ?? (editorLoading ? "…" : "viewer")}
                  {canEdit ? " · editing" : " · read-only"}
                </p>
              </div>
            </div>

            {canEdit ? (
              <div className="absolute left-3 top-16 z-30 flex w-44 flex-col gap-2">
                <div
                  className={`grid grid-cols-2 gap-1.5 rounded-2xl border p-2 ${borderMutedClass} ${panelClass}`}
                >
                  {(
                    [
                      ["select", "Select", MousePointer2],
                      ["draw", "Draw", Pencil],
                      ["text", "Text", Type],
                      ["delete", "Delete", Trash2],
                    ] as const
                  ).map(([key, label, Icon]) => (
                    <button
                      key={key}
                      type="button"
                      title={label}
                      aria-label={label}
                      aria-pressed={mode === key}
                      onClick={() => setMode(key)}
                      className={[
                        "flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-[11px] font-medium transition",
                        mode === key
                          ? "border-brand-cta bg-brand-cta text-brand-cta-foreground"
                          : "border-border bg-panel text-panel-foreground hover:bg-panel-muted",
                      ].join(" ")}
                    >
                      <Icon size={18} />
                      {label}
                    </button>
                  ))}
                </div>

                <div
                  className={`min-h-[7.5rem] rounded-2xl border p-2 ${borderMutedClass} ${panelClass}`}
                >
                  {mode === "select" ? (
                    <div className="space-y-2">
                      <p className="text-[11px] text-panel-muted-foreground">
                        Drag nodes, points, text, or a selected area/line handle
                        to move them.
                      </p>
                      {selectedPolygonId != null ? (
                        <div className="flex flex-col gap-1">
                          <Input
                            value={polygonName}
                            onChange={(e) => setPolygonName(e.target.value)}
                            placeholder="Polygon name"
                          />
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void savePolygonName()}
                          >
                            Save name
                          </Button>
                        </div>
                      ) : (
                        <p className="text-[11px] text-panel-muted-foreground">
                          Select an area to rename it.
                        </p>
                      )}
                    </div>
                  ) : null}

                  {mode === "draw" ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-1">
                        {(
                          [
                            ["point", "Node"],
                            ["line", "Line"],
                            ["polygon", "Area"],
                          ] as const
                        ).map(([key, label]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setDrawTool(key)}
                            className={[
                              "rounded-lg border px-1 py-1.5 text-[11px] font-medium",
                              drawTool === key
                                ? "border-brand bg-brand text-brand-foreground"
                                : "border-border bg-panel",
                            ].join(" ")}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {drawTool === "line" ? (
                        <label className="flex items-start gap-2 text-[11px] leading-snug">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={biDirectional}
                            onChange={(e) => setBiDirectional(e.target.checked)}
                          />
                          <span>
                            Bidirectional line. Uncheck for one-way arrows.
                          </span>
                        </label>
                      ) : (
                        <p className="text-[11px] text-panel-muted-foreground">
                          {drawTool === "point"
                            ? "Tap the map to place a node."
                            : "Draw an area polygon."}
                        </p>
                      )}
                      {drawTool === "line" ? (
                        <p className="text-[11px] text-panel-muted-foreground">
                          Draw a path, or click two nodes to connect them.
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {mode === "text" ? (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-[11px] text-panel-muted-foreground">
                        Click map to add. Drag a label to move it.
                      </p>
                      {selectedTextId != null ? (
                        <>
                          <Input
                            value={textDraft}
                            onChange={(e) => setTextDraft(e.target.value)}
                            placeholder="Label text"
                          />
                          <Input
                            type="text"
                            inputMode="numeric"
                            value={textFontSizeInput}
                            onChange={(e) =>
                              setTextFontSizeInput(
                                e.target.value.replace(/[^\d]/g, ""),
                              )
                            }
                            onBlur={() =>
                              setTextFontSizeInput(
                                String(
                                  clampFontSize(Number(textFontSizeInput)),
                                ),
                              )
                            }
                            placeholder="Font size"
                            aria-label="Font size"
                          />
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void saveTextDraft()}
                          >
                            Save text
                          </Button>
                        </>
                      ) : null}
                    </div>
                  ) : null}

                  {mode === "delete" ? (
                    <p className="text-[11px] leading-snug text-panel-muted-foreground">
                      Click any node, edge, polygon, line, point, or text to
                      delete it.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="absolute inset-0 h-full w-full">
              {editorLoading ? (
                <div className="absolute inset-0 z-20 grid place-items-center bg-background/40">
                  <Spinner className="size-8" />
                </div>
              ) : null}
              {!clientReady || !canRenderMap ? (
                <div className="grid h-full w-full place-items-center text-sm opacity-70">
                  Loading basemap...
                </div>
              ) : (
                <ReactMap
                  key={`mymap-${selectedMapId}`}
                  ref={mapRef}
                  {...viewState}
                  style={{ width: "100%", height: "100%" }}
                  onMove={(e: ViewStateChangeEvent) =>
                    setViewState((prev) => ({ ...prev, ...e.viewState }))
                  }
                  mapLib={maplibregl}
                  mapStyle={baseStyle as never}
                  onLoad={() => setMapReady(true)}
                  interactiveLayerIds={[
                    "mymap-edges-bidir",
                    "mymap-edges-oneway",
                    "mymap-poly-fill",
                    "mymap-poly-line",
                    "mymap-drawn-lines",
                  ]}
                  onClick={onMapClick}
                >
                  <Source id="mymap-edges" type="geojson" data={edgesGeoJSON}>
                    <Layer {...edgeLayerBidir} />
                    <Layer {...edgeLayerOneWay} />
                  </Source>

                  {polyFeatures.length > 0 ? (
                    <Source
                      id="mymap-polys"
                      type="geojson"
                      data={{
                        type: "FeatureCollection",
                        features: polyFeatures,
                      }}
                    >
                      <Layer
                        id="mymap-poly-fill"
                        type="fill"
                        paint={{
                          "fill-color": "#1a5276",
                          "fill-opacity": 0.35,
                        }}
                      />
                      <Layer
                        id="mymap-poly-line"
                        type="line"
                        paint={{
                          "line-color": "#35D5A4",
                          "line-width": 2,
                        }}
                      />
                    </Source>
                  ) : null}

                  {lineFeatures.length > 0 ? (
                    <Source
                      id="mymap-lines"
                      type="geojson"
                      data={{
                        type: "FeatureCollection",
                        features: lineFeatures,
                      }}
                    >
                      <Layer
                        id="mymap-drawn-lines"
                        type="line"
                        paint={{
                          "line-color": "#1a5276",
                          "line-width": 2,
                        }}
                      />
                    </Source>
                  ) : null}

                  {points.map((p) => (
                    <Marker
                      key={`pt-${p.id}`}
                      longitude={p.lng}
                      latitude={p.lat}
                      anchor="center"
                      draggable={canEdit && mode === "select"}
                      onDrag={(e) => {
                        const { lat, lng } = e.lngLat;
                        setPoints((prev) =>
                          prev.map((row) =>
                            row.id === p.id ? { ...row, lat, lng } : row,
                          ),
                        );
                      }}
                      onDragEnd={(e) => {
                        void movePoint(p.id, e.lngLat.lat, e.lngLat.lng);
                      }}
                      onClick={(e) => {
                        e.originalEvent.stopPropagation();
                        if (modeRef.current === "delete") {
                          void deletePoint(p.id);
                          return;
                        }
                        setSelectedId(null);
                        setSelectedTextId(null);
                        setSelectedPolygonId(null);
                        setSelectedLineId(null);
                      }}
                    >
                      <div
                        className={[
                          "h-2.5 w-2.5 rounded-full border-2 border-white bg-[#1a5276] shadow",
                          canEdit && mode === "select"
                            ? "cursor-grab active:cursor-grabbing"
                            : "",
                        ].join(" ")}
                        title={p.name || `Point ${p.id}`}
                      />
                    </Marker>
                  ))}

                  {nodes.map((n) => (
                    <Marker
                      key={n.id}
                      longitude={n.lng}
                      latitude={n.lat}
                      anchor="center"
                      draggable={canEdit && mode === "select"}
                      onDrag={(e) => {
                        const { lat, lng } = e.lngLat;
                        setNodes((prev) =>
                          prev.map((row) =>
                            row.id === n.id ? { ...row, lat, lng } : row,
                          ),
                        );
                        nodesRef.current = nodesRef.current.map((row) =>
                          row.id === n.id ? { ...row, lat, lng } : row,
                        );
                      }}
                      onDragEnd={(e) => {
                        void moveNode(n.id, e.lngLat.lat, e.lngLat.lng);
                      }}
                      onClick={(e) => {
                        e.originalEvent.stopPropagation();
                        onNodeClick(n.id);
                      }}
                    >
                      <button
                        type="button"
                        className={[
                          "h-3.5 w-3.5 rounded-full border-2 border-white shadow",
                          canEdit && mode === "select"
                            ? "cursor-grab active:cursor-grabbing"
                            : "",
                          selectedId === n.id
                            ? "scale-125 bg-brand-cta"
                            : "bg-[#003c71]",
                        ].join(" ")}
                        aria-label={`Node ${n.id}`}
                      />
                    </Marker>
                  ))}

                  {oneWayArrows.map((a) => (
                    <Marker
                      key={`arr-${a.id}`}
                      longitude={a.lng}
                      latitude={a.lat}
                      anchor="center"
                      rotation={a.bearing}
                      rotationAlignment="map"
                      pitchAlignment="map"
                    >
                      <div
                        className="pointer-events-none text-[10px] font-bold leading-none text-[#003c71]"
                        style={{
                          textShadow:
                            "0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff",
                        }}
                      >
                        ▲
                      </div>
                    </Marker>
                  ))}

                  {canEdit && mode === "select"
                    ? polyFeatures.map((f) => {
                        const polygonId = Number(f.properties?.polygonId);
                        if (!polygonId) return null;
                        const c = featureCentroid(f);
                        if (!c) return null;
                        const selected = selectedPolygonId === polygonId;
                        return (
                          <Marker
                            key={`poly-handle-${polygonId}`}
                            longitude={c.lng}
                            latitude={c.lat}
                            anchor="center"
                            draggable
                            onDragStart={(e) => {
                              const row = polygonsRef.current.find(
                                (p) => p.id === polygonId,
                              );
                              if (!row) return;
                              geomDragRef.current = {
                                kind: "poly",
                                id: polygonId,
                                startLng: e.lngLat.lng,
                                startLat: e.lngLat.lat,
                                base: row.polygon,
                              };
                              setSelectedPolygonId(polygonId);
                              setPolygonName(row.name ?? "");
                              setSelectedLineId(null);
                              setSelectedId(null);
                              setSelectedTextId(null);
                            }}
                            onDrag={(e) => {
                              const origin = geomDragRef.current;
                              if (
                                !origin ||
                                origin.kind !== "poly" ||
                                origin.id !== polygonId
                              )
                                return;
                              const base = parsePolygonFeature(origin.base);
                              if (!base) return;
                              const moved = translateFeature(
                                base,
                                e.lngLat.lng - origin.startLng,
                                e.lngLat.lat - origin.startLat,
                              );
                              moved.properties = {
                                ...(moved.properties ?? {}),
                                polygonId,
                                name: String(f.properties?.name ?? ""),
                              };
                              const polygonJson = JSON.stringify(moved);
                              setPolygons((prev) =>
                                prev.map((p) =>
                                  p.id === polygonId
                                    ? { ...p, polygon: polygonJson }
                                    : p,
                                ),
                              );
                            }}
                            onDragEnd={() => {
                              geomDragRef.current = null;
                              void persistPolygon(polygonId);
                            }}
                            onClick={(e) => {
                              e.originalEvent.stopPropagation();
                              setSelectedPolygonId(polygonId);
                              setPolygonName(String(f.properties?.name ?? ""));
                              setSelectedLineId(null);
                              setSelectedId(null);
                              setSelectedTextId(null);
                            }}
                          >
                            <div
                              className={[
                                "grid h-5 w-5 cursor-grab place-items-center rounded-full border-2 border-white text-[10px] font-bold shadow active:cursor-grabbing",
                                selected
                                  ? "bg-brand-cta text-brand-cta-foreground"
                                  : "bg-[#1a5276] text-white",
                              ].join(" ")}
                              title="Drag to move area"
                            >
                              ✥
                            </div>
                          </Marker>
                        );
                      })
                    : null}

                  {canEdit && mode === "select"
                    ? lineFeatures.map((f) => {
                        const lineId = Number(f.properties?.lineId);
                        if (!lineId) return null;
                        const c = featureCentroid(f);
                        if (!c) return null;
                        const selected = selectedLineId === lineId;
                        return (
                          <Marker
                            key={`line-handle-${lineId}`}
                            longitude={c.lng}
                            latitude={c.lat}
                            anchor="center"
                            draggable
                            onDragStart={(e) => {
                              const row = linesRef.current.find(
                                (l) => l.id === lineId,
                              );
                              if (!row) return;
                              geomDragRef.current = {
                                kind: "line",
                                id: lineId,
                                startLng: e.lngLat.lng,
                                startLat: e.lngLat.lat,
                                base: row.geometry,
                              };
                              setSelectedLineId(lineId);
                              setSelectedPolygonId(null);
                              setSelectedId(null);
                              setSelectedTextId(null);
                            }}
                            onDrag={(e) => {
                              const origin = geomDragRef.current;
                              if (
                                !origin ||
                                origin.kind !== "line" ||
                                origin.id !== lineId
                              )
                                return;
                              const base = parseLineFeature(origin.base);
                              if (!base) return;
                              const moved = translateFeature(
                                base,
                                e.lngLat.lng - origin.startLng,
                                e.lngLat.lat - origin.startLat,
                              );
                              moved.properties = {
                                ...(moved.properties ?? {}),
                                lineId,
                                name: String(f.properties?.name ?? ""),
                              };
                              const geometryJson = JSON.stringify(moved);
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.id === lineId
                                    ? { ...l, geometry: geometryJson }
                                    : l,
                                ),
                              );
                            }}
                            onDragEnd={() => {
                              geomDragRef.current = null;
                              void persistLine(lineId);
                            }}
                            onClick={(e) => {
                              e.originalEvent.stopPropagation();
                              setSelectedLineId(lineId);
                              setSelectedPolygonId(null);
                              setSelectedId(null);
                              setSelectedTextId(null);
                            }}
                          >
                            <div
                              className={[
                                "grid h-5 w-5 cursor-grab place-items-center rounded-full border-2 border-white text-[10px] font-bold shadow active:cursor-grabbing",
                                selected
                                  ? "bg-brand-cta text-brand-cta-foreground"
                                  : "bg-[#1a5276] text-white",
                              ].join(" ")}
                              title="Drag to move line"
                            >
                              ✥
                            </div>
                          </Marker>
                        );
                      })
                    : null}

                  {texts.map((t) => (
                    <Marker
                      key={`txt-${t.id}`}
                      longitude={t.lng}
                      latitude={t.lat}
                      anchor="center"
                      draggable={
                        canEdit && (mode === "select" || mode === "text")
                      }
                      onDrag={(e) => {
                        const { lat, lng } = e.lngLat;
                        setTexts((prev) =>
                          prev.map((row) =>
                            row.id === t.id ? { ...row, lat, lng } : row,
                          ),
                        );
                      }}
                      onDragEnd={(e) => {
                        void moveText(t.id, e.lngLat.lat, e.lngLat.lng);
                      }}
                      onClick={(e) => {
                        e.originalEvent.stopPropagation();
                        if (modeRef.current === "delete") {
                          void deleteText(t.id);
                          return;
                        }
                        setSelectedTextId(t.id);
                        setTextDraft(t.text);
                        setTextFontSizeInput(String(t.font_size ?? 14));
                        setSelectedId(null);
                        setSelectedPolygonId(null);
                        setSelectedLineId(null);
                        if (canEdit && modeRef.current !== "select") {
                          setMode("text");
                        }
                      }}
                    >
                      <div
                        className={[
                          "max-w-[12rem] rounded border border-white/80 bg-panel/90 px-1.5 py-0.5 shadow",
                          canEdit && (mode === "select" || mode === "text")
                            ? "cursor-grab active:cursor-grabbing"
                            : "",
                          selectedTextId === t.id
                            ? "ring-2 ring-brand-cta"
                            : "",
                        ].join(" ")}
                        style={{ fontSize: t.font_size ?? 14 }}
                      >
                        {t.text}
                      </div>
                    </Marker>
                  ))}

                  {mapReady && mode === "draw" && canEdit ? (
                    <DrawControl
                      map={mlMap}
                      features={drawFeatures}
                      position="top-right"
                      displayControlsDefault={false}
                      controls={{
                        polygon: false,
                        line_string: false,
                        point: false,
                        trash: false,
                        combine_features: false,
                        uncombine_features: false,
                      }}
                      onReady={(draw) => {
                        drawApiRef.current = draw;
                        if (!draw) return;
                        const next =
                          drawTool === "point"
                            ? "draw_point"
                            : drawTool === "line"
                              ? "draw_line_string"
                              : "draw_polygon";
                        try {
                          (
                            draw as { changeMode: (m: string) => void }
                          ).changeMode(next);
                        } catch {
                          /* ignore */
                        }
                      }}
                      onCreate={onDrawCreate}
                      onUpdate={onDrawUpdate}
                      onDelete={onDrawDelete}
                    />
                  ) : null}
                </ReactMap>
              )}
            </div>
          </>
        )}
      </main>

      {inviteMapId != null ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div
            className={`w-full max-w-md rounded-2xl border p-4 shadow-lg ${borderMutedClass} ${surfacePanelClass}`}
          >
            <h3 className="text-base font-semibold">Collaborators</h3>
            <p className="mt-1 text-xs text-panel-muted-foreground">
              Invite an existing user by email. Viewers can read; editors can
              edit the map.
            </p>
            <ul className="mt-3 max-h-40 space-y-2 overflow-y-auto">
              {collaborators.length === 0 ? (
                <li className="text-sm text-panel-muted-foreground">
                  No collaborators yet.
                </li>
              ) : (
                collaborators.map((c) => (
                  <li
                    key={c.collaborator_id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span>
                      {c.name} ({c.email}) · {c.role}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void removeCollaborator(c.collaborator_id)}
                    >
                      Remove
                    </Button>
                  </li>
                ))
              )}
            </ul>
            <div className="mt-3 flex flex-col gap-2">
              <Input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                type="email"
              />
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={inviteRole}
                onChange={(e) =>
                  setInviteRole(e.target.value as "viewer" | "editor")
                }
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setInviteMapId(null)}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  disabled={invitePending}
                  onClick={() => void addCollaborator()}
                >
                  {invitePending ? <Spinner className="size-4" /> : null}
                  Add
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
