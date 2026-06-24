"use client";

import { useCallback, useEffect, useState } from "react";
import type { UserPos } from "@/lib/types/map";
import type { NavStep } from "@/lib/navigation-types";
import { calcDistance } from "@/lib/utils";

const ADVANCE_OUTDOOR_METERS = 15;
const ADVANCE_INDOOR_GPS_METERS = 25;

function distanceAlongPolylineToPoint(
  coords: [number, number][],
  target: [number, number],
): number {
  let bestAlong = 0;
  let bestDist = Infinity;
  let accumulated = 0;
  for (let i = 1; i < coords.length; i++) {
    const [ax, ay] = coords[i - 1]!;
    const [bx, by] = coords[i]!;
    const segLen = calcDistance(ay, ax, by, bx);
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let along = 0;
    let dist = calcDistance(target[1], target[0], ay, ax);
    if (lenSq > 0) {
      let t = ((target[0] - ax) * dx + (target[1] - ay) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const px = ax + t * dx;
      const py = ay + t * dy;
      dist = calcDistance(target[1], target[0], py, px);
      along = accumulated + t * Math.sqrt(lenSq);
    }
    if (dist < bestDist) {
      bestDist = dist;
      bestAlong = along;
    }
    accumulated += segLen;
  }
  return bestAlong;
}

export type NavigationProgress = {
  currentStepIndex: number;
  distanceToNextMeters: number | null;
  advanceStep: () => void;
  setStepIndex: (index: number) => void;
  resetProgress: () => void;
};

export function useNavigationProgress(
  steps: NavStep[],
  userPos: UserPos | null,
  routeCoords: [number, number][],
  tracking: boolean,
): NavigationProgress {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const resetProgress = useCallback(() => {
    setCurrentStepIndex(0);
  }, []);

  const distanceToNextMeters = (() => {
    const step = steps[currentStepIndex];
    if (!step || step.kind !== "outdoor" || !userPos) return null;
    if (step.distanceMeters <= 0) return 0;

    if (routeCoords.length >= 2 && tracking) {
      const userAlong = distanceAlongPolylineToPoint(routeCoords, [
        userPos.lng,
        userPos.lat,
      ]);
      const targetAlong = distanceAlongPolylineToPoint(
        routeCoords,
        step.coordinate,
      );
      return Math.max(0, targetAlong - userAlong);
    }

    return calcDistance(
      userPos.lat,
      userPos.lng,
      step.coordinate[1],
      step.coordinate[0],
    );
  })();

  const advanceStep = useCallback(() => {
    setCurrentStepIndex((i) => Math.min(i + 1, Math.max(0, steps.length - 1)));
  }, [steps.length]);

  const setStepIndex = useCallback(
    (index: number) => {
      setCurrentStepIndex(Math.max(0, Math.min(index, steps.length - 1)));
    },
    [steps.length],
  );

  useEffect(() => {
    setCurrentStepIndex(0);
  }, [steps]);

  useEffect(() => {
    if (!tracking || !userPos || steps.length === 0) return;
    const step = steps[currentStepIndex];
    if (!step) return;

    if (step.kind === "outdoor") {
      if (
        distanceToNextMeters != null &&
        distanceToNextMeters <= ADVANCE_OUTDOOR_METERS &&
        currentStepIndex < steps.length - 1
      ) {
        setCurrentStepIndex((i) => i + 1);
      }
    }
  }, [tracking, userPos, steps, currentStepIndex, distanceToNextMeters]);

  return {
    currentStepIndex,
    distanceToNextMeters,
    advanceStep,
    setStepIndex,
    resetProgress,
  };
}

export function isNearOutdoorNode(
  userPos: UserPos,
  node: { lat: number; lng: number },
  thresholdMeters = ADVANCE_INDOOR_GPS_METERS,
): boolean {
  return (
    calcDistance(userPos.lat, userPos.lng, node.lat, node.lng) <=
    thresholdMeters
  );
}
