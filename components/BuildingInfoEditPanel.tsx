"use client";

import React, { JSX } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type CurrentBuilding = {
  id?: string | number;
  name?: string;
  lat?: number;
  lng?: number;
};

type Props = {
  curEditName: string;
  currentBuilding: CurrentBuilding;
  setcurEditName: (v: string) => void;
  submitName: () => void;
};

function EditPanel({
  curEditName,
  currentBuilding,
  setcurEditName,
  submitName,
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
          value={curEditName}
          onChange={(e) => setcurEditName(e.target.value)}
        />
        <Button type="button" onClick={submitName}>
          Submit
        </Button>
      </div>
    </div>
  );
}

export default React.memo(EditPanel);
