"use client";

import { Marker } from "@vis.gl/react-maplibre";

export type TripStopMarker = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  order: number;
};

type TripStopMarkersProps = {
  stops: TripStopMarker[];
};

export function TripStopMarkers({ stops }: TripStopMarkersProps) {
  if (stops.length === 0) return null;

  return (
    <>
      {stops.map((stop) => (
        <Marker
          key={`trip-stop-${stop.id}-${stop.order}`}
          longitude={stop.lng}
          latitude={stop.lat}
          anchor="center"
        >
          <div
            title={`${stop.order}. ${stop.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-brand-cta text-sm font-bold text-brand-cta-foreground shadow-lg ring-2 ring-brand-cta/40"
            aria-label={`Stop ${stop.order}: ${stop.name}`}
          >
            {stop.order}
          </div>
        </Marker>
      ))}
    </>
  );
}
