import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { PMTiles } from "pmtiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyStyle = Record<string, any>;

function getVectorLayerIds(metadata: any): Set<string> {
  const layers =
    metadata?.vector_layers ??
    metadata?.vectorLayers ??
    metadata?.json?.vector_layers ??
    [];
  return new Set((layers || []).map((l: any) => String(l.id)));
}

function pickMainVectorSourceName(style: AnyStyle): string | null {
  const sources = style?.sources ?? {};
  for (const [name, src] of Object.entries(sources)) {
    if ((src as any)?.type === "vector") return name;
  }
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;

  // 1) Load the base style file (OSM Bright local version)
  const stylePath = path.join(
    process.cwd(),
    "public",
    "styles",
    "osm-bright",
    "style-local.json",
  );

  const raw = await readFile(stylePath, "utf8");
  const style: AnyStyle = JSON.parse(raw);

  // 2) Compute absolute URLs
  const pmtilesHttpUrl = new URL("/tiles/ithaca.pmtiles", origin).toString();

  // IMPORTANT: this must match what you add via maplibregl.addProtocol("pmtiles", ...)
  const pmtilesStyleUrl = `pmtiles://${pmtilesHttpUrl}`;

  const spriteAbs = new URL("/styles/osm-bright/sprite", origin).toString();

  // You can self-host later; for now, keep labels working for free via OpenMapTiles hosted glyphs
  const glyphsAbs = "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf";

  // 3) Patch sprite + glyphs
  style.sprite = spriteAbs;
  style.glyphs = glyphsAbs;

  // 4) Patch the main vector source to use PMTiles
  const vecSourceName = pickMainVectorSourceName(style) ?? "openmaptiles";
  style.sources = style.sources ?? {};
  style.sources[vecSourceName] = style.sources[vecSourceName] ?? {
    type: "vector",
  };
  style.sources[vecSourceName].type = "vector";
  style.sources[vecSourceName].url = pmtilesStyleUrl;

  // If the style had "tiles", remove them to avoid conflicts
  if ("tiles" in style.sources[vecSourceName])
    delete style.sources[vecSourceName].tiles;

  // 5) Read PMTiles metadata so we can remove style layers that reference missing source-layers
  // This prevents errors like: "Source layer 'aerodrome_label' does not exist..."
  let vectorLayerIds = new Set<string>();
  try {
    const p = new PMTiles(pmtilesHttpUrl);
    const metadata = await p.getMetadata();
    vectorLayerIds = getVectorLayerIds(metadata);
  } catch {
    // If metadata fetch fails, we won't prune.
    // (Map may still render, but you'll see those console errors.)
  }

  if (vectorLayerIds.size > 0 && Array.isArray(style.layers)) {
    // First pass: drop layers that reference source-layers not present
    const kept = style.layers.filter((layer: any) => {
      const usesMainSource = layer?.source === vecSourceName;
      const sourceLayer = layer?.["source-layer"];
      if (!usesMainSource) return true; // keep non-main-source layers (background, hillshade, etc.)
      if (!sourceLayer) return true; // keep layers without source-layer (refs, backgrounds, etc.)
      return vectorLayerIds.has(String(sourceLayer));
    });

    // Second pass: drop "ref" layers whose target got removed
    const keptIds = new Set(kept.map((l: any) => String(l.id)));
    style.layers = kept.filter((layer: any) => {
      if (!layer?.ref) return true;
      return keptIds.has(String(layer.ref));
    });
  }

  return new NextResponse(JSON.stringify(style), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
