"use client";

import { Button } from "@/components/ui/button";
import {
  formatDistanceAhead,
  type DistanceUnits,
} from "@/lib/distance-display";
import type { NavStep } from "@/lib/navigation-types";
import { cn } from "@/lib/utils";

export type NavigationNextTurnBannerProps = {
  steps: NavStep[];
  currentStepIndex: number;
  distanceToNextMeters: number | null;
  units: DistanceUnits;
  tracking?: boolean;
  onAdvance?: () => void;
  className?: string;
};

export function NavigationNextTurnBanner({
  steps,
  currentStepIndex,
  distanceToNextMeters,
  units,
  tracking = false,
  onAdvance,
  className,
}: NavigationNextTurnBannerProps) {
  if (steps.length === 0) return null;

  const current = steps[currentStepIndex];
  const next = steps[currentStepIndex + 1];
  if (!current) return null;

  const distanceLabel = (() => {
    if (current.kind === "indoor") return null;
    if (tracking && distanceToNextMeters != null) {
      return formatDistanceAhead(distanceToNextMeters, units);
    }
    if (current.distanceMeters > 0) {
      return formatDistanceAhead(current.distanceMeters, units);
    }
    if (current.maneuver === "arrive") return "Arriving";
    return null;
  })();

  return (
    <div
      className={cn(
        "pointer-events-auto min-h-11 min-w-0 rounded-2xl border border-border/50 bg-panel/55 px-2.5 py-2 text-center shadow-md backdrop-blur-md",
        className,
      )}
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex min-w-0 flex-col items-center gap-1.5">
        <div className="w-full min-w-0">
          {distanceLabel ? (
            <>
              <p className="text-xs font-semibold leading-snug text-brand-cta">
                {distanceLabel}
              </p>
              <p className="text-xs font-semibold leading-snug text-panel-foreground/95">
                {current.instruction}
              </p>
            </>
          ) : (
            <p className="text-xs font-semibold leading-snug text-panel-foreground/95">
              {current.instruction}
            </p>
          )}
          {next && tracking ? (
            <p className="mt-0.5 text-[10px] leading-snug text-panel-muted-foreground/80">
              Then: {next.instruction}
            </p>
          ) : null}
        </div>
        {current.kind === "indoor" && onAdvance ? (
          <Button
            type="button"
            size="sm"
            className="shrink-0 bg-brand-cta text-brand-cta-foreground"
            onClick={onAdvance}
          >
            Done
          </Button>
        ) : null}
      </div>
    </div>
  );
}
