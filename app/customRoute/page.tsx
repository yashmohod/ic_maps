
"use client";

import { authClient, type Session } from "@/lib/auth-client";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  Map as ReactMap,
  Source,
  Layer,
  type MapRef,
  type ViewStateChangeEvent,
} from "@vis.gl/react-maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { toast } from "sonner";
import maplibregl from "maplibre-gl";

import { Button } from "@/components/ui/button";
import { useMapStyle } from "@/hooks/use-map-style";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/map-constants";
import { HomeLogoLink } from "@/components/home-logo-link";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import { Spinner } from "@/components/ui/spinner";
import {
  IconPlus,
  IconPencil,
  IconQrcode,
  IconShare2,
  IconTrash,
} from "@tabler/icons-react";


import {
  surfacePanelClass,
  surfaceSubtleClass,
  borderMutedClass,
  selectBaseClass,
  selectFocusClass,
} from "@/lib/panel-classes";
import type {
  SimpleMarkerNode,
  GeoJSONFeatureCollection,
} from "@/lib/types/map";

type MarkerNode = SimpleMarkerNode;

type Route = {
  id: number;
  name: string;
  destinationId: string;
  destinationName: string;
};

type Destination = {
  id: string | number;
  name: string;
  lat?: number;
  lng?: number;
  description?: string;
  polygon?: string;
};

/**
 * Some APIs store polygon as:
 * - FeatureCollection
 * - Feature
 * - Geometry (Polygon/MultiPolygon)
 * This normalizes to FeatureCollection so MapLibre <Source type="geojson" /> is happy.
 */
function normalizeToFeatureCollection(
  input: any,
): GeoJSONFeatureCollection | null {
  if (!input) return null;

  if (input.type === "FeatureCollection") return input as GeoJSONFeatureCollection;

  if (input.type === "Feature") {
    return {
      type: "FeatureCollection",
      features: [input],
    } as GeoJSONFeatureCollection;
  }

  if (
    input.type === "Polygon" ||
    input.type === "MultiPolygon" ||
    input.type === "LineString" ||
    input.type === "Point"
  ) {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: input,
        },
      ],
    } as GeoJSONFeatureCollection;
  }

  return null;
}

