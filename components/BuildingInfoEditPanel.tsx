"use client";

import React, { Dispatch, JSX, SetStateAction } from "react";
import Link from "next/link";
import { Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";

import { mapBottomSheetClass, touchTargetClass } from "@/lib/panel-classes";

export type BuildingRow = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  polygon: string; // JSON string of a GeoJSON Feature
  isParkingLot: boolean;
  navigatableDestination: boolean;
  openTime: string;
  closeTime: string;
  /** Recommended parking lot ids (buildings only). */
  parkingLotIds: number[];
};

export type DestinationEditorMode = "shapes" | "recommended_parking";

type Props = {
  editorMode: DestinationEditorMode;
  currentBuilding: BuildingRow;
  setCurrentBuilding: Dispatch<SetStateAction<BuildingRow>>;
  submitName: () => void;
  onChangeIsParkingLot: (v: boolean) => void;
  onChangeNavigatableDestination: (v: boolean) => void;
  onDeleteBuilding: () => void;
  onEditPolygon?: () => void;
  /** Names of recommended parking lots for the panel list. */
  recommendedParkingNames?: Array<{ id: number; name: string }>;
  onRemoveRecommendedParking?: (parkingLotId: number) => void;
};

function EditPanel({
  editorMode,
  currentBuilding,
  setCurrentBuilding,
  submitName,
  onChangeIsParkingLot,
  onChangeNavigatableDestination,
  onDeleteBuilding,
  onEditPolygon,
  recommendedParkingNames = [],
  onRemoveRecommendedParking,
}: Props): JSX.Element {
  const isShapes = editorMode === "shapes";
  const isRecommended = editorMode === "recommended_parking";
  const hasSelection = currentBuilding.id >= 0;
  const isBuilding = hasSelection && !currentBuilding.isParkingLot;

  return (
    <div
      className={`
        fixed inset-x-0 bottom-0 z-20 flex max-h-[45vh] w-full flex-col gap-2 overflow-y-auto
        ${mapBottomSheetClass} px-4 py-3
        md:absolute md:inset-x-auto md:bottom-auto md:top-17 md:left-3 md:max-h-none md:w-auto
        md:rounded-xl md:border md:px-3 md:py-2 md:shadow md:pb-3
        items-start
      `}
    >
      <span className="text-sm font-medium">
        {isRecommended
          ? "Recommended parking"
          : currentBuilding.isParkingLot
            ? "Current Parking Lot:"
            : "Current Building:"}
      </span>

      {isRecommended ? (
        <p className="text-xs text-muted-foreground leading-5">
          {isBuilding
            ? "Click parking lots on the map to add or remove them for this building."
            : "Click a building first, then click parking lots to link them."}
        </p>
      ) : null}

      <p className="text-sm leading-5">
        {hasSelection ? (
          <>
            <span className="font-medium">{currentBuilding.name || "Unnamed"}</span>
            <br />
            lat: {currentBuilding.lat ?? "—"}
            <br />
            lng: {currentBuilding.lng ?? "—"}
          </>
        ) : (
          <span className="text-muted-foreground">Nothing selected</span>
        )}
      </p>

      {isShapes && (
        <>
          <div className="flex w-full items-center gap-2">
            <Input
              placeholder={
                currentBuilding.isParkingLot
                  ? "Parking Lot Name"
                  : "Building Name"
              }
              value={currentBuilding.name ?? ""}
              onChange={(e) => {
                setCurrentBuilding((prev) => {
                  return { ...prev, name: e.target.value ?? "" };
                });
              }}
            />
            <Button
              type="button"
              className={touchTargetClass}
              onClick={submitName}
            >
              Submit
            </Button>
          </div>

          {hasSelection && (
            <>
              <Button
                type="button"
                variant="outline"
                className={`w-full ${touchTargetClass}`}
                onClick={onEditPolygon}
              >
                Edit polygon shape
              </Button>
              <p className="text-xs text-muted-foreground">
                Or double-click the polygon on the map, then drag vertices.
              </p>
            </>
          )}

          {hasSelection && (
            <Button
              type="button"
              variant="destructive"
              className={`w-full ${touchTargetClass}`}
              onClick={onDeleteBuilding}
            >
              Delete destination
            </Button>
          )}

          {isBuilding && (
            <Button
              asChild
              type="button"
              variant="outline"
              className={`w-full gap-2 ${touchTargetClass}`}
            >
              <Link
                href={`/destination-editor/floorplan?destinationId=${currentBuilding.id}&from=destination-editor`}
              >
                <Layers size={16} aria-hidden="true" />
                Edit floor plan
              </Link>
            </Button>
          )}

          <div>
            <FieldGroup className="mx-auto w-56">
              <Field orientation="horizontal">
                <Checkbox
                  id="is-parking-lot-checkbox"
                  name="is-parking-lot-checkbox"
                  checked={currentBuilding.isParkingLot}
                  disabled={!hasSelection}
                  onCheckedChange={(e) => {
                    onChangeIsParkingLot(Boolean(e));
                    setCurrentBuilding((prev) => {
                      return { ...prev, isParkingLot: Boolean(e) };
                    });
                  }}
                />
                <FieldLabel htmlFor="is-parking-lot-checkbox">
                  Is Parking Lot
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="navigatable-destination-checkbox"
                  name="navigatable-destination-checkbox"
                  checked={currentBuilding.navigatableDestination}
                  disabled={!hasSelection}
                  onCheckedChange={(e) => {
                    onChangeNavigatableDestination(Boolean(e));
                    setCurrentBuilding((prev) => ({
                      ...prev,
                      navigatableDestination: Boolean(e),
                    }));
                  }}
                />
                <FieldLabel htmlFor="navigatable-destination-checkbox">
                  Navigatable destination
                </FieldLabel>
              </Field>
            </FieldGroup>
          </div>

          {isBuilding && (
            <div className="flex w-full flex-col gap-2">
              <div className="grid grid-cols-[auto_1fr] items-center gap-2">
                <FieldLabel className="text-sm shrink-0">Open</FieldLabel>
                <Input
                  type="time"
                  value={(currentBuilding.openTime ?? "00:00:00").slice(0, 5)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCurrentBuilding((prev) => ({
                      ...prev,
                      openTime: v ? `${v}:00` : "00:00:00",
                    }));
                  }}
                />
              </div>
              <div className="grid grid-cols-[auto_1fr] items-center gap-2">
                <FieldLabel className="text-sm shrink-0">Close</FieldLabel>
                <Input
                  type="time"
                  value={(currentBuilding.closeTime ?? "23:59:59").slice(0, 5)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCurrentBuilding((prev) => ({
                      ...prev,
                      closeTime: v ? `${v}:00` : "23:59:59",
                    }));
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}

      {isRecommended && (
        <div className="w-full border-t border-border pt-2">
          {!isBuilding ? (
            <p className="text-xs text-muted-foreground">
              Select a building (not a parking lot) to manage its recommended
              lots.
            </p>
          ) : recommendedParkingNames.length === 0 ? (
            <p className="text-xs text-muted-foreground">None selected yet</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {recommendedParkingNames.map((lot) => (
                <li
                  key={lot.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="truncate">
                    {lot.name || `Lot #${lot.id}`}
                  </span>
                  {onRemoveRecommendedParking ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2"
                      onClick={() => onRemoveRecommendedParking(lot.id)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(EditPanel);
