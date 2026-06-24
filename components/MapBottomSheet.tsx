"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { CircleChevronDown, CircleChevronUp } from "lucide-react";
import {
  mapBottomSheetClass,
  mapSheetPeekMinVisibleCompactPx,
  mapSheetPeekMinVisiblePx,
  mapSheetToolbarOverlapPx,
  safeAreaBottomClass,
  touchTargetClass,
} from "@/lib/panel-classes";

const DEFAULT_SNAP_POINTS = [0, 0.72];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readSafeAreaBottomPx(): number {
  if (typeof window === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px);pointer-events:none;visibility:hidden;";
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return px;
}

export { DEFAULT_SNAP_POINTS as MAP_BOTTOM_SHEET_SNAP_POINTS };

export type MapBottomSheetProps = {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  toolbar?: React.ReactNode;
  initialPosition?: number;
  snapPoints?: number[];
  height?: string;
  fitContent?: boolean;
  maxHeight?: string;
  compactHeader?: boolean;
  peekMinVisiblePx?: number;
  className?: string;
  hidden?: boolean;
  position?: number;
  onPositionChange?: (position: number) => void;
  onEffectivePeekChange?: (peek: number) => void;
  /** Pull toolbar toward the sheet top (px). Reduces visible gap above the panel. */
  toolbarOverlapPx?: number;
};

