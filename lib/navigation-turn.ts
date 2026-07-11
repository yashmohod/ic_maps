import { bearingTo, normBearing } from "@/lib/geo";
import type { OutdoorManeuver } from "@/lib/navigation-types";

const STRAIGHT_THRESHOLD_DEG = 20;
const SHARP_THRESHOLD_DEG = 60;
const UTURN_THRESHOLD_DEG = 150;

export const MERGE_CONTINUE_METERS = 25;

export function classifyTurnDegrees(turnDeg: number): OutdoorManeuver {
  const abs = Math.abs(turnDeg);
  if (abs < STRAIGHT_THRESHOLD_DEG) return "continue";
  if (abs > UTURN_THRESHOLD_DEG) return "uturn";
  const sharp = abs >= SHARP_THRESHOLD_DEG;
  if (turnDeg < 0) return sharp ? "sharp-left" : "turn-left";
  return sharp ? "sharp-right" : "turn-right";
}

export function turnDegreesAtNode(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
  lng3: number,
  lat3: number,
): number {
  const bearingIn = bearingTo(lng1, lat1, lng2, lat2);
  const bearingOut = bearingTo(lng2, lat2, lng3, lat3);
  let turn = normBearing(bearingOut - bearingIn);
  if (turn > 180) turn -= 360;
  return turn;
}

type RawOutdoorStepLike = {
  maneuver: OutdoorManeuver;
  distanceMeters: number;
};

/** Merge consecutive shallow "continue" segments so steps are not every few meters. */
export function mergeContinueSteps<T extends RawOutdoorStepLike>(
  steps: T[],
): T[] {
  if (steps.length <= 1) return steps;
  const merged: T[] = [];
  for (const step of steps) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      step.maneuver === "continue" &&
      prev.maneuver === "continue" &&
      step.distanceMeters < MERGE_CONTINUE_METERS
    ) {
      prev.distanceMeters += step.distanceMeters;
      continue;
    }
    merged.push({ ...step });
  }
  return merged;
}
