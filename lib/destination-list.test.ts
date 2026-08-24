import { describe, expect, it } from "vitest";
import { mapDestinationRow } from "@/lib/destination-list";

const row = {
  id: 7,
  name: "Park Hall",
  lat: 42.42,
  lng: -76.49,
  is_parking_lot: false,
  open_time: "08:00:00",
  close_time: "22:00:00",
  polygon: '{"type":"FeatureCollection","features":[]}',
};

describe("mapDestinationRow", () => {
  it("omits polygon on the light list", () => {
    const dest = mapDestinationRow(row, false);
    expect(dest).toEqual({
      id: 7,
      name: "Park Hall",
      lat: 42.42,
      lng: -76.49,
      isParkingLot: false,
      openTime: "08:00:00",
      closeTime: "22:00:00",
    });
    expect("polygon" in dest).toBe(false);
  });

  it("includes polygon when requested", () => {
    expect(mapDestinationRow(row, true).polygon).toBe(row.polygon);
  });
});
