import { describe, expect, it } from "vitest";
import { calcDistance } from "@/lib/geo";
import {
  densifyOsmGraph,
  findSnapTarget,
  isLikelyCollegeBuilding,
  onewayAlongWay,
  parseOsmBuildingEntrances,
  parseOsmBuildings,
  parseOsmWalkGraph,
  toDbEdgePair,
  type OsmOverpassResponse,
} from "@/lib/osm-import";

const fixture: OsmOverpassResponse = {
  elements: [
    { type: "node", id: 1, lat: 42.422, lon: -76.494 },
    { type: "node", id: 2, lat: 42.4221, lon: -76.494 },
    { type: "node", id: 3, lat: 42.4222, lon: -76.494 },
    { type: "node", id: 4, lat: 42.4223, lon: -76.494 },
    {
      type: "way",
      id: 10,
      nodes: [1, 2, 3],
      tags: { highway: "footway" },
    },
    {
      type: "way",
      id: 11,
      nodes: [3, 4],
      tags: { highway: "steps" },
    },
    {
      type: "way",
      id: 12,
      nodes: [1, 2],
      tags: { highway: "service" },
    },
  ],
};

describe("parseOsmWalkGraph", () => {
  it("builds nodes/edges and ORs flags at shared nodes", () => {
    const g = parseOsmWalkGraph(fixture, { maxEdgeMeters: 1000 });
    expect(g.nodes).toHaveLength(4);
    expect(g.edges).toHaveLength(3);

    const n1 = g.nodes.find((n) => n.osmId === 1)!;
    expect(n1.isPedestrian).toBe(true);
    expect(n1.isVehicular).toBe(true);

    const n3 = g.nodes.find((n) => n.osmId === 3)!;
    expect(n3.isStairs).toBe(true);
    expect(n3.isPedestrian).toBe(true);
    expect(n3.isRamp).toBe(false);
  });

  it("tags explicit ramp ways as ramps, not stairs", () => {
    const g = parseOsmWalkGraph(
      {
        elements: [
          { type: "node", id: 1, lat: 42.42, lon: -76.49 },
          { type: "node", id: 2, lat: 42.4201, lon: -76.49 },
          {
            type: "way",
            id: 50,
            nodes: [1, 2],
            tags: { highway: "footway", ramp: "yes" },
          },
        ],
      },
      { maxEdgeMeters: 1000 },
    );
    const n1 = g.nodes.find((n) => n.osmId === 1)!;
    expect(n1.isRamp).toBe(true);
    expect(n1.isStairs).toBe(false);
    expect(n1.isPedestrian).toBe(true);
  });

  it("skips ways outside the highway filter", () => {
    const g = parseOsmWalkGraph(
      {
        elements: [
          { type: "node", id: 1, lat: 42.42, lon: -76.49 },
          { type: "node", id: 2, lat: 42.421, lon: -76.49 },
          {
            type: "way",
            id: 99,
            nodes: [1, 2],
            tags: { highway: "motorway" },
          },
        ],
      },
      { maxEdgeMeters: 1000 },
    );
    expect(g.nodes).toHaveLength(0);
    expect(g.edges).toHaveLength(0);
  });
});

describe("findSnapTarget", () => {
  it("returns nearest id within snap distance", () => {
    const existing = [
      { id: 10, lat: 42.422, lng: -76.494 },
      { id: 11, lat: 42.43, lng: -76.5 },
    ];
    expect(findSnapTarget(42.422001, -76.494001, existing, 5)).toBe(10);
    expect(findSnapTarget(42.425, -76.497, existing, 5)).toBeNull();
  });
});

describe("densifyOsmGraph", () => {
  it("splits long edges so none exceed maxMeters", () => {
    // ~111m north-south at this latitude scale (0.001 deg lat ≈ 111m)
    const graph = densifyOsmGraph(
      {
        nodes: [
          {
            osmId: 1,
            lat: 42.42,
            lng: -76.49,
            isPedestrian: true,
            isVehicular: false,
            isStairs: false,
            isRamp: false,
          },
          {
            osmId: 2,
            lat: 42.421,
            lng: -76.49,
            isPedestrian: true,
            isVehicular: false,
            isStairs: false,
            isRamp: false,
          },
        ],
        edges: [{ osmA: 1, osmB: 2, biDirectional: true, inclineDegrees: 0 }],
      },
      20,
    );

    const byId = new Map(graph.nodes.map((n) => [n.osmId, n]));
    expect(graph.edges.length).toBeGreaterThan(1);
    for (const e of graph.edges) {
      const a = byId.get(e.osmA)!;
      const b = byId.get(e.osmB)!;
      expect(e.biDirectional).toBe(true);
      expect(calcDistance(a.lat, a.lng, b.lat, b.lng)).toBeLessThanOrEqual(
        20.01,
      );
    }
  });
});

