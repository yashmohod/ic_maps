"use client";

import { Button } from "@/components/ui/button";
import {
  formatDistanceAhead,
  type DistanceUnits,
} from "@/lib/distance-display";
import type { NavStep } from "@/lib/navigation-types";
import { cn } from "@/lib/utils";
import { Check, ChevronRight, MapPin } from "lucide-react";

export type NavigationStepsPanelProps = {
  steps: NavStep[];
  currentStepIndex: number;
  distanceToNextMeters: number | null;
  units: DistanceUnits;
  tracking?: boolean;
  onAdvance?: () => void;
  className?: string;
  /** Hide the large live banner (shown in map toolbar instead). */
  hideLiveBanner?: boolean;
};

export function NavigationStepsPanel({
  steps,
  currentStepIndex,
  distanceToNextMeters,
  units,
  tracking = false,
  onAdvance,
  className,
  hideLiveBanner = false,
}: NavigationStepsPanelProps) {
  if (steps.length === 0) return null;

  const current = steps[currentStepIndex];
  const next = steps[currentStepIndex + 1];

  return (
    <div className={cn("space-y-3", className)}>
      {tracking && current && !hideLiveBanner ? (
        <div className="rounded-xl border border-border bg-panel-muted/80 px-3 py-3">
          {current.kind === "outdoor" && distanceToNextMeters != null ? (
            <p className="text-lg font-semibold text-brand-cta">
              {formatDistanceAhead(distanceToNextMeters, units)}
            </p>
          ) : null}
          <p className="mt-1 text-sm font-medium text-panel-foreground">
            {current.instruction}
          </p>
          {next ? (
            <p className="mt-2 text-xs text-panel-muted-foreground">
              Then: {next.instruction}
            </p>
          ) : null}
          {current.kind === "indoor" && onAdvance ? (
            <Button
              type="button"
              size="sm"
              className="mt-3 bg-brand-cta text-brand-cta-foreground"
              onClick={onAdvance}
            >
              Done — next step
            </Button>
          ) : null}
        </div>
      ) : null}

      <ol className="max-h-48 space-y-1.5 overflow-y-auto pr-1 text-sm">
        {steps.map((step, idx) => {
          const isCurrent = idx === currentStepIndex;
          const isPast = idx < currentStepIndex;
          const isIndoor = step.kind === "indoor";
          return (
            <li
              key={`${step.kind}-${idx}-${step.instruction}`}
              className={cn(
                "flex items-start gap-2 rounded-lg px-2 py-1.5",
                isCurrent && "bg-brand-cta/15 ring-1 ring-brand-cta/30",
                isPast && "opacity-60",
              )}
            >
              <span className="mt-0.5 shrink-0 text-panel-muted-foreground">
                {isPast ? (
                  <Check className="size-4 text-brand-cta" aria-hidden />
                ) : isIndoor ? (
                  <MapPin className="size-4" aria-hidden />
                ) : (
                  <ChevronRight className="size-4" aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-snug">{step.instruction}</p>
                {step.kind === "outdoor" &&
                step.distanceMeters > 0 &&
                !isPast ? (
                  <p className="text-xs text-panel-muted-foreground">
                    {formatDistanceAhead(step.distanceMeters, units)}
                  </p>
                ) : null}
                {isIndoor ? (
                  <p className="text-xs text-panel-muted-foreground">
                    Inside {step.buildingName}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
