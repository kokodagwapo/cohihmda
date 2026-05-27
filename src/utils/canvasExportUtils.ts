/**
 * Workbench canvas export utilities: per-widget capture, composite, and optional header.
 * Used for exact-look PDF/PPT export (per-widget capture + composite onto one image).
 */

import type { CanvasLayoutItem } from '@/components/workbench/canvas/types';

/** Browser canvas size limit (conservative). Exceeding can cause blank or failed draw. */
const MAX_CANVAS_DIM = 16384;

export interface WidgetCapture {
  itemId: string;
  blob: Blob;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Capture a chart/SVG node as PNG blob by serializing SVG to image.
 * Use for Recharts and other SVG-based chart widgets (chart, cohi_widget).
 */
export async function captureChartAsImage(node: HTMLElement): Promise<Blob | null> {
  const svg = node.querySelector('svg') ?? (node.tagName === 'SVG' ? node : null);
  if (!svg) return null;

  const svgEl = svg as SVGElement;
  const box = node.getBoundingClientRect();
  const w = Math.max(1, Math.round(box.width));
  const h = Math.max(1, Math.round(box.height));

  try {
    const clone = svgEl.cloneNode(true) as SVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    const viewBox = svgEl.getAttribute('viewBox');
    if (viewBox) {
      clone.setAttribute('viewBox', viewBox);
    } else if (!clone.getAttribute('viewBox')) {
      clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
    // Drop shadow filters often fail when rasterizing standalone SVG → PNG.
    clone.querySelectorAll('[filter]').forEach((node) => {
      node.removeAttribute('filter');
    });
    const svgString = new XMLSerializer().serializeToString(clone);
    const dataUrl =
      'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);

    return new Promise<Blob | null>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const scale = 2;
          const canvas = document.createElement('canvas');
          canvas.width = w * scale;
          canvas.height = h * scale;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((b) => resolve(b ?? null), 'image/png', 1);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  } catch {
    return null;
  }
}

/**
 * Capture an arbitrary DOM node as PNG using html-to-image (better SVG/CSS fidelity),
 * with fallback to html2canvas.
 */
export async function captureWidgetElement(node: HTMLElement): Promise<Blob | null> {
  try {
    const { toBlob } = await import('html-to-image');
    const blob = await toBlob(node, {
      cacheBust: true,
      pixelRatio: 2,
      style: { transform: 'none' },
    });
    return blob ?? null;
  } catch {
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(node, {
        useCORS: true,
        allowTaint: true,
        scale: 2,
        backgroundColor: undefined,
        logging: false,
      });
      return new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b ?? null), 'image/png', 1);
      });
    } catch {
      return null;
    }
  }
}

/**
 * Composite multiple widget captures onto one canvas at their layout positions.
 * Respects browser canvas size limit; if total size exceeds MAX_CANVAS_DIM, scales down.
 * Returns a single PNG blob (one page / one slide).
 */
export async function compositeCanvasFromCaptures(
  captures: WidgetCapture[],
  options?: { backgroundColor?: string }
): Promise<Blob | null> {
  if (captures.length === 0) return null;

  const maxX = Math.max(...captures.map((c) => c.x + c.w));
  const maxY = Math.max(...captures.map((c) => c.y + c.h));
  let width = Math.max(1, Math.ceil(maxX));
  let height = Math.max(1, Math.ceil(maxY));

  let scale = 1;
  if (width > MAX_CANVAS_DIM || height > MAX_CANVAS_DIM) {
    scale = Math.min(MAX_CANVAS_DIM / width, MAX_CANVAS_DIM / height);
    width = Math.ceil(width * scale);
    height = Math.ceil(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const bg = options?.backgroundColor ?? '#ffffff';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  for (const cap of captures) {
    try {
      const img = await createImageBitmap(cap.blob);
      const sx = scale !== 1 ? cap.x * scale : cap.x;
      const sy = scale !== 1 ? cap.y * scale : cap.y;
      const sw = scale !== 1 ? cap.w * scale : cap.w;
      const sh = scale !== 1 ? cap.h * scale : cap.h;
      ctx.drawImage(img, sx, sy, sw, sh);
      img.close();
    } catch {
      // skip failed tile
    }
  }

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b ?? null), 'image/png', 1);
  });
}

/**
 * Draw a header (optional logo + title) above the composite image and return the final blob.
 */
export async function buildExportImageWithHeader(
  compositeBlob: Blob,
  options: { logoUrl?: string; title?: string; backgroundColor?: string }
): Promise<Blob> {
  const { logoUrl, title, backgroundColor = '#ffffff' } = options;

  const img = await createImageBitmap(compositeBlob);
  const cw = img.width;
  const ch = img.height;

  const headerHeight = logoUrl || title ? 80 : 0;
  const totalHeight = ch + headerHeight;

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    img.close();
    return compositeBlob;
  }

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, cw, totalHeight);

  let x = 16;
  if (logoUrl) {
    try {
      const logoImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = logoUrl;
      });
      const logoH = 48;
      const logoW = Math.min(logoImg.width * (logoH / logoImg.height), 200);
      ctx.drawImage(logoImg, x, 16, logoW, logoH);
      x += logoW + 16;
    } catch {
      // skip logo
    }
  }

  if (title) {
    ctx.fillStyle = '#1e293b';
    ctx.font = '24px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, x, headerHeight ? 44 : totalHeight / 2);
  }

  ctx.drawImage(img, 0, headerHeight, cw, ch);
  img.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/png',
      1
    );
  });
}

/** Whether this layout item type should use SVG/chart capture (Recharts). */
export function isChartType(item: CanvasLayoutItem): boolean {
  return item.type === 'chart' || item.type === 'cohi_widget';
}