describe("onewayAlongWay / parseOsmWalkGraph direction", () => {
  it("reads OSM oneway and roundabout tags", () => {
    expect(onewayAlongWay({ oneway: "yes" })).toBe("forward");
    expect(onewayAlongWay({ oneway: "-1" })).toBe("reverse");
    expect(onewayAlongWay({ junction: "roundabout" })).toBe("forward");
    expect(onewayAlongWay({ oneway: "yes", "oneway:foot": "no" })).toBe("both");
    expect(onewayAlongWay({})).toBe("both");
  });

  it("marks one-way road segments as unidirectional along the way", () => {
    const g = parseOsmWalkGraph(
      {
        elements: [
          { type: "node", id: 1, lat: 42.422, lon: -76.494 },
          { type: "node", id: 2, lat: 42.4221, lon: -76.494 },
          {
            type: "way",
            id: 20,
            nodes: [1, 2],
            tags: { highway: "residential", oneway: "yes" },
          },
        ],
      },
      { maxEdgeMeters: 1000 },
    );
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toEqual({
      osmA: 1,
      osmB: 2,
      biDirectional: false,
      inclineDegrees: 0,
    });
    expect(toDbEdgePair(10, 5, false)).toEqual({
      node_a_id: 5,
      node_b_id: 10,
      bi_directional: false,
      direction: false, // travel 10→5 = b→a
    });
  });

  it("parses numeric incline into degrees and marks ramp nodes", () => {
    const g = parseOsmWalkGraph(
      {
        elements: [
          { type: "node", id: 1, lat: 42.422, lon: -76.494 },
          { type: "node", id: 2, lat: 42.4221, lon: -76.494 },
          {
            type: "way",
            id: 20,
            nodes: [1, 2],
            tags: { highway: "footway", incline: "8%" },
          },
        ],
      },
      { maxEdgeMeters: 1000 },
    );
    expect(g.edges[0]!.inclineDegrees).toBeGreaterThan(4);
    expect(g.edges[0]!.inclineDegrees).toBeLessThan(6);
    expect(g.nodes.every((n) => n.isRamp)).toBe(true);
  });

  it("opens both ways when opposite one-ways share a segment", () => {
    const g = parseOsmWalkGraph(
      {
        elements: [
          { type: "node", id: 1, lat: 42.422, lon: -76.494 },
          { type: "node", id: 2, lat: 42.4221, lon: -76.494 },
          {
            type: "way",
            id: 20,
            nodes: [1, 2],
            tags: { highway: "service", oneway: "yes" },
          },
          {
            type: "way",
            id: 21,
            nodes: [2, 1],
            tags: { highway: "service", oneway: "yes" },
          },
        ],
      },
      { maxEdgeMeters: 1000 },
    );
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]!.biDirectional).toBe(true);
  });
});

describe("parseOsmBuildings parking + entrances", () => {
  it("seeds parking lots and links outline entrances", () => {
    const osm: OsmOverpassResponse = {
      elements: [
        { type: "node", id: 1, lat: 42.422, lon: -76.495 },
        {
          type: "node",
          id: 2,
          lat: 42.422,
          lon: -76.494,
          tags: { entrance: "main" },
        },
        { type: "node", id: 3, lat: 42.423, lon: -76.494 },
        { type: "node", id: 4, lat: 42.423, lon: -76.495 },
        { type: "node", id: 5, lat: 42.421, lon: -76.495 },
        { type: "node", id: 6, lat: 42.421, lon: -76.494 },
        { type: "node", id: 7, lat: 42.4205, lon: -76.494 },
        { type: "node", id: 8, lat: 42.4205, lon: -76.495 },
        {
          type: "way",
          id: 100,
          nodes: [1, 2, 3, 4, 1],
          tags: { building: "university", name: "Job Hall" },
        },
        {
          type: "way",
          id: 200,
          nodes: [5, 6, 7, 8, 5],
          tags: { amenity: "parking", name: "Lot A" },
        },
      ],
    };
    const areas = parseOsmBuildings(osm);
    expect(areas).toHaveLength(2);
    expect(areas.find((a) => a.name === "Lot A")?.isParkingLot).toBe(true);
    expect(areas.find((a) => a.name === "Job Hall")?.isParkingLot).toBe(false);

    const entrances = parseOsmBuildingEntrances(osm, areas);
    expect(entrances).toEqual([
      {
        osmNodeId: 2,
        buildingOsmId: 100,
        lat: 42.422,
        lng: -76.494,
        kind: "main",
      },
    ]);
  });
});

describe("isLikelyCollegeBuilding", () => {
  it("keeps campus halls and drops city / house-number noise", () => {
    expect(isLikelyCollegeBuilding({ building: "yes", name: "Job Hall" })).toBe(
      true,
    );
    expect(
      isLikelyCollegeBuilding({
        building: "yes",
        name: "Ithaca Fire Department South Hill Station 3",
        amenity: "fire_station",
        operator: "City of Ithaca",
      }),
    ).toBe(false);
    expect(isLikelyCollegeBuilding({ building: "yes", name: "1020" })).toBe(
      false,
    );
  });
});

describe("parseOsmBuildings", () => {
  it("builds named destination polygons from closed ways", () => {
    const buildings = parseOsmBuildings({
      elements: [
        { type: "node", id: 1, lat: 42.422, lon: -76.495 },
        { type: "node", id: 2, lat: 42.422, lon: -76.494 },
        { type: "node", id: 3, lat: 42.423, lon: -76.494 },
        { type: "node", id: 4, lat: 42.423, lon: -76.495 },
        {
          type: "way",
          id: 100,
          nodes: [1, 2, 3, 4, 1],
          tags: { building: "university", name: "Job Hall" },
        },
        {
          type: "way",
          id: 101,
          nodes: [1, 2, 3, 4, 1],
          tags: { building: "yes" },
        },
        {
          type: "way",
          id: 102,
          nodes: [1, 2, 3, 4, 1],
          tags: { building: "yes", name: "1020" },
        },
      ],
    });
    expect(buildings).toHaveLength(1);
    expect(buildings[0]!.name).toBe("Job Hall");
    expect(buildings[0]!.feature.geometry.type).toBe("Polygon");
    expect(buildings[0]!.feature.geometry.coordinates[0]!.length).toBe(5);
  });
});
