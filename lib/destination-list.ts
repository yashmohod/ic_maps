export type DestinationListRow = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  isParkingLot: boolean;
  navigatableDestination: boolean;
  openTime: string;
  closeTime: string;
  polygon?: string;
  /** Recommended parking lot destination ids (buildings only). */
  parkingLotIds?: number[];
};

function clock(value: unknown, fallback: string) {
  return value != null ? String(value).slice(0, 8) : fallback;
}

/** Map a destination SQL row. Omit polygon unless the query selected it. */
export function mapDestinationRow(
  row: Record<string, unknown>,
  includePolygon: boolean,
): DestinationListRow {
  const dest: DestinationListRow = {
    id: Number(row.id),
    name: String(row.name ?? ""),
    lat: Number(row.lat),
    lng: Number(row.lng),
    isParkingLot: Boolean(row.is_parking_lot),
    navigatableDestination: Boolean(row.navigatable_destination),
    openTime: clock(row.open_time, "00:00:00"),
    closeTime: clock(row.close_time, "23:59:59"),
  };
  if (includePolygon && "polygon" in row) {
    dest.polygon = row.polygon == null ? "" : String(row.polygon);
  }
  return dest;
}
