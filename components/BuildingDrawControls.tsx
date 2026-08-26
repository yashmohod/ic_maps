"use client";

import { useEffect, useMemo, useRef } from "react";
import MapLibreDraw from "maplibre-gl-draw";
import type { Map as MlMap } from "maplibre-gl";
import type {
  Feature,
  FeatureCollection,
  Polygon,
  GeoJsonProperties,
} from "geojson";

import "maplibre-gl-draw/dist/mapbox-gl-draw.css";

type DrawPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

type DrawControls = Partial<{
  polygon: boolean;
  trash: boolean;
  line_string: boolean;
  point: boolean;
  combine_features: boolean;
  uncombine_features: boolean;
}>;

type DrawEvent = { features: Feature[] };

type Props = {
  map: MlMap | null;
  position?: DrawPosition;
  controls?: DrawControls;
  displayControlsDefault?: boolean;
  /** Active draw color for in-progress preview styles. */
  activeColor?: string;

  /** Drawn features to sync (polygons, lines, points). */
  features?: Feature[];
  /** @deprecated use features */
  polys?: Array<Feature<Polygon, GeoJsonProperties>>;

  onReady?: (draw: MapLibreDraw | null) => void;
  onCreate?: (e: DrawEvent, draw: MapLibreDraw) => void;
  onUpdate?: (e: DrawEvent, draw: MapLibreDraw) => void;
  onDelete?: (e: DrawEvent, draw: MapLibreDraw) => void;
  onSelectionChange?: (e: DrawEvent, draw: MapLibreDraw) => void;
  onModeChange?: (e: unknown, draw: MapLibreDraw) => void;
};

