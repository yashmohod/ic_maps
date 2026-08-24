import { describe, expect, it } from "vitest";
import {
  distanceToPolylineMeters,
  shouldPublishGpsUi,
} from "@/lib/geo";

describe("distanceToPolylineMeters", () => {
  it("is near zero on the segment", () => {
    const line: Array<[number, number]> = [
      [-76.495, 42.421],
      [-76.494, 42.421],
    ];
    expect(distanceToPolylineMeters(-76.4945, 42.421, line)).toBeLessThan(1);
  });

  it("measures roughly 100m north of an east–west segment", () => {
    const line: Array<[number, number]> = [
      [-76.495, 42.421],
      [-76.494, 42.421],
    ];
    const off = distanceToPolylineMeters(-76.4945, 42.4219, line);
    expect(off).toBeGreaterThan(80);
    expect(off).toBeLessThan(120);
  });
});

describe("shouldPublishGpsUi", () => {
  it("publishes the first sample and then respects the interval", () => {
    expect(shouldPublishGpsUi(0, 10)).toBe(true);
    expect(shouldPublishGpsUi(1000, 1200)).toBe(false);
    expect(shouldPublishGpsUi(1000, 1500)).toBe(true);
  });
});
