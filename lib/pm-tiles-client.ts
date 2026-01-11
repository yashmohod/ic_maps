"use client";

import maplibregl from "maplibre-gl";
import { Protocol, PMTiles } from "pmtiles";

let protocol: Protocol | null = null;
let addedUrl: string | null = null;

export function initPmtilesFor(url: string) {
  if (!protocol) {
    protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
  }

  // Share one PMTiles instance with the renderer (recommended pattern)
  if (addedUrl !== url) {
    protocol.add(new PMTiles(url));
    addedUrl = url;
  }
}