function fallbackStyles(activeColor = "#35D5A4") {
  const cold = "#1a5276";
  const hot = activeColor;
  return [
    {
      id: "gl-draw-polygon-fill.cold",
      type: "fill",
      filter: ["all", ["==", "$type", "Polygon"], ["!=", "active", "true"]],
      // Inactive building fills come from BuildingsOverlay; keep a light hit target for Draw.
      paint: { "fill-color": cold, "fill-opacity": 0.08 },
    },
    {
      id: "gl-draw-polygon-fill.hot",
      type: "fill",
      filter: ["all", ["==", "$type", "Polygon"], ["==", "active", "true"]],
      paint: { "fill-color": hot, "fill-opacity": 0.35 },
    },
    {
      id: "gl-draw-polygon-stroke.cold",
      type: "line",
      filter: ["all", ["==", "$type", "Polygon"], ["!=", "active", "true"]],
      paint: { "line-color": cold, "line-width": 1, "line-opacity": 0.35 },
    },
    {
      id: "gl-draw-polygon-stroke.hot",
      type: "line",
      filter: ["all", ["==", "$type", "Polygon"], ["==", "active", "true"]],
      paint: { "line-color": hot, "line-width": 2 },
    },
    {
      id: "gl-draw-lines.cold",
      type: "line",
      filter: ["all", ["==", "$type", "LineString"], ["!=", "active", "true"]],
      paint: { "line-color": cold, "line-width": 2 },
    },
    {
      id: "gl-draw-lines.hot",
      type: "line",
      filter: ["all", ["==", "$type", "LineString"], ["==", "active", "true"]],
      paint: { "line-color": hot, "line-width": 2 },
    },
    {
      id: "gl-draw-points.cold",
      type: "circle",
      filter: [
        "all",
        ["==", "$type", "Point"],
        ["!=", "meta", "midpoint"],
        ["!=", "active", "true"],
      ],
      paint: {
        "circle-radius": 5,
        "circle-color": cold,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    },
    {
      id: "gl-draw-points.hot",
      type: "circle",
      filter: [
        "all",
        ["==", "$type", "Point"],
        ["!=", "meta", "midpoint"],
        ["==", "active", "true"],
      ],
      paint: { "circle-radius": 5, "circle-color": hot },
    },
    {
      id: "gl-draw-points.mid",
      type: "circle",
      filter: ["all", ["==", "$type", "Point"], ["==", "meta", "midpoint"]],
      paint: { "circle-radius": 3, "circle-color": hot },
    },
  ];
}

function getId(f: any): string {
  const raw = f?.id ?? f?.properties?.destId ?? f?.properties?.id;
  return raw == null || raw === "" ? "" : String(raw);
}

function normalizeFeatures(features: Feature[]): Feature[] {
  // Ensure stable feature.id exists (Draw identity depends on top-level id)
  const seen = new Set<string>();
  const out: Feature[] = [];

  for (const f of features ?? []) {
    const id = getId(f);
    const normalized =
      id && id !== "undefined"
        ? ({
            ...(f as any),
            id,
            properties: { ...(f.properties ?? {}), id },
          } as Feature)
        : f;

    const nid = getId(normalized);
    if (nid && seen.has(nid)) continue;
    if (nid) seen.add(nid);
    out.push(normalized);
  }

  return out;
}

export default function DrawControl({
  map,
  position = "top-left",
  controls = { polygon: true },
  displayControlsDefault = false,
  activeColor = "#35D5A4",
  features,
  polys,
  onReady,
  onCreate,
  onUpdate,
  onDelete,
  onSelectionChange,
  onModeChange,
}: Props): null {
  const drawRef = useRef<MapLibreDraw | null>(null);
  const incomingFeatures = features ?? (polys as Feature[] | undefined) ?? [];

  // ✅ store latest features so when draw becomes ready we can sync immediately
  const featuresRef = useRef<Feature[]>([]);
  useEffect(() => {
    featuresRef.current = incomingFeatures;
  }, [incomingFeatures]);

  // keep latest handlers without reinstalling draw control
  const handlersRef = useRef({
    onReady,
    onCreate,
    onUpdate,
    onDelete,
    onSelectionChange,
    onModeChange,
  });
  useEffect(() => {
    handlersRef.current = {
      onReady,
      onCreate,
      onUpdate,
      onDelete,
      onSelectionChange,
      onModeChange,
    };
  }, [onReady, onCreate, onUpdate, onDelete, onSelectionChange, onModeChange]);

  const controlsKey = useMemo(() => JSON.stringify(controls ?? {}), [controls]);

  // ✅ function to sync a set of features into draw
  const syncIntoDraw = (draw: any, incomingRaw: any[]) => {
    const incoming = normalizeFeatures(incomingRaw as Feature[]);

    const mode =
      typeof draw.getMode === "function" ? String(draw.getMode()) : "";
    // Never wipe an in-progress create / vertex edit.
    if (
      mode.startsWith("draw_") ||
      mode === "direct_select" ||
      mode === "static"
    ) {
      return;
    }

    // If user has a selection, don't nuke state
    const selectedIds: string[] =
      typeof draw.getSelectedIds === "function" ? draw.getSelectedIds() : [];
    const hasSelection = selectedIds.length > 0;

    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: incoming as any,
    };

    // Best: draw.set() when not editing
    if (!hasSelection && typeof draw.set === "function") {
      draw.set(fc as any);
      return;
    }

    // Fallback: incremental add/update/delete (safe during editing)
    const existing: FeatureCollection =
      typeof draw.getAll === "function"
        ? (draw.getAll() as FeatureCollection)
        : { type: "FeatureCollection", features: [] };

    const existingById = new Map<string, Feature>();
    for (const f of existing.features ?? []) {
      const id = getId(f);
      if (id) existingById.set(id, f);
    }

    const incomingById = new Map<string, Feature>();
    for (const f of incoming) {
      const id = getId(f);
      if (id) incomingById.set(id, f as any);
    }

    // delete missing. Keep selected drafts (no destId yet) so in-progress
    // creates aren't wiped by a polys sync.
    for (const [id, existing] of existingById) {
      if (incomingById.has(id)) continue;
      const destId = Number(
        (existing as any)?.properties?.destId ?? existing.id,
      );
      const isDraft =
        selectedIds.includes(id) && !(Number.isFinite(destId) && destId > 0);
      if (isDraft) continue;
      try {
        draw.delete(id);
      } catch {}
    }

    // add/update
    for (const [id, f] of incomingById) {
      if (!existingById.has(id)) {
        try {
          draw.add(f as any);
        } catch {}
        continue;
      }

      // update geometry if changed, but don't touch selected feature mid-edit
      if (selectedIds.includes(id)) continue;

      const old = existingById.get(id) as any;
      const oldGeom = JSON.stringify(old?.geometry);
      const newGeom = JSON.stringify((f as any)?.geometry);

      if (oldGeom !== newGeom) {
        try {
          draw.delete(id);
          draw.add(f as any);
        } catch {}
      }
    }
  };

  // ✅ install draw control when map becomes available
  useEffect(() => {
    if (!map) return;

    const unbind = (draw: MapLibreDraw) => {
      map.off("draw.create" as any, (draw as any).__icOnCreate);
      map.off("draw.update" as any, (draw as any).__icOnUpdate);
      map.off("draw.delete" as any, (draw as any).__icOnDelete);
      map.off("draw.selectionchange" as any, (draw as any).__icOnSel);
      map.off("draw.modechange" as any, (draw as any).__icOnMode);
    };

    const install = () => {
      if (drawRef.current) {
        try {
          unbind(drawRef.current);
          map.removeControl(drawRef.current as any);
        } catch {
          /* already gone */
        }
        drawRef.current = null;
      }

      const draw = new MapLibreDraw({
        displayControlsDefault,
        controls,
        styles: fallbackStyles(activeColor),
      });

      const handleCreate = (e: any) => handlersRef.current.onCreate?.(e, draw);
      const handleUpdate = (e: any) => handlersRef.current.onUpdate?.(e, draw);
      const handleDelete = (e: any) => handlersRef.current.onDelete?.(e, draw);
      const handleSel = (e: any) =>
        handlersRef.current.onSelectionChange?.(e, draw);
      const handleMode = (e: any) =>
        handlersRef.current.onModeChange?.(e, draw);

      (draw as any).__icOnCreate = handleCreate;
      (draw as any).__icOnUpdate = handleUpdate;
      (draw as any).__icOnDelete = handleDelete;
      (draw as any).__icOnSel = handleSel;
      (draw as any).__icOnMode = handleMode;

      map.addControl(draw as any, position);
      drawRef.current = draw;

      map.on("draw.create" as any, handleCreate);
      map.on("draw.update" as any, handleUpdate);
      map.on("draw.delete" as any, handleDelete);
      map.on("draw.selectionchange" as any, handleSel);
      map.on("draw.modechange" as any, handleMode);

      syncIntoDraw(draw as any, featuresRef.current);
      handlersRef.current.onReady?.(draw);
    };

    install();

    // Only reinstall when style fully reloads AND draw layers are gone.
    const onStyleLoad = () => {
      const hasDrawLayer = Boolean(
        map.getStyle()?.layers?.some((l) => String(l.id).includes("gl-draw")),
      );
      if (hasDrawLayer && drawRef.current) {
        syncIntoDraw(drawRef.current as any, featuresRef.current);
        return;
      }
      install();
    };
    map.on("style.load", onStyleLoad);

    return () => {
      map.off("style.load", onStyleLoad);
      const draw = drawRef.current;
      if (draw) {
        try {
          unbind(draw);
          map.removeControl(draw as any);
        } catch {}
        drawRef.current = null;
        handlersRef.current.onReady?.(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, position, displayControlsDefault, controlsKey, activeColor]);

  // ✅ also resync any time features change AFTER draw exists
  useEffect(() => {
    const draw = drawRef.current as any;
    if (!draw) return;
    syncIntoDraw(draw, incomingFeatures);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingFeatures]);

  return null;
}
