import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { ChatShellExpandMode } from "@/contexts/ChatShellContext";

/** Shared easing for chat shell compact / tall / full transitions. */
export const CHAT_SHELL_VIEW_TRANSITION = {
  duration: 0.48,
  ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
};

const NAV_OFFSET_PX = 64; // pt-16 top nav
const TALL_MAX_PX = 500;
const TALL_VH_RATIO = 0.7;
const SPLIT_MIN_PX = 500;
/** Compact shell content (header + input + gutters) stays below this. */
const COMPACT_MEASURE_MAX_PX = 420;
const DEFAULT_COMPACT_PX = 280;

function readViewportHeight() {
  if (typeof window === "undefined") return 800;
  return window.innerHeight;
}

function tallHeightPx(viewportHeight: number) {
  return Math.min(TALL_MAX_PX, Math.round(viewportHeight * TALL_VH_RATIO));
}

function fullHeightPx(viewportHeight: number) {
  return Math.max(tallHeightPx(viewportHeight), viewportHeight - NAV_OFFSET_PX);
}

export function resolveChatShellHeightPx(
  mode: ChatShellExpandMode,
  viewportHeight: number,
  measuredCompactPx: number,
) {
  switch (mode) {
    case "compact":
      return Math.max(160, measuredCompactPx);
    case "tall":
      return tallHeightPx(viewportHeight);
    case "full":
      return fullHeightPx(viewportHeight);
    case "split":
      return Math.max(SPLIT_MIN_PX, tallHeightPx(viewportHeight));
    default:
      return tallHeightPx(viewportHeight);
  }
}

/** Animate shell height for stacked modes; split uses CSS fill in the grid. */
export function useChatShellAnimatedHeight(
  mode: ChatShellExpandMode,
  contentRef: RefObject<HTMLElement | null>,
) {
  const [viewportHeight, setViewportHeight] = useState(readViewportHeight);
  const [measuredCompactPx, setMeasuredCompactPx] = useState(DEFAULT_COMPACT_PX);
  const compactHeightCacheRef = useRef(DEFAULT_COMPACT_PX);

  const applyCompactMeasurement = useCallback((heightPx: number) => {
    if (heightPx > COMPACT_MEASURE_MAX_PX) return;
    compactHeightCacheRef.current = heightPx;
    setMeasuredCompactPx(heightPx);
  }, []);

  const measureCompact = useCallback(() => {
    if (mode !== "compact") return;
    const el = contentRef.current;
    if (!el) return;
    applyCompactMeasurement(el.scrollHeight);
  }, [applyCompactMeasurement, contentRef, mode]);

  // Entering compact: shrink immediately to cached height (don't read tall DOM).
  useLayoutEffect(() => {
    if (mode !== "compact") return;
    setMeasuredCompactPx(compactHeightCacheRef.current);
    measureCompact();
    const remeasureMs = CHAT_SHELL_VIEW_TRANSITION.duration * 1000 + 80;
    const timer = window.setTimeout(measureCompact, remeasureMs);
    return () => window.clearTimeout(timer);
  }, [mode, measureCompact]);

  useLayoutEffect(() => {
    if (mode !== "compact") return;
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measureCompact());
    ro.observe(el);
    return () => ro.disconnect();
  }, [contentRef, measureCompact, mode]);

  useLayoutEffect(() => {
    const onResize = () => setViewportHeight(readViewportHeight());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const targetHeightPx = useMemo(
    () => resolveChatShellHeightPx(mode, viewportHeight, measuredCompactPx),
    [mode, viewportHeight, measuredCompactPx],
  );

  const usesAnimatedHeight = mode !== "split";

  return {
    targetHeightPx,
    usesAnimatedHeight,
    transition: CHAT_SHELL_VIEW_TRANSITION,
  };
}
