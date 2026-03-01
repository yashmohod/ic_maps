// src/components/DrawControl.tsx
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

  polys: Array<Feature<Polygon, GeoJsonProperties>>;

  onCreate?: (e: DrawEvent, draw: MapLibreDraw) => void;
  onUpdate?: (e: DrawEvent, draw: MapLibreDraw) => void;
  onDelete?: (e: DrawEvent, draw: MapLibreDraw) => void;
  onSelectionChange?: (e: DrawEvent, draw: MapLibreDraw) => void;
  onModeChange?: (e: unknown, draw: MapLibreDraw) => void;
};

function fallbackStyles() {
  return [
    {
      id: "gl-draw-polygon-fill.cold",
      type: "fill",
      filter: ["all", ["==", "$type", "Polygon"], ["!=", "active", "true"]],
      paint: { "fill-color": "#3bb2d0", "fill-opacity": 0.4 },
    },
    {
      id: "gl-draw-polygon-fill.hot",
      type: "fill",
      filter: ["all", ["==", "$type", "Polygon"], ["==", "active", "true"]],
      paint: { "fill-color": "#fbb03b", "fill-opacity": 0.4 },
    },
    {
      id: "gl-draw-lines.cold",
      type: "line",
      filter: ["all", ["==", "$type", "LineString"], ["!=", "active", "true"]],
      paint: { "line-color": "#3bb2d0", "line-width": 2 },
    },
    {
      id: "gl-draw-lines.hot",
      type: "line",
      filter: ["all", ["==", "$type", "LineString"], ["==", "active", "true"]],
      paint: { "line-color": "#fbb03b", "line-width": 2 },
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
      paint: { "circle-radius": 5, "circle-color": "#3bb2d0" },
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
      paint: { "circle-radius": 5, "circle-color": "#fbb03b" },
    },
    {
      id: "gl-draw-points.mid",
      type: "circle",
      filter: ["all", ["==", "$type", "Point"], ["==", "meta", "midpoint"]],
      paint: { "circle-radius": 3, "circle-color": "#fbb03b" },
    },
  ];
}

function getId(f: any): string {
  return String(f?.id ?? f?.properties?.id ?? "");
}

function normalizeFeatures(
  polys: Array<Feature<Polygon, GeoJsonProperties>>,
): Array<Feature<Polygon, GeoJsonProperties>> {
  // Ensure stable feature.id exists (Draw identity depends on top-level id)
  const seen = new Set<string>();
  const out: Array<Feature<Polygon, GeoJsonProperties>> = [];

  for (const f of polys ?? []) {
    const id = getId(f);
    const normalized =
      id && id !== "undefined"
        ? ({
            ...(f as any),
            id,
            properties: { ...(f.properties ?? {}), id },
          } as Feature<Polygon, GeoJsonProperties>)
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
  polys,

  onCreate,
  onUpdate,
  onDelete,
  onSelectionChange,
  onModeChange,
}: Props): null {
  const drawRef = useRef<MapLibreDraw | null>(null);

  // ✅ store latest polys so when draw becomes ready we can sync immediately
  const polysRef = useRef<Array<Feature<Polygon, GeoJsonProperties>>>([]);
  useEffect(() => {
    polysRef.current = polys ?? [];
  }, [polys]);

  // keep latest handlers without reinstalling draw control
  const handlersRef = useRef({
    onCreate,
    onUpdate,
    onDelete,
    onSelectionChange,
    onModeChange,
  });
  useEffect(() => {
    handlersRef.current = {
      onCreate,
      onUpdate,
      onDelete,
      onSelectionChange,
      onModeChange,
    };
  }, [onCreate, onUpdate, onDelete, onSelectionChange, onModeChange]);

  const controlsKey = useMemo(() => JSON.stringify(controls ?? {}), [controls]);

  // ✅ function to sync a set of polys into draw
  const syncIntoDraw = (draw: any, incomingRaw: any[]) => {
    const incoming = normalizeFeatures(
      incomingRaw as Array<Feature<Polygon, GeoJsonProperties>>,
    );

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

    // delete missing (but not currently selected)
    for (const [id] of existingById) {
      if (!incomingById.has(id) && !selectedIds.includes(id)) {
        try {
          draw.delete(id);
        } catch {}
      }
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

    // StrictMode/dev double effect protection
    if (drawRef.current) return;

    const draw = new MapLibreDraw({
      displayControlsDefault,
      controls,
      styles: fallbackStyles(),
    });

    map.addControl(draw as any, position);
    drawRef.current = draw;

    // wire events using handler refs (no re-add control when callbacks change)
    const handleCreate = (e: any) => handlersRef.current.onCreate?.(e, draw);
    const handleUpdate = (e: any) => handlersRef.current.onUpdate?.(e, draw);
    const handleDelete = (e: any) => handlersRef.current.onDelete?.(e, draw);
    const handleSel = (e: any) =>
      handlersRef.current.onSelectionChange?.(e, draw);
    const handleMode = (e: any) => handlersRef.current.onModeChange?.(e, draw);

    map.on("draw.create" as any, handleCreate);
    map.on("draw.update" as any, handleUpdate);
    map.on("draw.delete" as any, handleDelete);
    map.on("draw.selectionchange" as any, handleSel);
    map.on("draw.modechange" as any, handleMode);

    // ✅ CRITICAL: sync immediately using latest polys (fixes “first load shows nothing”)
    syncIntoDraw(draw as any, polysRef.current);

    return () => {
      map.off("draw.create" as any, handleCreate);
      map.off("draw.update" as any, handleUpdate);
      map.off("draw.delete" as any, handleDelete);
      map.off("draw.selectionchange" as any, handleSel);
      map.off("draw.modechange" as any, handleMode);

      try {
        map.removeControl(draw as any);
      } catch {}
      drawRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, position, displayControlsDefault, controlsKey]);

  // ✅ also resync any time polys changes AFTER draw exists
  useEffect(() => {
    const draw = drawRef.current as any;
    if (!draw) return;
    syncIntoDraw(draw, polys ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polys]);

  return null;
}
