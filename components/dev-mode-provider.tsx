"use client";

import { createContext, useContext, type ReactNode } from "react";

const DevModeContext = createContext(false);

export function DevModeProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <DevModeContext.Provider value={enabled}>{children}</DevModeContext.Provider>
  );
}

/** Client-side DEV_Mode flag (injected from server layout). */
export function useDevMode(): boolean {
  return useContext(DevModeContext);
}
