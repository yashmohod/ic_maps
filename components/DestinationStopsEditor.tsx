"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  GripVertical,
  Plus,
  Star,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  borderMutedClass,
  safeAreaBottomClass,
  surfacePanelClass,
  surfaceSubtleClass,
  touchTargetClass,
} from "@/lib/panel-classes";
import { formatRouteDuration } from "@/lib/distance-display";

type DestinationLite = { id: number; name: string };
type FavoriteLite = { id: number; name: string };
type LegEtaLite = {
  destinationId: number;
  durationSeconds: number;
  distanceMeters: number;
};

export type DestinationStopsEditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations: DestinationLite[];
  favorites: FavoriteLite[];
  stops: number[];
  onStopsChange: (stops: number[]) => void;
  onPickDestination: (id: number, stopIndex: number) => void;
  onDone: () => void;
  canFavoriteTrip?: boolean;
  tripNameInput?: string;
  onTripNameChange?: (value: string) => void;
  onSaveFavoriteTrip?: () => void;
  showFavoriteTripPanel?: boolean;
  onToggleFavoriteTrip?: () => void;
  legEtas?: LegEtaLite[];
};

function StopTimelineIcon({
  index,
  total,
  isAddRow,
}: {
  index: number;
  total: number;
  isAddRow?: boolean;
}) {
  if (isAddRow) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-panel-muted-foreground text-panel-muted-foreground">
        <Plus size={12} strokeWidth={2.5} aria-hidden="true" />
      </span>
    );
  }
  if (index === 0) {
    return (
      <Circle
        size={18}
        className="shrink-0 text-panel-foreground"
        strokeWidth={2}
        aria-hidden="true"
      />
    );
  }
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border-2 border-panel-foreground text-[10px] font-bold leading-none">
      {index + 1}
    </span>
  );
}

