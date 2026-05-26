import { captureElementAsPngDataUrl } from "@/utils/exportUtils";

function isCaptureTargetReady(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width >= 40 && rect.height >= 40;
}

/**
 * Wait for chart/widget capture targets to mount and finish layout (Recharts).
 */
export async function waitForResearchCaptureReady(
  container: HTMLElement | null,
  captureKeys: string[],
  timeoutMs = 4000,
): Promise<void> {
  if (!container || captureKeys.length === 0) return;

  const uniqueKeys = [...new Set(captureKeys)];
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const ready = uniqueKeys.every((key) => {
      const el = container.querySelector(
        `[data-research-export-key="${CSS.escape(key)}"]`,
      ) as HTMLElement | null;
      return el && isCaptureTargetReady(el);
    });
    if (ready) {
      await new Promise((r) => setTimeout(r, 350));
      return;
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
}

export async function captureResearchExportImages(
  container: HTMLElement | null,
  captureKeys: string[],
): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  if (!container || captureKeys.length === 0) return images;

  const uniqueKeys = [...new Set(captureKeys)];
  for (const key of uniqueKeys) {
    const el = container.querySelector(
      `[data-research-export-key="${CSS.escape(key)}"]`,
    ) as HTMLElement | null;
    if (!el) continue;
    el.scrollIntoView({ block: "start", behavior: "instant" });
    await new Promise((r) => setTimeout(r, key.startsWith("insight-card-") ? 400 : 200));
    let dataUrl = await captureElementAsPngDataUrl(el);
    // Recharts SVG: retry on outer shell if inner capture is empty
    if (!dataUrl && el.querySelector("svg")) {
      const shell = el.closest("[data-research-export-key]") ?? el.parentElement;
      if (shell instanceof HTMLElement && shell !== el) {
        dataUrl = await captureElementAsPngDataUrl(shell);
      }
    }
    if (dataUrl) images.set(key, dataUrl);
  }
  return images;
}
