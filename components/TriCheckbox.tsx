"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CheckState } from "@/lib/element-visibility";

type Props = {
  state: CheckState;
  onToggle: () => void;
  "aria-label": string;
  className?: string;
};

export function TriCheckbox({
  state,
  onToggle,
  "aria-label": ariaLabel,
  className,
}: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-label={ariaLabel}
      aria-checked={state === "mixed" ? "mixed" : state === "checked"}
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-[4px] border",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_1px_1px_rgba(0,0,0,0.18)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-cta)]/50",
        state === "checked" &&
          "border-[color-mix(in_oklab,var(--brand-cta)_65%,#0f3d32)] bg-[var(--brand-cta)] text-[var(--brand-cta-foreground)]",
        state === "mixed" &&
          "border-[color-mix(in_oklab,var(--brand-cta)_45%,#123d4a)] bg-[color-mix(in_oklab,var(--brand-cta)_35%,#123d4a)]",
        state === "unchecked" && "border-border bg-background",
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {state === "checked" ? (
        <Check size={11} strokeWidth={3.5} aria-hidden />
      ) : null}
      {state === "mixed" ? (
        <span
          className="block h-[2.5px] w-2.5 rounded-full bg-white"
          aria-hidden
        />
      ) : null}
    </button>
  );
}