export function DestinationStopsEditor({
  open,
  onOpenChange,
  destinations,
  favorites,
  stops,
  onStopsChange,
  onPickDestination,
  onDone,
  canFavoriteTrip = false,
  tripNameInput = "",
  onTripNameChange,
  onSaveFavoriteTrip,
  showFavoriteTripPanel = false,
  onToggleFavoriteTrip,
  legEtas,
}: DestinationStopsEditorProps) {
  const [editingStopIndex, setEditingStopIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);

  const destinationById = useMemo(() => {
    const map = new Map<number, DestinationLite>();
    for (const d of destinations) map.set(Number(d.id), d);
    return map;
  }, [destinations]);

  const favoriteIdSet = useMemo(
    () => new Set(favorites.map((f) => f.id)),
    [favorites],
  );

  const legEtaByDestId = useMemo(() => {
    const map = new Map<number, LegEtaLite>();
    for (const leg of legEtas ?? []) {
      map.set(leg.destinationId, leg);
    }
    return map;
  }, [legEtas]);

  const filteredDestinations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return destinations;
    return destinations.filter((d) => d.name.toLowerCase().includes(q));
  }, [destinations, searchQuery]);

  const filledStops = stops.filter((id) => id > 0);
  const canDone = filledStops.length >= 1;

  function openSearchForIndex(index: number) {
    setEditingStopIndex(index);
    setSearchQuery("");
  }

  function closeSearch() {
    setEditingStopIndex(null);
    setSearchQuery("");
  }

  function assignStop(destId: number) {
    if (editingStopIndex == null) return;
    const next = [...stops];
    if (editingStopIndex < next.length) {
      next[editingStopIndex] = destId;
    } else {
      next.push(destId);
    }
    onStopsChange(next.filter((id) => id > 0));
    onPickDestination(destId, editingStopIndex);
    closeSearch();
  }

  function removeStop(index: number) {
    const next = stops.filter((_, i) => i !== index);
    onStopsChange(next);
    if (editingStopIndex === index) closeSearch();
  }

  function moveStop(from: number, to: number) {
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= stops.length ||
      to >= stops.length
    ) {
      return;
    }
    const next = [...stops];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onStopsChange(next);
  }

  function handleDone() {
    if (!canDone) return;
    onDone();
    onOpenChange(false);
    closeSearch();
  }

  if (!open) return null;

  const isSearchMode = editingStopIndex != null;

  return (
    <div
      className={[
        "fixed inset-x-0 bottom-0 z-40 flex max-h-[min(88dvh,720px)] flex-col",
        "md:left-1/2 md:w-[720px] md:-translate-x-1/2",
        "rounded-t-[22px] border-t shadow-2xl backdrop-blur",
        surfacePanelClass,
        borderMutedClass,
        safeAreaBottomClass,
      ].join(" ")}
      role="dialog"
      aria-label={isSearchMode ? "Add a stop" : "Add stops"}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        {isSearchMode ? (
          <button
            type="button"
            onClick={closeSearch}
            aria-label="Back to stops list"
            className={`rounded-full p-2 transition hover:bg-panel-muted ${touchTargetClass}`}
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
        ) : (
          <span className="w-10 shrink-0" aria-hidden="true" />
        )}
        <h2 className="flex-1 text-center text-base font-semibold">
          {isSearchMode ? "Add a stop" : "Add stops"}
        </h2>
        {isSearchMode ? (
          <span className="w-10 shrink-0" aria-hidden="true" />
        ) : (
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close stops editor"
            className={`rounded-full p-2 transition hover:bg-panel-muted ${touchTargetClass}`}
          >
            <X size={20} aria-hidden="true" />
          </button>
        )}
      </div>

      {isSearchMode ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-4 pt-3">
            <div
              className={[
                "flex items-center gap-2 rounded-full border px-4 py-2.5",
                borderMutedClass,
                surfaceSubtleClass,
              ].join(" ")}
            >
              <Circle
                size={16}
                className="shrink-0 text-panel-muted-foreground"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Where to?"
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-panel-muted-foreground"
                aria-label="Search campus buildings"
              />
            </div>
          </div>

          {favorites.length > 0 && !searchQuery.trim() ? (
            <div className="shrink-0 px-4 pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-panel-muted-foreground">
                Favorites
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {favorites.map((fav) => (
                  <button
                    key={fav.id}
                    type="button"
                    onClick={() => assignStop(fav.id)}
                    className={[
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-medium",
                      borderMutedClass,
                      "bg-panel-muted hover:bg-panel",
                    ].join(" ")}
                  >
                    <Star
                      size={14}
                      className="text-brand-cta"
                      aria-hidden="true"
                    />
                    {fav.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {filteredDestinations.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-panel-muted-foreground">
                No buildings match your search.
              </li>
            ) : (
              filteredDestinations.map((dest) => {
                const isFav = favoriteIdSet.has(Number(dest.id));
                return (
                  <li key={dest.id}>
                    <button
                      type="button"
                      onClick={() => assignStop(Number(dest.id))}
                      className={[
                        "flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-panel-muted",
                        touchTargetClass,
                      ].join(" ")}
                    >
                      <span className="mt-0.5 text-panel-muted-foreground">
                        {isFav ? (
                          <Star
                            size={18}
                            className="text-brand-cta"
                            aria-hidden="true"
                          />
                        ) : (
                          <Clock size={18} aria-hidden="true" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {dest.name}
                        </span>
                        <span className="block text-xs text-panel-muted-foreground">
                          Campus building
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <div
              className={[
                "rounded-2xl border px-3 py-2",
                borderMutedClass,
                surfaceSubtleClass,
              ].join(" ")}
            >
              {stops.map((stopId, index) => {
                const name =
                  destinationById.get(stopId)?.name ?? "Unknown building";
                const legEta = legEtaByDestId.get(stopId);

                return (
                  <div
                    key={`stop-${index}-${stopId}`}
                    className="relative flex items-center gap-3 py-2"
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragFromIndex != null && dragFromIndex !== index) {
                        moveStop(dragFromIndex, index);
                        setDragFromIndex(index);
                      }
                    }}
                  >
                    <div className="relative flex w-6 shrink-0 flex-col items-center self-stretch">
                      <StopTimelineIcon index={index} total={stops.length} />
                      {index < stops.length ? (
                        <span
                          className="mt-1 w-0.5 flex-1 min-h-4 bg-panel-muted-foreground/35"
                          aria-hidden="true"
                        />
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => openSearchForIndex(index)}
                      className={[
                        "min-w-0 flex-1 rounded-xl px-2 py-2 text-left text-sm font-medium transition hover:bg-panel",
                        touchTargetClass,
                      ].join(" ")}
                    >
                      <span className="block truncate">{name}</span>
                      {legEta ? (
                        <span className="mt-0.5 block text-xs font-medium text-brand-cta">
                          ~{formatRouteDuration(legEta.durationSeconds)}
                        </span>
                      ) : null}
                    </button>

                    <div className="flex shrink-0 items-center gap-0.5">
                      <div className="flex flex-col md:hidden">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => moveStop(index, index - 1)}
                          aria-label={`Move stop ${index + 1} up`}
                          className={`rounded p-1 text-panel-muted-foreground disabled:opacity-30 ${touchTargetClass}`}
                        >
                          <ChevronUp size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          disabled={index === stops.length - 1}
                          onClick={() => moveStop(index, index + 1)}
                          aria-label={`Move stop ${index + 1} down`}
                          className={`rounded p-1 text-panel-muted-foreground disabled:opacity-30 ${touchTargetClass}`}
                        >
                          <ChevronDown size={16} aria-hidden="true" />
                        </button>
                      </div>
                      {stops.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => removeStop(index)}
                          aria-label={`Remove stop ${index + 1}`}
                          className={`rounded-lg p-2 text-panel-muted-foreground hover:bg-panel hover:text-foreground ${touchTargetClass}`}
                        >
                          <X size={16} aria-hidden="true" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        draggable
                        onDragStart={() => setDragFromIndex(index)}
                        onDragEnd={() => setDragFromIndex(null)}
                        aria-label={`Reorder stop ${index + 1}`}
                        className={`hidden cursor-grab rounded-lg p-2 text-panel-muted-foreground active:cursor-grabbing md:block ${touchTargetClass}`}
                      >
                        <GripVertical size={18} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className="relative flex items-center gap-3 py-2">
                <div className="flex w-6 shrink-0 justify-center self-start pt-0.5">
                  <StopTimelineIcon
                    index={stops.length}
                    total={stops.length}
                    isAddRow
                  />
                </div>
                <button
                  type="button"
                  onClick={() => openSearchForIndex(stops.length)}
                  className={[
                    "min-w-0 flex-1 rounded-xl px-2 py-2 text-left text-sm text-panel-muted-foreground transition hover:bg-panel",
                    touchTargetClass,
                  ].join(" ")}
                >
                  Add a stop
                </button>
                <span className="w-[72px] shrink-0" aria-hidden="true" />
              </div>
            </div>

            {canFavoriteTrip && stops.length >= 2 ? (
              <div className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 w-full"
                  onClick={onToggleFavoriteTrip}
                >
                  <Star
                    size={16}
                    className="mr-2 text-brand-cta"
                    aria-hidden="true"
                  />
                  Favorite trip
                </Button>
                {showFavoriteTripPanel ? (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={tripNameInput}
                      onChange={(e) => onTripNameChange?.(e.target.value)}
                      placeholder="Trip name"
                      className={`min-h-11 flex-1 rounded-2xl border px-3 py-2 text-sm ${borderMutedClass}`}
                    />
                    <Button
                      type="button"
                      className="min-h-11 bg-brand-cta text-brand-cta-foreground"
                      onClick={onSaveFavoriteTrip}
                    >
                      Save
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-border px-4 py-3">
            <Button
              type="button"
              disabled={!canDone}
              onClick={handleDone}
              className={[
                "min-h-12 w-full rounded-2xl text-base font-semibold",
                canDone
                  ? "bg-brand-cta text-brand-cta-foreground hover:bg-brand-cta/90"
                  : "bg-panel-muted text-panel-muted-foreground",
              ].join(" ")}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
