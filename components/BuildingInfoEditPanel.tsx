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
  openTime: string;
  closeTime: string;
};

type Props = {
  currentBuilding: BuildingRow;
  setCurrentBuilding: Dispatch<SetStateAction<BuildingRow>>;
  submitName: () => void;
  onChangeIsParkingLot: (v: boolean) => void;
};

function EditPanel({
  currentBuilding,
  setCurrentBuilding,
  submitName,
  onChangeIsParkingLot,
}: Props): JSX.Element {
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
      <span className="text-sm font-medium">Current Building:</span>

      <p className="text-sm leading-5">
        lat: {currentBuilding.lat ?? "—"}
        <br />
        lng: {currentBuilding.lng ?? "—"}
      </p>

      <div className="flex w-full items-center gap-2">
        <Input
          placeholder="Building Name"
          value={currentBuilding.name ?? ""}
          onChange={(e) => {
            setCurrentBuilding((prev) => {
              return { ...prev, name: e.target.value ?? "" };
            });
          }}
        />
        <Button type="button" className={touchTargetClass} onClick={submitName}>
          Submit
        </Button>
      </div>

      {currentBuilding.id >= 0 && (
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
              id="terms-checkbox-basic"
              name="terms-checkbox-basic"
              checked={currentBuilding.isParkingLot}
              onCheckedChange={(e) => {
                onChangeIsParkingLot(Boolean(e));
                setCurrentBuilding((prev) => {
                  return { ...prev, isParkingLot: Boolean(e) };
                });
              }}
            />
            <FieldLabel htmlFor="terms-checkbox-basic">
              Is Parking Lot
            </FieldLabel>
          </Field>
        </FieldGroup>
      </div>

      {!currentBuilding.isParkingLot && currentBuilding.id >= 0 && (
        <div className="flex flex-col gap-2 w-full">
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
    </div>
  );
}

export default React.memo(EditPanel);
