"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { useAppTheme } from "@/hooks/use-app-theme";

type Props = {
  className?: string;
  variant?: "icon" | "menu";
};

export function ThemeToggleButton({
  className = "",
  variant = "icon",
}: Props) {
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
  const title = !mounted ? "Appearance" : isDark ? "Light mode" : "Dark mode";

  if (variant === "menu") {
    return (
      <button
        type="button"
        onClick={mounted ? toggleTheme : undefined}
        aria-label={label}
        title={label}
        suppressHydrationWarning
        disabled={!mounted}
        className={[
          "flex h-9 w-full cursor-pointer items-center gap-2 rounded-xl border border-border bg-panel px-3 text-left text-sm text-panel-foreground transition hover:bg-panel-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-cta/50 disabled:cursor-not-allowed disabled:opacity-70",
          className,
        ].join(" ")}
      >
        <span className="text-brand-cta" suppressHydrationWarning>
          {!mounted || !isDark ? (
            <Moon size={16} aria-hidden="true" />
          ) : (
            <Sun size={16} aria-hidden="true" />
          )}
        </span>
        <span className="font-semibold" suppressHydrationWarning>
          {title}
        </span>
      </button>
    );
  }

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
