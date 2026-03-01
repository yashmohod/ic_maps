"use client";

import { useMemo, useState } from "react";
import toast, { Toaster } from "react-hot-toast";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { addNavMode, editNavMode, deleteNavMode } from "../lib/icmapsApi";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

type NavMode = {
  id: string | number;
  name: string;
  fromThrough: boolean;
};

type Props = {
  navModes: NavMode[];
  getNavModes: () => void | Promise<void>;
};

export default function NavModes({ navModes, getNavModes }: Props) {
  const [currentName, setCurrentName] = useState<string>("");
  const [curFromThrough, setCurFromThrough] = useState<boolean>(false);

  const [curEditId, setCurEditId] = useState<string | number | null>(null);
  const [curEditName, setCurEditName] = useState<string>("");
  const [curEditFromThrough, setCurEditFromThrough] = useState<boolean>(false);
  const [open, setOpen] = useState<boolean>(false);

  const normalizedNames = useMemo(() => {
    return new Set(navModes.map((m) => m.name.trim()));
  }, [navModes]);

  async function deleteNavModeHandler(id: string | number) {
    const resp: any = await deleteNavMode(id.toString());

    if (resp?.status === 200) {
      toast.success("NavMode deleted!");
      await getNavModes();
    } else {
      toast.error(resp?.message ?? "Failed to delete NavMode.");
    }
  }

  async function editNavModeHandler() {
    if (curEditId == null) return;

    const trimmed = curEditName.trimEnd();
    if (!trimmed) return toast.error("Name cannot be empty.");

    const existing = navModes.find((m) => String(m.id) === String(curEditId));
    if (!existing) return toast.error("Unknown NavMode.");

    // prevent duplicates (except renaming to same name)
    if (trimmed !== existing.name.trim() && normalizedNames.has(trimmed)) {
      return toast.error("Can't have duplicate names!");
    }

    const resp: any = await editNavMode(
      curEditId.toString(),
      trimmed,
      curEditFromThrough
    );
    if (resp?.status === 200) {
      toast.success("NavMode name updated!");
      setCurEditId(null);
      setCurEditName("");
      setOpen(false);
      await getNavModes();
    } else {
      toast.error(resp?.message ?? "Failed to update NavMode.");
    }
  }

  async function addNavModeHandler() {
    const trimmed = currentName.trimEnd();
    if (!trimmed) return toast.error("Name cannot be empty.");

    if (normalizedNames.has(trimmed)) {
      return toast.error("Can't have duplicate names!");
    }

    const resp: any = await addNavMode(trimmed, curFromThrough);
    if (resp?.status === 200) {
      setCurrentName("");
      await getNavModes();
      toast.success("NavMode added!");
    } else {
      toast.error(
        resp?.data?.message ?? resp?.message ?? "Failed to add NavMode."
      );
    }
  }

  return (
    <>
      <Toaster position="top-right" reverseOrder />

      {/* Add row */}
      <div className="w-full">
        <div className="flex gap-2">
          <Input
            placeholder="NavMode Name"
            value={currentName}
            onChange={(e) => setCurrentName(e.target.value)}
          />

          <Button
            type="button"
            className="shrink-0"
            onClick={addNavModeHandler}
          >
            Add
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="w-full ">
        <div className="rounded-lg border bg-background">
          {navModes.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No navigation modes.
            </div>
          ) : (
            <ul className="divide-y">
              {navModes.map((m) => (
                <li
                  key={String(m.id)}
                  className="flex items-center justify-between gap-3 p-3"
                >
                  <span className="text-sm font-medium">{m.name}</span>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="default"
                      className="bg-green-800"
                      onClick={() => {
                        setCurEditId(m.id);
                        setCurEditName(m.name);
                        setCurEditFromThrough(m.fromThrough);
                        setOpen(true);
                      }}
                    >
                      Edit
                    </Button>

                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => deleteNavModeHandler(m.id)}
                      aria-label={`delete-${m.id}`}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Name</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              placeholder="NavMode Name"
              value={curEditName}
              onChange={(e) => setCurEditName(e.target.value)}
            />
            <div className="flex items-center space-x-2">
              <Switch
                id="airplane-mode"
                checked={curEditFromThrough}
                onCheckedChange={(checked) => setCurEditFromThrough(checked)}
              />
              <Label htmlFor="airplane-mode" className="w-30">
                Through building routing
              </Label>
            </div>
            <Button type="button" onClick={editNavModeHandler}>
              Submit
            </Button>
          </div>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
