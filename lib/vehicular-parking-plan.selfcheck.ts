import { expandVehicularLegs } from "@/lib/vehicular-parking-plan";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function selfCheck() {
  const isLot = (id: number) => id >= 100;
  const recommended = (buildingId: number): number[] => {
    if (buildingId === 1) return [100, 101];
    if (buildingId === 2) return [100];
    if (buildingId === 3) return [102];
    return [];
  };
  const pickFirst = (_b: number, c: number[]) => c[0]!;

  const shared = expandVehicularLegs([1, 2], isLot, recommended, pickFirst);
  assert(shared.length === 3, "shared: drive lot + walk + walk");
  assert(shared[0]?.kind === "parking" && shared[0].mode === "vehicular", "drive lot");
  assert(shared[1]?.destinationId === 1 && shared[1].mode === "pedestrian", "walk b1");
  assert(shared[2]?.destinationId === 2 && shared[2].mode === "pedestrian", "walk b2");

  const noShare = expandVehicularLegs([1, 3], isLot, recommended, pickFirst);
  assert(noShare.length === 4, "noShare: two park+walk pairs");
  assert(noShare[2]?.kind === "parking", "second drive to lot");
  assert(noShare[2]?.destinationId === 102, "lot 102");

  const fallback = expandVehicularLegs([4], isLot, () => [], pickFirst);
  assert(
    fallback.length === 1 &&
      fallback[0]?.mode === "vehicular" &&
      fallback[0].kind === "building",
    "no lots → direct drive",
  );

  console.log("vehicular-parking-plan self-check ok");
}

selfCheck();
