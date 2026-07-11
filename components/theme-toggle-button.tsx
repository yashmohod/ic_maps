"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { useAppTheme } from "@/hooks/use-app-theme";

type Props = {
  className?: string;
};

export function ThemeToggleButton({ className = "" }: Props) {
  const { isDark, toggleTheme } = useAppTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const label = !mounted
    ? "Toggle theme"
    : isDark
      ? "Switch to light mode"
      : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={mounted ? toggleTheme : undefined}
      aria-label={label}
      title={label}
      suppressHydrationWarning
      disabled={!mounted}
      className={[
        "inline-flex items-center justify-center rounded-2xl border border-border bg-panel text-panel-foreground shadow-lg transition hover:bg-panel-muted focus:outline-none focus:ring-2 focus:ring-brand-cta/30",
        className,
      ].join(" ")}
    >
      <span suppressHydrationWarning>
        {!mounted || !isDark ? <Moon size={18} /> : <Sun size={18} />}
      </span>
    </button>
  );
}
