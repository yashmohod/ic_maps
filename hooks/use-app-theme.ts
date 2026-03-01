"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";

type AppTheme = {
  theme: string | undefined; // "light" | "dark" | "system"
  resolvedTheme: string | undefined; // "light" | "dark" (after system resolves)
  isDark: boolean;
  isLight: boolean;
  setDark: () => void;
  setLight: () => void;
  setSystem: () => void;
  toggleTheme: () => void;
};

export function useAppTheme(): AppTheme {
  const { theme, resolvedTheme, setTheme, systemTheme } = useTheme();

  // When theme === "system", resolvedTheme is the one you actually see.
  const effective = resolvedTheme ?? systemTheme ?? theme;

  return useMemo(() => {
    const isDark = effective === "dark";
    const isLight = effective === "light";

    return {
      theme,
      resolvedTheme,
      isDark,
      isLight,
      setDark: () => setTheme("dark"),
      setLight: () => setTheme("light"),
      setSystem: () => setTheme("system"),
      toggleTheme: () => setTheme(isDark ? "light" : "dark"),
    };
  }, [theme, resolvedTheme, systemTheme, setTheme, effective]);
}
