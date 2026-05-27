/** Capture chat visualization DOM as PNG (element id = cohi-viz-{messageId}). */

import {
  captureChartAsImage,
  captureWidgetElement,
} from "@/utils/canvasExportUtils";

/** Recharts bar enter animation is 800ms in EnhancedVisualization. */
const CHART_ANIMATION_SETTLE_MS = 900;

function hasVisibleRechartsBars(svg: SVGSVGElement): boolean {
  const shapes = svg.querySelectorAll(
    ".recharts-bar-rectangle path, .recharts-bar-rectangle rect, .recharts-bar rect",
  );
  for (const node of shapes) {
    if (node instanceof SVGGraphicsElement) {
      try {
        const box = node.getBBox();
        if (box.width > 2 && box.height > 2) return true;
      } catch {
        /* getBBox can throw on detached nodes */
      }
    }
  }
  return false;
}

function hasVisibleRechartsSeries(svg: SVGSVGElement): boolean {
  if (hasVisibleRechartsBars(svg)) return true;
  return !!svg.querySelector(
    ".recharts-line-curve, .recharts-area-area, .recharts-pie-sector, .recharts-sector",
  );
}

function maxRechartsBarExtent(svg: SVGSVGElement): number {
  let max = 0;
  const shapes = svg.querySelectorAll(
    ".recharts-bar-rectangle path, .recharts-bar-rectangle rect, .recharts-bar rect",
  );
  for (const node of shapes) {
    if (node instanceof SVGGraphicsElement) {
      try {
        max = Math.max(max, node.getBBox().width, node.getBBox().height);
      } catch {
        /* ignore */
      }
    }
  }
  return max;
}

/**
 * Wait for chart mount, layout, and Recharts enter animations before capture.
 */
export async function waitForChartVizReady(
  root: HTMLElement,
  timeoutMs = 4500,
): Promise<void> {
  await document.fonts.ready;
  const deadline = Date.now() + timeoutMs;
  let seriesVisibleSince: number | null = null;
  let lastBarExtent = 0;
  let stableBarFrames = 0;

  while (Date.now() < deadline) {
    const rect = root.getBoundingClientRect();
    if (rect.width >= 40 && rect.height >= 40) {
      const svg = root.querySelector("svg");
      if (svg instanceof SVGSVGElement && hasVisibleRechartsSeries(svg)) {
        if (seriesVisibleSince == null) {
          seriesVisibleSince = Date.now();
        }

        const barExtent = maxRechartsBarExtent(svg);
        if (barExtent > 2) {
          if (Math.abs(barExtent - lastBarExtent) < 1) {
            stableBarFrames += 1;
          } else {
            stableBarFrames = 0;
          }
          lastBarExtent = barExtent;
          if (stableBarFrames >= 3) {
            await new Promise((r) => setTimeout(r, 120));
            return;
          }
        }

        if (
          Date.now() - seriesVisibleSince >=
          CHART_ANIMATION_SETTLE_MS
        ) {
          await new Promise((r) => setTimeout(r, 120));
          return;
        }
      } else {
        seriesVisibleSince = null;
        lastBarExtent = 0;
        stableBarFrames = 0;
      }
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    await new Promise((r) => setTimeout(r, 50));
  }

  await new Promise((r) => setTimeout(r, 300));
}

async function withTooltipsHidden<T>(
  root: HTMLElement,
  fn: () => Promise<T>,
): Promise<T> {
  const tooltips = root.querySelectorAll(".recharts-tooltip-wrapper");
  const restores: { el: HTMLElement; display: string }[] = [];
  tooltips.forEach((t) => {
    const el = t as HTMLElement;
    restores.push({ el, display: el.style.display });
    el.style.display = "none";
  });
  try {
    return await fn();
  } finally {
    restores.forEach(({ el, display }) => {
      el.style.display = display;
    });
  }
}

async function captureChartDomAsBlob(root: HTMLElement): Promise<Blob | null> {
  const svgBlob = await captureChartAsImage(root);
  if (svgBlob) return svgBlob;

  const widgetBlob = await captureWidgetElement(root);
  if (widgetBlob) return widgetBlob;

  try {
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(root, {
      useCORS: true,
      allowTaint: true,
      scale: 2,
      backgroundColor: "#ffffff",
      logging: false,
    });
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b ?? null), "image/png", 1);
    });
  } catch (e) {
    console.error("Capture chart error:", e);
    return null;
  }
}

export async function captureChartAsBlob(
  messageId: string,
): Promise<Blob | null> {
  const el = document.getElementById(`cohi-viz-${messageId}`);
  if (!el) return null;

  try {
    await waitForChartVizReady(el);
    return await withTooltipsHidden(el, () => captureChartDomAsBlob(el));
  } catch (e) {
    console.error("Capture chart error:", e);
    return null;
  }
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
