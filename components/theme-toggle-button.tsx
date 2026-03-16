"use client";

import { IconMoon, IconSun } from "@tabler/icons-react";

import { useAppTheme } from "@/hooks/use-app-theme";

type Props = {
  className?: string;
};

export function ThemeToggleButton({ className = "" }: Props) {
  const { isDark, toggleTheme } = useAppTheme();
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={[
        "inline-flex items-center justify-center rounded-2xl border border-border bg-panel text-panel-foreground shadow-lg transition hover:bg-panel-muted focus:outline-none focus:ring-2 focus:ring-brand-cta/30",
        className,
      ].join(" ")}
    >
      {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
    </button>
  );
}
