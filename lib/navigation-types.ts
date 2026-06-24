/** Shared navigation step types (client + server). */

export type OutdoorManeuver =
  | "depart"
  | "continue"
  | "turn-left"
  | "turn-right"
  | "sharp-left"
  | "sharp-right"
  | "uturn"
  | "arrive";

export type OutdoorNavStep = {
  kind: "outdoor";
  maneuver: OutdoorManeuver;
  instruction: string;
  /** Distance in meters until the next step. */
  distanceMeters: number;
  coordinate: [number, number];
  /** Outdoor node id at the maneuver point (when known). */
  nodeId?: number;
};

export type IndoorNavStep = {
  kind: "indoor";
  instruction: string;
  buildingName: string;
  destinationId: number;
  /** Exit outdoor node id for auto-advance during tracking (when known). */
  exitOutdoorNodeId?: number;
};

export type NavStep = OutdoorNavStep | IndoorNavStep;
