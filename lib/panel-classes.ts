export const surfacePanelClass = "bg-panel text-panel-foreground";
export const surfaceSubtleClass = "bg-panel-muted text-panel-muted-foreground";
export const borderMutedClass = "border-border";
export const selectBaseClass = "border-border bg-panel text-panel-foreground";
export const selectFocusClass =
  "focus:border-brand-cta focus:ring-brand-cta/30";
export const panelClass =
  "border border-border bg-panel text-panel-foreground shadow backdrop-blur";

export const touchTargetClass = "min-h-11 min-w-11 touch-manipulation";
export const safeAreaTopClass =
  "pt-[max(0.5rem,calc(env(safe-area-inset-top,0px)+0.5rem))]";
export const safeAreaBottomClass =
  "pb-[max(1rem,env(safe-area-inset-bottom,0px))]";
/** Offset below the top search row (safe area + ~52px header). */
export const mapModeRowOffsetClass =
  "top-[calc(env(safe-area-inset-top,0px)+3.5rem)]";
export const mapFavoritesRowOffsetClass =
  "top-[calc(env(safe-area-inset-top,0px)+6.25rem)]";
export const mapPageClass = "h-[100dvh] min-h-[100dvh]";
export const sheetHandleClass =
  "mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-panel-muted";
export const mapBottomSheetClass = [
  "rounded-t-[22px] border-t shadow-2xl backdrop-blur",
  surfacePanelClass,
  borderMutedClass,
].join(" ");

/** Shared on-map floating chrome (header chips, panels). */
export const mapChromeClass = [
  "border",
  borderMutedClass,
  surfacePanelClass,
  "shadow-xl backdrop-blur",
].join(" ");

export const mapHeaderChipClass = [
  mapChromeClass,
  "rounded-2xl min-h-11 touch-manipulation",
  "inline-flex items-center justify-center",
  "transition hover:bg-panel/90 active:scale-[0.98]",
].join(" ");

export const mapSearchShellClass = [
  mapChromeClass,
  "rounded-2xl flex min-h-11 min-w-0 flex-1 items-center px-1.5 py-1",
].join(" ");

export const mapModeChipClass =
  "rounded-2xl min-h-11 px-4 py-2 text-xs font-semibold uppercase transition shadow-sm";

export const mapFloatingActionClass = [
  "rounded-2xl min-h-11 min-w-11 shadow-md grid place-items-center touch-manipulation",
  "bg-brand-cta text-brand-cta-foreground",
  "transition active:scale-[0.98]",
].join(" ");

/** Shared bottom-sheet chrome tuning (home map + share route). */
export const mapSheetToolbarOverlapPx = 35;
export const mapSheetPeekMinVisiblePx = 120;
export const mapSheetPeekMinVisibleCompactPx = 110;
