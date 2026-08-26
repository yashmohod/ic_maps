import { describe, expect, it } from "vitest";
import {
  clampArrowSize,
  clampNodeSize,
  MYMAPS_ARROW_SIZE_DEFAULT,
  MYMAPS_NODE_SIZE_DEFAULT,
  normArrowBearing,
} from "@/lib/mymaps-size";

describe("mymaps-size", () => {
  it("clamps node size to the allowed range", () => {
    expect(clampNodeSize(Number.NaN)).toBe(MYMAPS_NODE_SIZE_DEFAULT);
    expect(clampNodeSize(2)).toBe(8);
    expect(clampNodeSize(14)).toBe(14);
    expect(clampNodeSize(99)).toBe(40);
  });

  it("clamps arrow size and normalizes bearing", () => {
    expect(clampArrowSize(Number.NaN)).toBe(MYMAPS_ARROW_SIZE_DEFAULT);
    expect(clampArrowSize(10)).toBe(16);
    expect(clampArrowSize(80)).toBe(64);
    expect(normArrowBearing(-90)).toBe(270);
    expect(normArrowBearing(450)).toBe(90);
  });
});
