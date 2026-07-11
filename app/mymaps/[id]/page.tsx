"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { mapPageClass } from "@/lib/panel-classes";

/** Legacy editor URL — redirect into the combined workspace. */
export default function MyMapEditorRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const rawId = params?.id;
  const mapId =
    typeof rawId === "string" &&
    Number.isInteger(Number(rawId)) &&
    Number(rawId) > 0
      ? Number(rawId)
      : null;

  useEffect(() => {
    router.replace(mapId ? `/mymaps?mapId=${mapId}` : "/mymaps");
  }, [mapId, router]);

  return (
    <div className={`${mapPageClass} grid place-items-center`}>
      <Spinner className="size-8" />
    </div>
  );
}
