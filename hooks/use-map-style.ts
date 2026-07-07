"use client";

import { useAppTheme } from "@/hooks/use-app-theme";
import { withBasePath } from "@/lib/base-path";

export function useMapStyle() {
  const { isDark } = useAppTheme();
  const mapStyle = isDark
    ? withBasePath("/styles/osm-bright/style-local-dark.json")
    : withBasePath("/styles/osm-bright/style-local-light.json");
  return { isDark, mapStyle };
}
