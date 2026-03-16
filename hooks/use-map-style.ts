"use client";

import { useAppTheme } from "@/hooks/use-app-theme";

export function useMapStyle() {
  const { isDark } = useAppTheme();
  const mapStyle = isDark
    ? "/styles/osm-bright/style-local-dark.json"
    : "/styles/osm-bright/style-local-light.json";
  return { isDark, mapStyle };
}