export function MapBottomSheet({
  children,
  title,
  subtitle,
  toolbar,
  initialPosition = 0.72,
  snapPoints = DEFAULT_SNAP_POINTS,
  height = "90dvh",
  fitContent = false,
  maxHeight = "88dvh",
  compactHeader = false,
  peekMinVisiblePx,
  className,
  hidden = false,
  position: controlledPosition,
  onPositionChange,
  onEffectivePeekChange,
  toolbarOverlapPx = mapSheetToolbarOverlapPx,
}: MapBottomSheetProps) {
  const [internalPosition, setInternalPosition] = useState(initialPosition);
  const sheetPosition = controlledPosition ?? internalPosition;

  const positionRef = useRef(sheetPosition);
  positionRef.current = sheetPosition;

  const onPositionChangeRef = useRef(onPositionChange);
  onPositionChangeRef.current = onPositionChange;

  const onEffectivePeekChangeRef = useRef(onEffectivePeekChange);
  onEffectivePeekChangeRef.current = onEffectivePeekChange;

  const isControlledRef = useRef(controlledPosition !== undefined);
  isControlledRef.current = controlledPosition !== undefined;

  const sheetRef = useRef<HTMLDivElement>(null);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [effectivePeek, setEffectivePeek] = useState(
    snapPoints[snapPoints.length - 1] ?? 0.72,
  );

  const requestedPeek = snapPoints[snapPoints.length - 1] ?? 0.72;
  const minVisiblePx =
    peekMinVisiblePx ??
    (compactHeader
      ? mapSheetPeekMinVisibleCompactPx
      : mapSheetPeekMinVisiblePx);

  const applySheetPosition = (next: number | ((prev: number) => number)) => {
    const resolved =
      typeof next === "function" ? next(positionRef.current) : next;
    positionRef.current = resolved;
    onPositionChangeRef.current?.(resolved);
    if (!isControlledRef.current) {
      setInternalPosition(resolved);
    }
  };

  const [isDraggingSheet, setIsDraggingSheet] = useState(false);

  const sheetDragActiveRef = useRef(false);
  const sheetStartYRef = useRef(0);
  const sheetStartPosRef = useRef(0);
  const sheetDidDragRef = useRef(false);

  const sortedSnapPoints = useMemo(() => {
    const open = Math.min(...snapPoints);
    const peek = Math.min(requestedPeek, effectivePeek);
    return [open, peek].sort((a, b) => a - b);
  }, [snapPoints, requestedPeek, effectivePeek]);

  const sortedSnapPointsRef = useRef(sortedSnapPoints);
  sortedSnapPointsRef.current = sortedSnapPoints;

  const applySheetPositionRef = useRef(applySheetPosition);
  applySheetPositionRef.current = applySheetPosition;

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    const recomputePeek = () => {
      const h = sheet.offsetHeight;
      if (h <= 0) return;
      setSheetHeight(h);
      const safeBottom = readSafeAreaBottomPx();
      const minVisible = minVisiblePx + safeBottom;
      const clampedPeek = clamp(1 - minVisible / h, 0.58, 0.92);
      const nextPeek = Math.min(requestedPeek, clampedPeek);
      setEffectivePeek((prev) => {
        if (Math.abs(prev - nextPeek) < 0.005) return prev;
        return nextPeek;
      });
    };

    recomputePeek();
    const ro = new ResizeObserver(recomputePeek);
    ro.observe(sheet);
    window.addEventListener("resize", recomputePeek);
    window.addEventListener("orientationchange", recomputePeek);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recomputePeek);
      window.removeEventListener("orientationchange", recomputePeek);
    };
  }, [minVisiblePx, requestedPeek, height, fitContent, compactHeader]);

  useEffect(() => {
    onEffectivePeekChangeRef.current?.(effectivePeek);
  }, [effectivePeek]);

  function snapToNearest(position: number) {
    const points = sortedSnapPointsRef.current;
    let closest = points[0]!;
    let minDist = Math.abs(position - closest);
    for (const sp of points) {
      const d = Math.abs(position - sp);
      if (d < minDist) {
        minDist = d;
        closest = sp;
      }
    }
    return closest;
  }

  function handleSheetKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      applySheetPosition((current) => {
        const points = sortedSnapPointsRef.current;
        const idx = points.findIndex((sp) => Math.abs(sp - current) < 0.02);
        return idx > 0 ? points[idx - 1]! : points[0]!;
      });
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      applySheetPosition((current) => {
        const points = sortedSnapPointsRef.current;
        const idx = points.findIndex((sp) => Math.abs(sp - current) < 0.02);
        return idx < points.length - 1
          ? points[idx + 1]!
          : points[points.length - 1]!;
      });
    }
  }

  function toggleSheetToFarthestSnap() {
    applySheetPosition((current) => {
      const points = sortedSnapPointsRef.current;
      const first = points[0]!;
      const last = points[points.length - 1]!;
      const distToFirst = Math.abs(current - first);
      const distToLast = Math.abs(current - last);
      return distToFirst > distToLast ? first : last;
    });
  }

  function handleSheetDragStart(e: React.PointerEvent | React.TouchEvent) {
    const anyE = e as React.PointerEvent & React.TouchEvent;
    const clientY =
      anyE.touches && anyE.touches[0] ? anyE.touches[0].clientY : anyE.clientY;

    sheetDragActiveRef.current = true;
    sheetDidDragRef.current = false;
    setIsDraggingSheet(true);
    sheetStartYRef.current = clientY;
    sheetStartPosRef.current = positionRef.current;
  }

  useEffect(() => {
    function handleMove(e: PointerEvent | TouchEvent) {
      if (!sheetDragActiveRef.current) return;

      const anyE = e as PointerEvent & TouchEvent;
      const clientY =
        anyE.touches && anyE.touches[0]
          ? anyE.touches[0].clientY
          : anyE.clientY;

      const deltaY = clientY - sheetStartYRef.current;
      if (Math.abs(deltaY) > 6) sheetDidDragRef.current = true;

      const h = sheetRef.current?.offsetHeight ?? window.innerHeight;
      const nextPos = clamp(sheetStartPosRef.current + deltaY / h, 0, 1);
      applySheetPositionRef.current(nextPos);
    }

    function handleEnd() {
      if (!sheetDragActiveRef.current) return;
      sheetDragActiveRef.current = false;
      setIsDraggingSheet(false);
      applySheetPositionRef.current((current) => snapToNearest(current));
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
    window.addEventListener("touchmove", handleMove, { passive: false });
    window.addEventListener("touchend", handleEnd);
    window.addEventListener("touchcancel", handleEnd);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleEnd);
      window.removeEventListener("touchcancel", handleEnd);
    };
  }, []);

  if (hidden) return null;

  const peekPosition = sortedSnapPoints[sortedSnapPoints.length - 1] ?? 0.72;
  const isPeeked = sheetPosition > peekPosition * 0.65;
  const sheetHeightForToolbar = sheetHeight > 0 ? sheetHeight : null;
  const sheetTopPx =
    sheetHeightForToolbar != null
      ? sheetHeightForToolbar * (1 - sheetPosition)
      : fitContent
        ? `calc((1 - ${sheetPosition}) * min(${maxHeight}, 24rem))`
        : `calc((1 - ${sheetPosition}) * (${height}))`;

  return (
    <div
      className={[
        "fixed inset-x-0 bottom-0 z-30 overflow-visible pointer-events-none md:left-1/2 md:w-[720px] md:-translate-x-1/2",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {toolbar ? (
        <div
          className="absolute inset-x-0 z-40 overflow-visible px-3"
          style={{
            bottom:
              typeof sheetTopPx === "number" ? `${sheetTopPx}px` : sheetTopPx,
            transform: `translateY(calc(-100% + ${toolbarOverlapPx}px))`,
            transition: isDraggingSheet
              ? "none"
              : "bottom 250ms ease-out, transform 250ms ease-out",
          }}
        >
          {toolbar}
        </div>
      ) : null}

      <div
        ref={sheetRef}
        className={[
          "flex flex-col pointer-events-auto overflow-hidden",
          !isDraggingSheet && "transition-transform duration-250 ease-out",
          mapBottomSheetClass,
        ].join(" ")}
        style={{
          height: fitContent ? "auto" : height,
          maxHeight: fitContent ? maxHeight : undefined,
          transform: `translateY(${sheetPosition * 100}%)`,
        }}
      >
        <div
          className={[
            "relative w-full shrink-0 px-3",
            compactHeader ? "pt-2 pb-1.5" : "pt-2.5 pb-2",
          ].join(" ")}
          style={{ touchAction: "none" }}
          onPointerDown={handleSheetDragStart}
          onTouchStart={handleSheetDragStart}
        >
          <div className="flex items-start gap-2">
            <button
              type="button"
              className={[
                "grid h-10 w-10 shrink-0 place-items-center rounded-2xl shadow-sm select-none touch-none",
                touchTargetClass,
                "bg-brand-cta text-brand-cta-foreground",
                "transition active:scale-95",
              ].join(" ")}
              style={{ touchAction: "none" }}
              aria-label={
                isPeeked ? "Expand details panel" : "Collapse details panel"
              }
              onPointerDown={(e) => {
                e.stopPropagation();
                handleSheetDragStart(e);
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
                handleSheetDragStart(e);
              }}
              onKeyDown={handleSheetKeyDown}
              onClick={() => {
                if (sheetDidDragRef.current) return;
                toggleSheetToFarthestSnap();
              }}
            >
              {isPeeked ? (
                <CircleChevronUp className="text-current" size={28} />
              ) : (
                <CircleChevronDown className="text-current" size={28} />
              )}
            </button>

            <div className="min-w-0 flex-1 text-center">
              {!compactHeader ? (
                <div
                  className="mx-auto mb-1 h-1 w-10 shrink-0 rounded-full bg-panel-muted"
                  aria-hidden="true"
                />
              ) : null}
              {(title != null || subtitle != null) && (
                <div className="w-full min-w-0 space-y-0.5">
                  {title}
                  {subtitle}
                </div>
              )}
            </div>

            <div className="h-10 w-10 shrink-0" aria-hidden="true" />
          </div>
        </div>

        <div
          className={[
            "px-4",
            safeAreaBottomClass,
            fitContent
              ? "max-h-[min(72dvh,640px)] overflow-y-auto"
              : "min-h-0 flex-1 overflow-y-auto",
          ].join(" ")}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