export default function CustomRoutesPage(): JSX.Element {
  /** ---------------- Map ---------------- */
  const defViewState = useMemo(
    () => ({
      longitude: DEFAULT_CENTER.lng,
      latitude: DEFAULT_CENTER.lat,
      zoom: DEFAULT_ZOOM,
      bearing: 0,
      pitch: 0,
    }),
    [],
  );

  const { data: session, error, refetch, isPending } = authClient.useSession();
  const [viewState, setViewState] = useState(defViewState);
  const mapRef = useRef<MapRef | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const { isDark, mapStyle } = useMapStyle();
  const { baseStyle } = usePmtilesStyle({ stylePath: mapStyle });
  const canRenderMap = !!baseStyle;

  function ensureCenter(lng: number, lat: number, zoom = 18.5) {
    const map = mapRef.current?.getMap?.();
    if (map && mapReady) {
      map.flyTo({
        center: [lng, lat],
        zoom,
        pitch: 42,
        bearing: 0,
        duration: 900,
        essential: true,
      });
    } else {
      setViewState((v) => ({
        ...v,
        longitude: lng,
        latitude: lat,
        zoom,
        bearing: 0,
        pitch: 42,
      }));
    }
  }


  /** ---------------- Data ---------------- */
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routesFirstLoadPending, setRoutesFirstLoadPending] = useState(true);

  /** ---------------- Map Preview State ---------------- */
  const [previewDestId, setPreviewDestId] = useState<string>("");
  const [previewDestPos, setPreviewDestPos] = useState<{
    lng: number;
    lat: number;
  } | null>(null);
  const [curDestinationPoly, setCurDestinationPoly] =
    useState<GeoJSONFeatureCollection | null>(null);

  // Building nodes for the selected destination (from GET /api/destination/outsideNode + GET /api/map/node)
  const [buildingNodes, setBuildingNodes] = useState<MarkerNode[]>([]);
  const [buildingNodesPending, setBuildingNodesPending] = useState(false);

  /** ---------------- Modals ---------------- */
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const [shareRoute, setShareRoute] = useState<Route | null>(null);
  const [deleteRoute, setDeleteRoute] = useState<Route | null>(null);

  /** ---------------- Loading flags (disable + spinner on submissions) ---------------- */
  const [createPending, setCreatePending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [saveEditPendingId, setSaveEditPendingId] = useState<number | null>(
    null,
  );

  /** ---------------- Edit Route (inline) ---------------- */
  const [editingRouteId, setEditingRouteId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDestinationId, setEditDestinationId] = useState("");

  function startEdit(route: Route) {
    setNewModalOpen(false);

    setEditingRouteId(route.id);
    setEditName(route.name ?? "");
    setEditDestinationId(route.destinationId ?? "");

    // Preview destination on map when opening editor
    void showBuilding(String(route.destinationId));
  }

  function cancelEdit() {
    setEditingRouteId(null);
    setEditName("");
    setEditDestinationId("");
  }

  async function saveEdit(routeId: number) {
    if (saveEditPendingId != null) return;

    const name = editName.trim();
    const destinationId = editDestinationId.trim();

    if (!name) return toast.error("Route name is required.");
    if (!destinationId) return toast.error("Destination is required.");
    if (!session) return toast.error("Please sign in");

    setSaveEditPendingId(routeId);
    try {
      const res = await fetch("/api/shareableroute", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          routeId,
          name,
          destinationIds: [Number(destinationId)],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Route updated!");
        cancelEdit();
        await getRoutes();
        void showBuilding(destinationId);
      } else {
        toast.error(data?.error ?? "Route could not be updated!");
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to update route.");
    } finally {
      setSaveEditPendingId(null);
    }
  }

  /** ---------------- New Route form ---------------- */
  const [newName, setNewName] = useState("");
  const [newRouteId, setNewRouteId] = useState("");

  /** ---------------- Share URL + QR ---------------- */
  const shareUrl = useMemo(() => {
    if (!shareRoute) return "";
    if (typeof window === "undefined") return "";
    // ✅ CHANGED: /route/:id
    return `${window.location.origin}/route/${shareRoute.id}`;
  }, [shareRoute]);

  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [qrPending, setQrPending] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!shareModalOpen || !shareUrl) {
        setQrDataUrl("");
        setQrPending(false);
        return;
      }

      setQrPending(true);
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(shareUrl, {
          errorCorrectionLevel: "M",
          margin: 1,
          scale: 10,
        });
        if (!cancelled) setQrDataUrl(url);
      } catch (e) {
        if (!cancelled) setQrDataUrl("");
        console.error(e);
        toast.error("QR generator missing. Run: npm i qrcode");
      } finally {
        if (!cancelled) setQrPending(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [shareModalOpen, shareUrl]);

  /** ---------------- Helpers ---------------- */
  function openNewModal() {
    setEditingRouteId(null);
    setNewName("");
    setNewRouteId("");
    setNewModalOpen((v) => !v);
  }

  async function getRoutes() {
    if (!session) {
      setRoutesFirstLoadPending(false);
      return;
    }

    try {
      const res = await fetch("/api/shareableroute/all", {
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data?.routes)) {
        const mapped: Route[] = data.routes.map(
          (r: { id: number; name: string; destinations: Array<{ id: number; name: string }> }) => {
            const first = r.destinations?.[0];
            return {
              id: r.id,
              name: r.name,
              destinationId: first != null ? String(first.id) : "",
              destinationName: first?.name ?? "",
            };
          },
        );
        setRoutes(mapped);
      } else {
        toast.error("Routes did not load!");
      }
    } catch (e) {
      console.error(e);
      toast.error("Routes did not load!");
    } finally {
      setRoutesFirstLoadPending(false);
    }
  }

  function wouldDuplicateRoute(name: string, destinationId: string) {
    const nm = name.trim().toLowerCase();
    const did = destinationId.trim();
    if (!nm || !did) return false;

    return routes.some(
      (r) =>
        (r.name ?? "").trim().toLowerCase() === nm &&
        String(r.destinationId) === String(did),
    );
  }

  async function createRoute() {
    if (createPending) return;

    const name = newName.trim();
    const destinationId = newRouteId.trim();

    if (!name) return toast.error("Route name is required.");
    if (!destinationId) return toast.error("Destination is required.");
    if (!session) return toast.error("Please sign in");

    if (wouldDuplicateRoute(name, destinationId)) {
      return toast.error("That route already exists (same name + destination).");
    }

    setCreatePending(true);
    try {
      const res = await fetch("/api/shareableroute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name,
          destinationIds: [Number(destinationId)],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.id != null) {
        toast.success("Route created!");
        setNewModalOpen(false);
        await getRoutes();
        void showBuilding(destinationId);
      } else {
        toast.error(data?.error ?? "Failed to create route.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to create route.");
    } finally {
      setCreatePending(false);
    }
  }

  function askDelete(route: Route) {
    setDeleteRoute(route);
    setConfirmDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!deleteRoute) return;
    if (deletePending) return;

    setDeletePending(true);
    try {
      const res = await fetch("/api/shareableroute", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ routeId: deleteRoute.id }),
      });
      if (res.ok) {
        toast.success("Route deleted.");
        await getRoutes();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error ?? "Route could not be deleted!");
      }

      setConfirmDeleteOpen(false);
      setDeleteRoute(null);
    } catch {
      toast.error("Route could not be deleted!");
    } finally {
      setDeletePending(false);
    }

    if (editingRouteId === deleteRoute.id) cancelEdit();
  }

  function openShare(route: Route) {
    setShareRoute(route);
    setShareModalOpen(true);
  }

  async function copyShareLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link copied!");
    } catch {
      toast.error("Could not copy link.");
    }
  }

  function saveQrPng() {
    if (!qrDataUrl) return;

    const a = document.createElement("a");
    a.href = qrDataUrl;
    const safeName = (shareRoute?.name || "route").replace(/[^\w\-]+/g, "_");
    a.download = `qr_${safeName}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /** ---------------- Destinations list ---------------- */
  const [destinations, setDestinations] = useState<Destination[]>();

  async function getDestinations() {
    try {
      const res = await fetch("/api/destination");
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data?.destinations)) {
        setDestinations(data.destinations);
      } else {
        toast.error("Buildings did not load!");
      }
    } catch (e) {
      console.error(e);
      toast.error("Buildings did not load!");
    }
  }

  /**
   * Show building: polygon and position from destinations array (from GET /api/destination).
   * Nodes: GET /api/destination/outsideNode?id=X then GET /api/map/node, filter by node ids.
   */
  async function showBuilding(destinationId: string) {
    if (!destinationId) {
      setPreviewDestId("");
      setPreviewDestPos(null);
      setCurDestinationPoly(null);
      setBuildingNodes([]);
      return;
    }

    setPreviewDestId(String(destinationId));

    // 1) Polygon + lat/lng from destinations array (already loaded)
    const dest = destinations?.find((d) => String(d.id) === String(destinationId));
    if (dest) {
      const polyStr = dest.polygon;
      const parsed = typeof polyStr === "string" ? JSON.parse(polyStr) : polyStr;
      const normalized = normalizeToFeatureCollection(parsed);
      setCurDestinationPoly(normalized);

      const rawLat = Number(dest.lat);
      const rawLng = Number(dest.lng);
      const pos =
        Number.isFinite(rawLat) && Number.isFinite(rawLng)
          ? { lat: rawLat - 0.0002, lng: rawLng + 0.00005 }
          : null;
      setPreviewDestPos(pos);
      if (pos) ensureCenter(pos.lng, pos.lat, 18.5);
    } else {
      setCurDestinationPoly(null);
      setPreviewDestPos(null);
    }

    // 2) Fetch node ids for this destination, then get coords from map/node
    setBuildingNodesPending(true);
    try {
      const nodeRes = await fetch(
        `/api/destination/outsideNode?id=${encodeURIComponent(destinationId)}`,
      );
      const nodeData = await nodeRes.json().catch(() => ({}));
      const nodeIds: number[] = Array.isArray(nodeData?.nodes) ? nodeData.nodes : [];
      if (nodeIds.length === 0) {
        setBuildingNodes([]);
        return;
      }
      const mapRes = await fetch("/api/map/node");
      const mapData = await mapRes.json().catch(() => ({}));
      const rows = Array.isArray(mapData?.rows) ? mapData.rows : [];
      const idSet = new Set(nodeIds);
      const cleaned: MarkerNode[] = rows
        .filter((row: { id?: number }) => row.id != null && idSet.has(Number(row.id)))
        .map((row: { id: number; lat: number; lng: number }) => ({
          id: row.id,
          lng: Number(row.lng),
          lat: Number(row.lat),
        }))
        .filter(
          (n: MarkerNode) =>
            Number.isFinite(n.lng) && Number.isFinite(n.lat),
        );
      setBuildingNodes(cleaned);
    } catch (err) {
      console.error("getAllBuildingNodes failed", err);
      toast.error("Building nodes did not load!");
      setBuildingNodes([]);
    } finally {
      setBuildingNodesPending(false);
    }
  }

  const buildingNodesFC = useMemo<GeoJSONFeatureCollection | null>(() => {
    if (!buildingNodes.length) return null;

    return {
      type: "FeatureCollection",
      features: buildingNodes.map((m) => ({
        type: "Feature",
        properties: { id: String(m.id) },
        geometry: { type: "Point", coordinates: [m.lng, m.lat] },
      })),
    };
  }, [buildingNodes]);

  useEffect(() => {
    void getDestinations();
  }, []);

  useEffect(() => {
    if (!session) return;
    void getRoutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, refetch]);

  /** ---------------- Modal styles ---------------- */
  const modalOverlay = [
    "fixed inset-0 z-50 grid place-items-center",
    "bg-black/50 backdrop-blur-sm",
    "px-3",
  ].join(" ");

  const modalCard = [
    "w-full max-w-[520px] rounded-3xl border shadow-2xl",
    surfacePanelClass,
    borderMutedClass,
  ].join(" ");

  const modalHeader = [
    "flex items-start justify-between gap-4 p-4 border-b",
    borderMutedClass,
  ].join(" ");
  const modalBody = "p-4";

  const inputClass = [
    "w-full rounded-2xl border px-3 py-3 text-sm font-medium",
    "bg-panel text-panel-foreground",
    borderMutedClass,
    "focus:outline-none focus:ring-2 focus:ring-brand-cta/30 focus:border-brand-cta",
  ].join(" ");

  /** ---------------- Render ---------------- */
  return (
    <div className="relative h-screen w-full bg-background text-foreground">
      <div className="absolute left-3 top-3 z-40 flex items-center gap-2">
        <HomeLogoLink className="h-12 px-3 py-2 shadow-xl backdrop-blur" />
        <ThemeToggleButton className="h-12 w-12 shadow-xl backdrop-blur" />
      </div>

      {/* Routes panel */}
      <div className="absolute left-3 top-20 z-30 w-[380px] max-w-[calc(100vw-24px)]">
        <div
          className={[
            "rounded-3xl border shadow-2xl backdrop-blur",
            surfacePanelClass,
            borderMutedClass,
          ].join(" ")}
        >
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Shareable Routes</h2>
              </div>

              <span
                className={[
                  "rounded-full border px-2.5 py-1 text-xs font-medium",
                  borderMutedClass,
                  surfaceSubtleClass,
                ].join(" ")}
              >
                {routes.length}
              </span>
            </div>

            {/* List */}
            <div className="mt-4 space-y-2">
              {routesFirstLoadPending && (
                <div
                  className={[
                    "rounded-2xl border p-4 text-sm",
                    borderMutedClass,
                    surfaceSubtleClass,
                    "flex items-center gap-3",
                  ].join(" ")}
                >
                  <Spinner />
                  <span className="text-panel-muted-foreground">
                    Loading routes…
                  </span>
                </div>
              )}

              {!routesFirstLoadPending && routes.length === 0 && (
                <div
                  className={[
                    "rounded-2xl border p-4 text-sm",
                    borderMutedClass,
                    surfaceSubtleClass,
                  ].join(" ")}
                >
                  No routes yet. Create one.
                </div>
              )}

              {!routesFirstLoadPending &&
                routes.map((route) => {
                  const isEditing = editingRouteId === route.id;
                  const isSavingThisEdit = saveEditPendingId === route.id;

                  return (
                    <div key={route.id} className="space-y-2">
                      <div
                        className={[
                          "w-full rounded-2xl border px-4 py-3 cursor-pointer",
                          "bg-panel-muted/40 hover:bg-panel-muted/60 transition",
                          borderMutedClass,
                          previewDestId === String(route.destinationId) &&
                          "ring-2 ring-brand-cta/30",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() =>
                          void showBuilding(String(route.destinationId))
                        }
                        title="Click to preview destination on map"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {route.name}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-panel-muted-foreground">
                              To: {route.destinationName}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              className={[
                                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                                borderMutedClass,
                                "bg-panel hover:bg-panel-muted",
                              ].join(" ")}
                              onClick={(e) => {
                                e.stopPropagation();
                                openShare(route);
                              }}
                              title="Share"
                            >
                              <IconShare2 size={14} />
                              Share
                            </button>

                            <button
                              className={[
                                "inline-flex h-8 w-8 items-center justify-center rounded-full border transition",
                                borderMutedClass,
                                isEditing
                                  ? "bg-panel-muted"
                                  : "bg-panel hover:bg-panel-muted",
                              ].join(" ")}
                              onClick={(e) => {
                                e.stopPropagation();
                                isEditing ? cancelEdit() : startEdit(route);
                              }}
                              title={isEditing ? "Close editor" : "Edit route"}
                            >
                              <IconPencil size={16} />
                            </button>

                            <button
                              className={[
                                "inline-flex h-8 w-8 items-center justify-center rounded-full border transition",
                                borderMutedClass,
                                "bg-panel hover:bg-panel-muted",
                              ].join(" ")}
                              onClick={(e) => {
                                e.stopPropagation();
                                askDelete(route);
                              }}
                              title="Delete route"
                            >
                              <IconTrash size={16} />
                            </button>
                          </div>
                        </div>
                      </div>

                      {isEditing && (
                        <div
                          className={[
                            "rounded-3xl border p-4 shadow-lg",
                            borderMutedClass,
                            surfaceSubtleClass,
                          ].join(" ")}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold">
                                Edit route
                              </div>
                              <div className="mt-1 text-xs text-panel-muted-foreground">
                                Update name or destination.
                              </div>
                            </div>

                            <button
                              className={[
                                "rounded-full border px-3 py-1 text-xs font-semibold transition",
                                borderMutedClass,
                                "bg-panel hover:bg-panel-muted",
                              ].join(" ")}
                              onClick={cancelEdit}
                              disabled={isSavingThisEdit}
                            >
                              Close
                            </button>
                          </div>

                          <div className="mt-3 space-y-3">
                            <div>
                              <label className="text-xs font-medium text-panel-muted-foreground">
                                Route name
                              </label>
                              <div className="mt-2">
                                <input
                                  className={inputClass}
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  placeholder="Night Walk"
                                  disabled={isSavingThisEdit}
                                />
                              </div>
                            </div>

                            <div>
                              <label className="text-xs font-medium text-panel-muted-foreground">
                                Destination
                              </label>
                              <div className="mt-2">
                                <select
                                  className={`w-full rounded-2xl border px-3 py-3 text-sm font-medium transition focus:outline-none focus:ring-2 ${selectFocusClass} ${selectBaseClass}`}
                                  value={editDestinationId}
                                  onChange={(e) => {
                                    const nextId = e.target.value;
                                    setEditDestinationId(nextId);
                                    if (nextId) void showBuilding(nextId);
                                  }}
                                  disabled={isSavingThisEdit}
                                >
                                  <option value="">
                                    Search campus buildings…
                                  </option>
                                  {destinations?.map((d) => (
                                    <option
                                      key={String(d.id)}
                                      value={String(d.id)}
                                    >
                                      {d.name}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="mt-3 flex gap-2">
                                <Button
                                  variant="secondary"
                                  className={[
                                    "h-9 flex-1 rounded-2xl",
                                    "bg-panel hover:bg-panel-muted",
                                    `border ${borderMutedClass}`,
                                    "disabled:opacity-60",
                                  ].join(" ")}
                                  onClick={() => saveEdit(route.id)}
                                  disabled={isSavingThisEdit}
                                >
                                  {isSavingThisEdit ? (
                                    <span className="inline-flex items-center gap-2">
                                      <Spinner />
                                      Saving…
                                    </span>
                                  ) : (
                                    "Save changes"
                                  )}
                                </Button>

                                <Button
                                  variant="ghost"
                                  className="h-9 flex-1 rounded-2xl hover:bg-panel disabled:opacity-60"
                                  onClick={cancelEdit}
                                  disabled={isSavingThisEdit}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            {/* Footer actions */}
            {!newModalOpen ? (
              <div className="mt-4 flex gap-2">
                <Button
                  variant="secondary"
                  className={[
                    "h-9 flex-1 rounded-2xl",
                    "bg-panel hover:bg-panel-muted",
                    `border ${borderMutedClass}`,
                  ].join(" ")}
                  onClick={openNewModal}
                  disabled={createPending || saveEditPendingId != null}
                >
                  <IconPlus size={16} className="mr-2" />
                  New
                </Button>
              </div>
            ) : null}

            {/* Inline Create panel */}
            {newModalOpen && (
              <div
                className={[
                  "mt-3 rounded-3xl border p-4 shadow-lg",
                  borderMutedClass,
                  surfaceSubtleClass,
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Create route</div>
                    <div className="mt-1 text-xs text-panel-muted-foreground">
                      Name it, pick a destination.
                    </div>
                  </div>

                  <button
                    className={[
                      "rounded-full border px-3 py-1 text-xs font-semibold transition",
                      borderMutedClass,
                      "bg-panel hover:bg-panel-muted",
                      "disabled:opacity-60",
                    ].join(" ")}
                    onClick={() => setNewModalOpen(false)}
                    disabled={createPending}
                  >
                    Close
                  </button>
                </div>

                <div className="mt-3 space-y-3">
                  <div>
                    <label className="text-xs font-medium text-panel-muted-foreground">
                      Route name
                    </label>
                    <div className="mt-2">
                      <input
                        className={inputClass}
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Night Walk"
                        disabled={createPending}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-panel-muted-foreground">
                      Destination
                    </label>
                    <div className="mt-2">
                      <select
                        id="search-dest"
                        className={`w-full rounded-2xl border px-3 py-3 text-sm font-medium transition focus:outline-none focus:ring-2 ${selectFocusClass} ${selectBaseClass}`}
                        value={newRouteId}
                        onChange={(e) => {
                          const nextId = e.target.value;
                          setNewRouteId(nextId);
                          if (nextId) void showBuilding(nextId);
                        }}
                        disabled={createPending}
                      >
                        <option value="">Search campus buildings…</option>
                        {destinations?.map((d) => (
                          <option key={String(d.id)} value={String(d.id)}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="mt-3 flex gap-2">
                      <Button
                        variant="secondary"
                        className={[
                          "h-9 flex-1 rounded-2xl",
                          "bg-panel hover:bg-panel-muted",
                          `border ${borderMutedClass}`,
                          "disabled:opacity-60",
                        ].join(" ")}
                        onClick={createRoute}
                        disabled={
                          createPending ||
                          !newName.trim() ||
                          !newRouteId.trim() ||
                          wouldDuplicateRoute(newName, newRouteId)
                        }
                        title={
                          wouldDuplicateRoute(newName, newRouteId)
                            ? "Duplicate route (same name + destination)"
                            : undefined
                        }
                      >
                        {createPending ? (
                          <span className="inline-flex items-center gap-2">
                            <Spinner />
                            Creating…
                          </span>
                        ) : (
                          "Create"
                        )}
                      </Button>

                      <Button
                        variant="ghost"
                        className="h-9 flex-1 rounded-2xl hover:bg-panel disabled:opacity-60"
                        onClick={() => setNewModalOpen(false)}
                        disabled={createPending}
                      >
                        Cancel
                      </Button>
                    </div>

                    {wouldDuplicateRoute(newName, newRouteId) && (
                      <p className="mt-2 text-xs text-panel-muted-foreground">
                        A route with this{" "}
                        <span className="font-semibold">name</span> and{" "}
                        <span className="font-semibold">destination</span>{" "}
                        already exists.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="h-full w-full">
        {!canRenderMap ? (
          <div className="h-full w-full grid place-items-center text-sm opacity-70">
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
            {/* Building nodes */}
            {buildingNodesFC && (
              <Source
                id="building-nodes"
                type="geojson"
                data={buildingNodesFC as any}
              >
                <Layer
                  id="building-nodes-circle"
                  type="circle"
                  paint={{
                    "circle-radius": 8,
                    "circle-color": isDark ? "#60a5fa" : "#2563eb",
                    "circle-stroke-width": 2,
                    "circle-stroke-color": isDark ? "#041631" : "#ffffff",
                  }}
                />
              </Source>
            )}

            {/* Building polygon */}
            {previewDestId && curDestinationPoly && (
              <Source id="boundary" type="geojson" data={curDestinationPoly as any}>
                <Layer
                  id="boundary-fill"
                  type="fill"
                  paint={{
                    "fill-color": "#35D5A4",
                    "fill-opacity": 0.2,
                  }}
                />
                <Layer
                  id="boundary-outline"
                  type="line"
                  paint={{
                    "line-color": "#35D5A4",
                    "line-width": 2,
                  }}
                />
              </Source>
            )}

            {/* Optional: tiny "loading nodes" visual, without adding a destination marker */}
            {buildingNodesPending && previewDestPos && (
              <Source
                id="nodes-loading-dot"
                type="geojson"
                data={{
                  type: "FeatureCollection",
                  features: [
                    {
                      type: "Feature",
                      properties: {},
                      geometry: {
                        type: "Point",
                        coordinates: [previewDestPos.lng, previewDestPos.lat],
                      },
                    },
                  ],
                } as any}
              >
                <Layer
                  id="nodes-loading-dot-layer"
                  type="circle"
                  paint={{
                    "circle-radius": 6,
                    "circle-color": "#35D5A4",
                    "circle-opacity": 0.45,
                  }}
                />
              </Source>
            )}
          </ReactMap>
        )}
      </div>

      {/* ---------------- Confirm Delete Modal ---------------- */}
      {confirmDeleteOpen && deleteRoute && (
        <div
          className={modalOverlay}
          onMouseDown={() => (deletePending ? null : setConfirmDeleteOpen(false))}
        >
          <div className={modalCard} onMouseDown={(e) => e.stopPropagation()}>
            <div className={modalHeader}>
              <div>
                <div className="text-lg font-semibold">Delete route?</div>
                <div className="mt-1 text-xs text-panel-muted-foreground">
                  This will remove{" "}
                  <span className="font-semibold">{deleteRoute.name}</span> from
                  your list.
                </div>
              </div>

              <button
                className={[
                  "rounded-full border px-3 py-1 text-xs font-semibold transition",
                  borderMutedClass,
                  surfaceSubtleClass,
                  "hover:bg-panel",
                  "disabled:opacity-60",
                ].join(" ")}
                onClick={() => setConfirmDeleteOpen(false)}
                disabled={deletePending}
              >
                Close
              </button>
            </div>

            <div className={modalBody}>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className={[
                    "h-9 flex-1 rounded-2xl",
                    "bg-panel hover:bg-panel-muted",
                    `border ${borderMutedClass}`,
                    "disabled:opacity-60",
                  ].join(" ")}
                  onClick={confirmDelete}
                  disabled={deletePending}
                >
                  {deletePending ? (
                    <span className="inline-flex items-center gap-2">
                      <Spinner />
                      Deleting…
                    </span>
                  ) : (
                    "Delete"
                  )}
                </Button>

                <Button
                  variant="ghost"
                  className="h-9 flex-1 rounded-2xl hover:bg-panel disabled:opacity-60"
                  onClick={() => setConfirmDeleteOpen(false)}
                  disabled={deletePending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Share Modal ---------------- */}
      {shareModalOpen && shareRoute && (
        <div
          className={modalOverlay}
          onMouseDown={() => setShareModalOpen(false)}
        >
          <div className={modalCard} onMouseDown={(e) => e.stopPropagation()}>
            <div className={modalHeader}>
              <div>
                <div className="text-lg font-semibold">Share route</div>
                <div className="mt-1 text-xs text-panel-muted-foreground">
                  {shareRoute.name} • To: {shareRoute.destinationName}
                </div>
              </div>

              <button
                className={[
                  "rounded-full border px-3 py-1 text-xs font-semibold transition",
                  borderMutedClass,
                  surfaceSubtleClass,
                  "hover:bg-panel",
                ].join(" ")}
                onClick={() => setShareModalOpen(false)}
              >
                Close
              </button>
            </div>

            <div className={modalBody}>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-xs font-medium text-panel-muted-foreground">
                    Share link
                  </label>
                  <div className="mt-2">
                    <input className={inputClass} readOnly value={shareUrl} />
                  </div>
                </div>

                <div className="pb-[2px]">
                  <Button
                    variant="secondary"
                    className={[
                      "h-[42px] rounded-2xl px-4",
                      "bg-panel hover:bg-panel-muted",
                      `border ${borderMutedClass}`,
                    ].join(" ")}
                    onClick={copyShareLink}
                  >
                    Copy
                  </Button>
                </div>
              </div>

              <div
                className={[
                  "mt-4 rounded-3xl border p-4",
                  borderMutedClass,
                  surfaceSubtleClass,
                ].join(" ")}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-medium text-panel-muted-foreground">
                    <IconQrcode size={16} />
                    QR Code
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-center">
                  {qrPending ? (
                    <div className="py-16 text-sm text-panel-muted-foreground flex items-center gap-3">
                      <Spinner className="h-5 w-5" />
                      Generating…
                    </div>
                  ) : qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="QR code"
                      className="w-full max-w-[420px] rounded-2xl bg-white p-3"
                    />
                  ) : (
                    <div className="py-16 text-sm text-panel-muted-foreground">
                      QR unavailable.
                    </div>
                  )}
                </div>

                <div className="mt-4 flex gap-2">
                  <Button
                    variant="secondary"
                    className={[
                      "h-9 flex-1 rounded-2xl",
                      "bg-panel hover:bg-panel-muted",
                      `border ${borderMutedClass}`,
                    ].join(" ")}
                    onClick={saveQrPng}
                    disabled={!qrDataUrl}
                  >
                    Save QR (PNG)
                  </Button>

                  <Button
                    variant="ghost"
                    className="h-9 flex-1 rounded-2xl hover:bg-panel"
                    onClick={() => setShareModalOpen(false)}
                  >
                    Done
                  </Button>
                </div>
              </div>

              <p className="mt-3 text-[11px] text-panel-muted-foreground">
                Link format: <span className="font-semibold">/route/:id</span>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
