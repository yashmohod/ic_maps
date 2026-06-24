"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DISTANCE_UNITS_STORAGE_KEY,
  parseDistanceUnits,
  type DistanceUnits,
} from "@/lib/distance-display";

export function useDistanceUnits() {
  const [units, setUnitsState] = useState<DistanceUnits>("imperial");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(DISTANCE_UNITS_STORAGE_KEY);
      setUnitsState(parseDistanceUnits(stored));
    } catch {
      setUnitsState("imperial");
    }
  }, []);

  const setUnits = useCallback((next: DistanceUnits) => {
    setUnitsState(next);
    try {
      localStorage.setItem(DISTANCE_UNITS_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  return { units, setUnits };
}
