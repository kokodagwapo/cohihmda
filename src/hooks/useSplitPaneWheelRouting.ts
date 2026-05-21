/**
 * Split layout §2.3: when pointer is over a pane, wheel scrolls that pane if scrollable.
 */

import { useEffect, useRef, type RefObject } from "react";

function findScrollable(
  start: EventTarget | null,
  boundary: HTMLElement,
): HTMLElement | null {
  let el = start instanceof HTMLElement ? start : null;
  while (el && boundary.contains(el)) {
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    const canScrollY =
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      el.scrollHeight > el.clientHeight + 1;
    if (canScrollY) return el;
    if (el === boundary) break;
    el = el.parentElement;
  }
  return null;
}

export function useSplitPaneWheelRouting(
  enabled: boolean,
  chatPaneRef: RefObject<HTMLElement | null>,
  pagePaneRef: RefObject<HTMLElement | null>,
) {
  const activePane = useRef<"chat" | "page" | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const onWheel = (e: WheelEvent) => {
      const chatRoot = chatPaneRef.current;
      const pageRoot = pagePaneRef.current;
      if (!chatRoot || !pageRoot) return;

      const target = e.target as Node | null;
      const overChat = target && chatRoot.contains(target);
      const overPage = target && pageRoot.contains(target);
      const pane: "chat" | "page" | null = overChat
        ? "chat"
        : overPage
          ? "page"
          : activePane.current;

      if (!pane) return;

      const boundary = pane === "chat" ? chatRoot : pageRoot;
      const scrollable = findScrollable(target, boundary);
      if (!scrollable) return;

      const maxScroll = scrollable.scrollHeight - scrollable.clientHeight;
      const next = scrollable.scrollTop + e.deltaY;
      if (next < 0 || next > maxScroll) return;

      scrollable.scrollTop = next;
      e.preventDefault();
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [enabled, chatPaneRef, pagePaneRef]);

  return {
    onChatPaneEnter: () => {
      activePane.current = "chat";
    },
    onChatPaneLeave: () => {
      if (activePane.current === "chat") activePane.current = null;
    },
    onPagePaneEnter: () => {
      activePane.current = "page";
    },
    onPagePaneLeave: () => {
      if (activePane.current === "page") activePane.current = null;
    },
  };
}
