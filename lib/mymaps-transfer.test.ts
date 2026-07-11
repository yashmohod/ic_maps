import { describe, expect, it } from "vitest";
import {
  buildTransferPayload,
  myMapsTransferSchema,
  remapEdgeEndpoints,
  toStoredLineGeometry,
  transferDownloadFilename,
} from "@/lib/mymaps-transfer";

describe("myMapsTransferSchema", () => {
  it("parses a valid payload", () => {
    const parsed = myMapsTransferSchema.parse({
      version: 1,
      nodes: [{ id: 1, lat: 42.4, lng: -76.5, name: "A" }],
      edges: [{ from: 1, to: 2, biDirectional: true }],
      polygons: [],
      lines: [],
      points: [{ lat: 42.41, lng: -76.51, name: "P" }],
      texts: [{ text: "Hello", lat: 42.4, lng: -76.5, font_size: 14 }],
    });
    expect(parsed.version).toBe(1);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.edges[0]?.incline).toBe(0);
  });

  it("rejects wrong version", () => {
    expect(() =>
      myMapsTransferSchema.parse({ version: 2, nodes: [], edges: [] }),
    ).toThrow();
  });
});

describe("remapEdgeEndpoints", () => {
  it("remaps from/to and drops broken edges", () => {
    const idMap = new Map([
      [10, 100],
      [20, 200],
    ]);
    const remapped = remapEdgeEndpoints(
      [
        { from: 10, to: 20, biDirectional: false, incline: 1.5 },
        { from: 10, to: 99 },
        { from: 10, to: 10 },
      ],
      idMap,
    );
    expect(remapped).toEqual([
      { from: 100, to: 200, biDirectional: false, incline: 1.5 },
    ]);
  });
});

describe("toStoredLineGeometry", () => {
  it("wraps a LineString as a Feature string", () => {
    const raw = toStoredLineGeometry({
      type: "LineString",
      coordinates: [
        [-76.5, 42.4],
        [-76.51, 42.41],
      ],
    });
    expect(raw).toBeTruthy();
    const obj = JSON.parse(raw!);
    expect(obj.type).toBe("Feature");
    expect(obj.geometry.type).toBe("LineString");
  });
});

describe("buildTransferPayload", () => {
  it("builds a versioned export object", () => {
    const payload = buildTransferPayload({
      mapName: "Campus",
      nodes: [{ id: 1, lat: 42.4, lng: -76.5, name: "N" }],
      edges: [{ from: 1, to: 2, biDirectional: true }],
      polygons: [{ name: "A", polygon: "{}" }],
      lines: [],
      points: [],
      texts: [],
    });
    expect(payload.version).toBe(1);
    expect(payload.mapName).toBe("Campus");
    expect(payload.exportedAt).toBeTruthy();
  });
});

describe("transferDownloadFilename", () => {
  it("slugs the map name", () => {
    expect(transferDownloadFilename(3, "My Cool Map!")).toBe(
      "mymap-3-my-cool-map.json",
    );
  });
});
