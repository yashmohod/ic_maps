import { describe, expect, it } from "vitest";
import {
  isHexColor,
  MYMAPS_DEFAULT_COLOR,
  normalizeHexColor,
} from "@/lib/mymaps-color";

describe("isHexColor", () => {
  it("accepts #RRGGBB", () => {
    expect(isHexColor("#35D5A4")).toBe(true);
    expect(isHexColor("#003c71")).toBe(true);
  });

  it("rejects short or invalid", () => {
    expect(isHexColor("#fff")).toBe(false);
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });
});

describe("normalizeHexColor", () => {
  it("returns valid colors and defaults otherwise", () => {
    expect(normalizeHexColor("#dc2626")).toBe("#dc2626");
    expect(normalizeHexColor("nope")).toBe(MYMAPS_DEFAULT_COLOR);
    expect(normalizeHexColor("35D5A4")).toBe("#35D5A4");
  });
});
