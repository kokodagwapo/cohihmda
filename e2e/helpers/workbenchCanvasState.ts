import { expect, type Page } from "@playwright/test";

export type CanvasWidgetProbe = {
  testId: string;
  title: string;
  type: string;
  chartType: string;
  filterable: string;
};

/** Collect widget probes from canvas DOM (data-* on items + group widgets). */
export async function getCanvasWidgetProbes(
  page: Page,
): Promise<CanvasWidgetProbe[]> {
  return page.evaluate(() => {
    const out: CanvasWidgetProbe[] = [];
    const items = document.querySelectorAll('[data-testid^="canvas-item-"]');
    for (const el of items) {
      const title = el.getAttribute("data-widget-title") ?? "";
      const type = el.getAttribute("data-widget-type") ?? "";
      const chartType = el.getAttribute("data-chart-type") ?? "";
      const filterable = el.getAttribute("data-filterable") ?? "";
      if (title || type) {
        out.push({
          testId: el.getAttribute("data-testid") ?? "",
          title,
          type,
          chartType,
          filterable,
        });
      }
    }
    const grouped = document.querySelectorAll('[data-testid^="group-widget-"]');
    for (const el of grouped) {
      out.push({
        testId: el.getAttribute("data-testid") ?? "",
        title: el.getAttribute("data-widget-title") ?? "",
        type: el.getAttribute("data-widget-type") ?? "group_inner",
        chartType: el.getAttribute("data-chart-type") ?? "",
        filterable: el.getAttribute("data-filterable") ?? "",
      });
    }
    return out;
  });
}

export async function getCanvasWidgetTitles(page: Page): Promise<string[]> {
  const probes = await getCanvasWidgetProbes(page);
  return probes.map((p) => p.title).filter(Boolean);
}

export async function expectCanvasHasWidget(
  page: Page,
  titleRe: RegExp,
  options?: { timeoutMs?: number },
): Promise<void> {
  const timeout = options?.timeoutMs ?? 60_000;
  await expect
    .poll(async () => {
      const titles = await getCanvasWidgetTitles(page);
      return titles.some((t) => titleRe.test(t));
    }, { timeout, intervals: [1000, 2000] })
    .toBe(true);
}

export async function expectCanvasMissingWidget(
  page: Page,
  titleRe: RegExp,
  options?: { timeoutMs?: number },
): Promise<void> {
  const timeout = options?.timeoutMs ?? 30_000;
  await expect
    .poll(async () => {
      const titles = await getCanvasWidgetTitles(page);
      return !titles.some((t) => titleRe.test(t));
    }, { timeout, intervals: [1000, 2000] })
    .toBe(true);
}
