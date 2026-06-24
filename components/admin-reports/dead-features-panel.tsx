"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import apiClient from "@/lib/apiClient";
import type { DeadFeatureLists } from "@/lib/dead-features";
import { cn } from "@/lib/utils";

type DeadFeaturesPanelProps = {
  className?: string;
  refreshKey?: number;
  onListsChange?: (lists: DeadFeatureLists) => void;
};

export function DeadFeaturesPanel({
  className,
  refreshKey = 0,
  onListsChange,
}: DeadFeaturesPanelProps) {
  const [lists, setLists] = useState<DeadFeatureLists>({
    outsideIds: [],
    insideIds: [],
  });
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadLists = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await apiClient.get("/api/map/dead-feature");
      if (!resp.ok) throw new Error("Failed to load dead features");
      const payload = (await resp.json()) as DeadFeatureLists;
      setLists(payload);
      onListsChange?.(payload);
    } catch {
      toast.error("Could not load dead feature lists");
    } finally {
      setLoading(false);
    }
  }, [onListsChange]);

  useEffect(() => {
    void loadLists();
  }, [loadLists, refreshKey]);

  const toggleDead = async (scope: "outside" | "inside", id: number) => {
    const key = `${scope}:${id}`;
    setUpdatingId(key);
    try {
      const resp = await apiClient.post("/api/map/dead-feature", {
        scope,
        id,
        value: false,
      });
      if (!resp.ok) throw new Error("Update failed");
      const payload = (await resp.json()) as DeadFeatureLists;
      setLists(payload);
      onListsChange?.(payload);
    } catch {
      toast.error("Could not remove dead feature");
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) {
    return (
      <div className={cn("flex justify-center py-6", className)}>
        <Spinner className="text-brand-cta" />
      </div>
    );
  }

  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
      <div className="border-border rounded-xl border p-3">
        <h3 className="mb-2 text-sm font-semibold">Dead outside nodes</h3>
        {lists.outsideIds.length === 0 ? (
          <p className="text-muted-foreground text-xs">None marked dead.</p>
        ) : (
          <ul className="space-y-2">
            {lists.outsideIds.map((id) => {
              const key = `outside:${id}`;
              return (
                <li
                  key={key}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="font-mono text-xs">#{id}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={updatingId === key}
                    onClick={() => void toggleDead("outside", id)}
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-border rounded-xl border p-3">
        <h3 className="mb-2 text-sm font-semibold">Dead inside nodes</h3>
        {lists.insideIds.length === 0 ? (
          <p className="text-muted-foreground text-xs">None marked dead.</p>
        ) : (
          <ul className="space-y-2">
            {lists.insideIds.map((id) => {
              const key = `inside:${id}`;
              return (
                <li
                  key={key}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="font-mono text-xs">#{id}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={updatingId === key}
                    onClick={() => void toggleDead("inside", id)}
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function routeReportDeadTarget(
  report: {
    featureType: string | null;
    nodeOutsideId: number | null;
    nodeInsideId: number | null;
  },
  isIndoor: (featureType: string | null) => boolean,
): { scope: "outside" | "inside"; id: number } | null {
  if (isIndoor(report.featureType) && report.nodeInsideId != null) {
    return { scope: "inside", id: report.nodeInsideId };
  }
  if (report.nodeOutsideId != null) {
    return { scope: "outside", id: report.nodeOutsideId };
  }
  return null;
}

export async function markRouteReportFeatureDead(
  target: { scope: "outside" | "inside"; id: number },
  value = true,
): Promise<DeadFeatureLists | null> {
  const resp = await apiClient.post("/api/map/dead-feature", {
    scope: target.scope,
    id: target.id,
    value,
  });
  if (!resp.ok) return null;
  return (await resp.json()) as DeadFeatureLists;
}
