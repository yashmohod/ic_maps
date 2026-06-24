import { describe, expect, it } from "vitest";
import {
  classifyTurnDegrees,
  mergeContinueSteps,
  turnDegreesAtNode,
} from "@/lib/navigation-turn";

describe("classifyTurnDegrees", () => {
  it("classifies straight ahead", () => {
    expect(classifyTurnDegrees(5)).toBe("continue");
    expect(classifyTurnDegrees(-10)).toBe("continue");
  });

  it("classifies left and right turns", () => {
    expect(classifyTurnDegrees(-45)).toBe("turn-left");
    expect(classifyTurnDegrees(45)).toBe("turn-right");
  });

  it("classifies sharp turns and u-turn", () => {
    expect(classifyTurnDegrees(-90)).toBe("sharp-left");
    expect(classifyTurnDegrees(170)).toBe("uturn");
  });
});

describe("turnDegreesAtNode", () => {
  it("detects a right turn on a simple L-shaped path", () => {
    const turn = turnDegreesAtNode(
      -76.49,
      42.42,
      -76.49,
      42.421,
      -76.489,
      42.421,
    );
    expect(turn).toBeGreaterThan(80);
    expect(turn).toBeLessThan(100);
  });
});

describe("mergeContinueSteps", () => {
  it("merges consecutive short continue segments", () => {
    const merged = mergeContinueSteps([
      { maneuver: "continue", distanceMeters: 10 },
      { maneuver: "continue", distanceMeters: 8 },
      { maneuver: "turn-left", distanceMeters: 30 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.distanceMeters).toBe(18);
    expect(merged[1]!.maneuver).toBe("turn-left");
  });

  it("does not merge when continue segment exceeds threshold", () => {
    const merged = mergeContinueSteps([
      { maneuver: "continue", distanceMeters: 30 },
      { maneuver: "continue", distanceMeters: 30 },
    ]);
    expect(merged).toHaveLength(2);
  });
});
