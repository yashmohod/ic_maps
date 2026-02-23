"use client";

import React, { Dispatch, JSX, SetStateAction } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"

import type { BuildingRow } from "@/app/destination-editor/page";

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
      className="
        flex flex-col absolute
        z-10
        top-17 left-3
        bg-panel text-panel-foreground
        border border-border backdrop-blur
        px-3 py-2 rounded-xl shadow
        items-start gap-2
      "
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
          onChange={(e) => { setCurrentBuilding((prev) => { return { ...prev, name: e.target.value ?? "" } }) }}
        />
        <Button type="button" onClick={submitName}>
          Submit
        </Button>
      </div>
      <div>
        <FieldGroup className="mx-auto w-56">
          <Field orientation="horizontal">
            <Checkbox id="terms-checkbox-basic" name="terms-checkbox-basic" checked={currentBuilding.isParkingLot} onCheckedChange={(e) => {
              onChangeIsParkingLot(Boolean(e));
              setCurrentBuilding((prev) => { return { ...prev, isParkingLot: Boolean(e) } });
            }} />
            <FieldLabel htmlFor="terms-checkbox-basic">
              Is Parking Lot
            </FieldLabel>
          </Field>
        </FieldGroup>
      </div>
    </div>
  );
}

export default React.memo(EditPanel);
