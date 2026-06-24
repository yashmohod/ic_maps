import type { NavStep } from "@/lib/navigation-types";

export type LngLat = { lng: number; lat: number };

export type UserPos = {
  lng: number;
  lat: number;
  accuracy?: number;
  heading?: number | null;
};

export type MarkerNode = {
  id: number;
  lng: number;
  lat: number;
  isBlueLight: boolean;
  isPedestrian: boolean;
  isVehicular: boolean;
  isStairs: boolean;
  isElevator: boolean;
  isDead: boolean;
};

/** Simplified marker used in consumer pages that only need position */
export type SimpleMarkerNode = {
  id: string | number;
  lng: number;
  lat: number;
};

export type EdgeIndexEntry = {
  id: number;
  from: number;
  to: number;
  biDirectional: boolean;
  incline: number;
};

export type GeoJSONFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, any>;
    geometry:
      | { type: "Point"; coordinates: [number, number] }
      | { type: "LineString"; coordinates: Array<[number, number]> }
      | { type: "Polygon"; coordinates: Array<Array<[number, number]>> }
      | {
          type: "MultiPolygon";
          coordinates: Array<Array<Array<[number, number]>>>;
        };
  }>;
};

export type ViewStateLite = {
  longitude: number;
  latitude: number;
  zoom: number;
};

export type MapDestination = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  polygon: string;
  isParkingLot: boolean;
};

export type OutsideNodeDetail = {
  id: number;
  lat: number;
  lng: number;
  name?: string | null;
};

export type RouteLegMetrics = {
  destinationId: number;
  distanceMeters: number;
  durationSeconds: number;
};

export type NavigateToResponse = {
  path: number[];
  geometry: {
    type: "LineString";
    coordinates: Array<[number, number]>;
  };
  firstNodeId: number;
  lastNodeId: number;
  startNode: { id: number; lat: number; lng: number };
  distanceMeters: number;
  durationSeconds: number;
  legs: RouteLegMetrics[];
  steps: NavStep[];
};
