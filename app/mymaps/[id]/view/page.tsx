"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  Map as ReactMap,
  Marker,
  Source,
  Layer,
  type MapRef,
  type ViewStateChangeEvent,
} from "@vis.gl/react-maplibre";
import maplibregl, { type LineLayerSpecification } from "maplibre-gl";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  LineString,
  Polygon,
} from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

import { HomeLogoLink } from "@/components/home-logo-link";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useMapStyle } from "@/hooks/use-map-style";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";
import apiClient from "@/lib/apiClient";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/map-constants";
import {
  borderMutedClass,
  mapPageClass,
  safeAreaTopClass,
  surfacePanelClass,
} from "@/lib/panel-classes";
import type { ViewStateLite } from "@/lib/types/map";

type SimpleNode = { id: number; lat: number; lng: number; name: string };
type EdgeRow = {
  id: number;
  from: number;
  to: number;
  biDirectional: boolean;
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

export default function MyMapPublicViewPage(): JSX.Element {
  const params = useParams();
  const rawId = params?.id;
  const mapId =
    typeof rawId === "string" &&
    Number.isInteger(Number(rawId)) &&
    Number(rawId) > 0
      ? Number(rawId)
      : null;

  const [viewState, setViewState] = useState<ViewStateLite>({
    longitude: DEFAULT_CENTER.lng,
    latitude: DEFAULT_CENTER.lat,
    zoom: DEFAULT_ZOOM,
  });
  const { mapStyle } = useMapStyle();
  const { baseStyle } = usePmtilesStyle({ stylePath: mapStyle });
  const canRenderMap = !!baseStyle;
  const mapRef = useRef<MapRef | null>(null);

  const [mapName, setMapName] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [nodes, setNodes] = useState<SimpleNode[]>([]);
  const [edges, setEdges] = useState<EdgeRow[]>([]);
  const [polygons, setPolygons] = useState<PolygonRow[]>([]);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [points, setPoints] = useState<PointRow[]>([]);
  const [texts, setTexts] = useState<TextRow[]>([]);

  const loadMap = useCallback(async () => {
    if (!mapId) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    try {
      const res = await apiClient.get(`/api/mymaps/maps/${mapId}`);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const data = await res.json();
      setMapName(data.map?.name ?? "Shared map");
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
          }) => ({
            id: e.id,
            from: e.direction ? e.node_a_id : e.node_b_id,
            to: e.direction ? e.node_b_id : e.node_a_id,
            biDirectional: Boolean(e.bi_directional),
          }),
        ),
      );
      setPolygons(data.polygons ?? []);
      setLines(data.lines ?? []);
      setPoints(data.points ?? []);
      setTexts(data.texts ?? []);
    } catch {
      toast.error("Could not load map");
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [mapId]);

  useEffect(() => {
    void loadMap();
  }, [loadMap]);

  const polys = useMemo(() => {
    const out: Array<Feature<Polygon, GeoJsonProperties>> = [];
    for (const row of polygons) {
      const f = parsePolygonFeature(row.polygon);
      if (!f) continue;
      f.properties = { ...(f.properties ?? {}), name: row.name };
      out.push(f);
    }
    return out;
  }, [polygons]);

  const lineFeatures = useMemo(() => {
    const out: Array<Feature<LineString, GeoJsonProperties>> = [];
    for (const row of lines) {
      const f = parseLineFeature(row.geometry);
      if (!f) continue;
      f.properties = { ...(f.properties ?? {}), name: row.name };
      out.push(f);
    }
    return out;
  }, [lines]);

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
      id: "mymap-view-edges-bidir",
      type: "line",
      source: "mymap-view-edges",
      filter: ["==", ["get", "bidir"], 1],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#35D5A4",
        "line-width": 3,
        "line-opacity": 0.95,
      },
    }),
    [],
  );

  const edgeLayerOneWay = useMemo<LineLayerSpecification>(
    () => ({
      id: "mymap-view-edges-oneway",
      type: "line",
      source: "mymap-view-edges",
      filter: ["==", ["get", "bidir"], 0],
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": "#003c71",
        "line-width": 3,
        "line-opacity": 0.95,
        "line-dasharray": [2, 1.5],
      },
    }),
    [],
  );

  if (loading) {
    return (
      <div className={`${mapPageClass} grid place-items-center`}>
        <Spinner className="size-8" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div
        className={`${mapPageClass} grid place-items-center gap-3 p-6 text-center`}
      >
        <p className="text-sm">This map is private or does not exist.</p>
        <Button asChild>
          <Link href="/">Back to campus map</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className={mapPageClass}>
      <div
        className={`absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-2 px-3 py-2 ${safeAreaTopClass}`}
      >
        <div
          className={`flex items-center gap-2 rounded-2xl border px-2 py-1 ${borderMutedClass} ${surfacePanelClass}`}
        >
          <HomeLogoLink />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{mapName}</p>
            <p className="text-[11px] text-panel-muted-foreground">
              Public view
            </p>
          </div>
        </div>
        <ThemeToggleButton />
      </div>

      <div className="absolute inset-0">
        {!canRenderMap ? (
          <div className="grid h-full place-items-center text-sm opacity-70">
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
            mapStyle={baseStyle as never}
          >
            <Source id="mymap-view-edges" type="geojson" data={edgesGeoJSON}>
              <Layer {...edgeLayerBidir} />
              <Layer {...edgeLayerOneWay} />
            </Source>
            {polys.length > 0 ? (
              <Source
                id="mymap-view-polys"
                type="geojson"
                data={{ type: "FeatureCollection", features: polys }}
              >
                <Layer
                  id="mymap-view-poly-fill"
                  type="fill"
                  paint={{ "fill-color": "#1a5276", "fill-opacity": 0.35 }}
                />
                <Layer
                  id="mymap-view-poly-line"
                  type="line"
                  paint={{ "line-color": "#35D5A4", "line-width": 2 }}
                />
              </Source>
            ) : null}
            {lineFeatures.length > 0 ? (
              <Source
                id="mymap-view-lines"
                type="geojson"
                data={{ type: "FeatureCollection", features: lineFeatures }}
              >
                <Layer
                  id="mymap-view-drawn-lines"
                  type="line"
                  paint={{ "line-color": "#1a5276", "line-width": 2 }}
                />
              </Source>
            ) : null}
            {points.map((p) => (
              <Marker
                key={`pt-${p.id}`}
                longitude={p.lng}
                latitude={p.lat}
                anchor="center"
              >
                <div
                  className="h-2.5 w-2.5 rounded-full border-2 border-white bg-[#1a5276] shadow"
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
              >
                <div
                  className="h-3 w-3 rounded-full border-2 border-white bg-[#003c71] shadow"
                  title={n.name || `Node ${n.id}`}
                />
              </Marker>
            ))}
            {texts.map((t) => (
              <Marker
                key={`txt-${t.id}`}
                longitude={t.lng}
                latitude={t.lat}
                anchor="center"
              >
                <div
                  className="max-w-[12rem] rounded border border-white/80 bg-panel/90 px-1.5 py-0.5 shadow"
                  style={{ fontSize: t.font_size ?? 14 }}
                >
                  {t.text}
                </div>
              </Marker>
            ))}
          </ReactMap>
        )}
      </div>
    </div>
  );
}
