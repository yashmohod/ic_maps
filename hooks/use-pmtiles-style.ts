import { useEffect, useState } from "react";
import maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import { PMTiles, Protocol } from "pmtiles";

type UsePmtilesStyleOptions = {
  pmtilesPath?: string;
  stylePath?: string;
  glyphsFallback?: string;
};

let protocol: Protocol | null = null;
let pmtilesInstance: PMTiles | null = null;
let pmtilesInstanceUrl: string | null = null;
const styleCache = new Map<
  string,
  { style: StyleSpecification; vectorSourceId: string }
>();
const tilesetLayerCache = new Map<string, Set<string>>();
const metadataPromises = new Map<string, Promise<Set<string>>>();

function ensurePmtiles(url: string) {
  if (!protocol) {
    protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
  }

  if (!pmtilesInstance || pmtilesInstanceUrl !== url) {
    pmtilesInstance = new PMTiles(url);
    protocol.add(pmtilesInstance);
    pmtilesInstanceUrl = url;
  }

  return pmtilesInstance;
}

function cloneStyle(style: StyleSpecification): StyleSpecification {
  return JSON.parse(JSON.stringify(style)) as StyleSpecification;
}

function absolutizeUrl(value: string, base: string) {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

function absolutizeTemplateUrl(value: string, base: string) {
  if (!value) return value;
  const normalized = value.replace("{styleJsonFolder}", ".");
  if (!/\{[^}]+\}/.test(normalized)) return absolutizeUrl(normalized, base);

  const tokens: string[] = [];
  const withPlaceholders = normalized.replace(/\{[^}]+\}/g, (token) => {
    const id = tokens.length;
    tokens.push(token);
    return `__T${id}__`;
  });

  try {
    let abs = new URL(withPlaceholders, base).toString();
    tokens.forEach((token, idx) => {
      abs = abs.replaceAll(`__T${idx}__`, token);
    });
    return abs;
  } catch {
    return value;
  }
}

export function usePmtilesStyle(options: UsePmtilesStyleOptions = {}) {
  const pmtilesPath = options.pmtilesPath ?? "/tiles/ithaca.pmtiles";
  const stylePath = options.stylePath ?? "/styles/osm-bright/style-local.json";
  const glyphsFallback =
    options.glyphsFallback ??
    "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf";

  const cachedStyle = styleCache.get(stylePath);
  const [pmtilesReady, setPmtilesReady] = useState(false);
  const [tilesetLayerNames, setTilesetLayerNames] = useState<Set<string>>(
    () => new Set(tilesetLayerCache.get(pmtilesPath) ?? []),
  );
  const [baseStyle, setBaseStyle] = useState<StyleSpecification | null>(() =>
    cachedStyle ? cloneStyle(cachedStyle.style) : null,
  );
  const [vectorSourceId, setVectorSourceId] = useState(
    cachedStyle?.vectorSourceId ?? "openmaptiles",
  );

  useEffect(() => {
    const cached = styleCache.get(stylePath);
    if (cached) {
      setVectorSourceId(cached.vectorSourceId);
      setBaseStyle(cloneStyle(cached.style));
    }
  }, [stylePath]);

  useEffect(() => {
    let cancelled = false;
    setPmtilesReady(false);

    (async () => {
      try {
        const pmtilesUrl = new URL(pmtilesPath, window.location.origin).toString();
        const pmtiles = ensurePmtiles(pmtilesUrl);
        const cachedLayers = tilesetLayerCache.get(pmtilesPath);
        if (cachedLayers) {
          if (!cancelled) {
            setTilesetLayerNames(new Set(cachedLayers));
            setPmtilesReady(true);
          }
          return;
        }

        const pending =
          metadataPromises.get(pmtilesUrl) ??
          (async () => {
            try {
              const m: any = await pmtiles.getMetadata();
              const ids: string[] =
                (m?.vector_layers ?? m?.vectorLayers ?? []).map((v: any) =>
                  String(v.id),
                );
              const setIds = new Set(ids);
              tilesetLayerCache.set(pmtilesPath, setIds);
              return setIds;
            } catch (e) {
              console.warn("[pmtiles] metadata read failed", e);
              return new Set<string>();
            }
          })();
        metadataPromises.set(pmtilesUrl, pending);

        const ids = await pending;
        if (!cancelled) setTilesetLayerNames(new Set(ids));
      } catch (e) {
        console.error("[pmtiles] init failed", e);
      } finally {
        if (!cancelled) setPmtilesReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pmtilesPath]);

  useEffect(() => {
    if (!pmtilesReady) return;

    let cancelled = false;

    (async () => {
      try {
        const origin = window.location.origin;
        const styleUrl = new URL(stylePath, origin).toString();
        const pmtilesUrl = new URL(pmtilesPath, origin).toString();

        const res = await fetch(styleUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(`style fetch failed: ${res.status}`);
        const style: any = await res.json();

        const spriteValue =
          typeof style.sprite === "string" ? style.sprite : "./sprite";
        const glyphsValue =
          typeof style.glyphs === "string" ? style.glyphs : glyphsFallback;
        style.sprite = absolutizeTemplateUrl(spriteValue, styleUrl);
        style.glyphs = absolutizeTemplateUrl(glyphsValue, styleUrl);

        if (style.sources && typeof style.sources === "object") {
          for (const k of Object.keys(style.sources)) {
            const src: any = style.sources[k];
            if (!src || typeof src !== "object") continue;

            if (typeof src.url === "string" && !src.url.startsWith("pmtiles://")) {
              src.url = absolutizeTemplateUrl(src.url, styleUrl);
            }
            if (Array.isArray(src.tiles)) {
              src.tiles = src.tiles.map((t: string) =>
                absolutizeTemplateUrl(t, styleUrl),
              );
            }
          }
        }

        const srcKey =
          style?.sources?.openmaptiles
            ? "openmaptiles"
            : Object.keys(style?.sources ?? {}).find(
              (k) => style.sources[k]?.type === "vector",
            ) ?? "openmaptiles";

        style.sources = style.sources ?? {};
        style.sources[srcKey] = {
          ...(style.sources[srcKey] ?? {}),
          type: "vector",
          url: `pmtiles://${pmtilesUrl}`,
        };

        if (style.sources[srcKey]?.tiles) delete style.sources[srcKey].tiles;

        if (tilesetLayerNames.size > 0 && Array.isArray(style.layers)) {
          style.layers = style.layers.filter((ly: any) => {
            if (!ly || typeof ly !== "object") return false;
            if (!ly.source) return true;
            if (ly.source !== srcKey) return true;

            const sl = ly["source-layer"];
            if (!sl) return true;

            return tilesetLayerNames.has(String(sl));
          });
        }

        if (!cancelled) {
          setVectorSourceId(srcKey);
          setBaseStyle(style as StyleSpecification);
          styleCache.set(stylePath, {
            style: style as StyleSpecification,
            vectorSourceId: srcKey,
          });
        }
      } catch (e) {
        console.error("[style] patch failed", e);
        const cached = styleCache.get(stylePath);
        if (!cancelled && cached) {
          setVectorSourceId(cached.vectorSourceId);
          setBaseStyle(cloneStyle(cached.style));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pmtilesReady, tilesetLayerNames, pmtilesPath, stylePath, glyphsFallback]);

  return { baseStyle, vectorSourceId };
}
