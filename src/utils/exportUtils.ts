import type { RefObject } from "react";
import type { ResearchPptSlide } from "@/lib/researchReportPptExport";

export type ExportTable = {
  name?: string;
  headers: Array<string>;
  rows: Array<Array<string | number | null | undefined>>;
};

export type ExportData = {
  title: string;
  tables?: ExportTable[];
};

/** Max data rows per PowerPoint table slide (header row is separate). */
export const PPT_TABLE_DATA_ROWS_PER_SLIDE = 10;

/** Split table body rows into pages for multi-slide PPT export. */
export function chunkRowsForPptSlides<T>(
  rows: T[],
  rowsPerSlide = PPT_TABLE_DATA_ROWS_PER_SLIDE,
): T[][] {
  if (rows.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += rowsPerSlide) {
    chunks.push(rows.slice(i, i + rowsPerSlide));
  }
  return chunks;
}

/** 1-based inclusive row range label for paginated table slide titles. */
export function pptTablePageRowRangeLabel(
  pageIndex: number,
  totalRows: number,
  rowsPerSlide = PPT_TABLE_DATA_ROWS_PER_SLIDE,
): string {
  const startRow = pageIndex * rowsPerSlide + 1;
  const endRow = Math.min((pageIndex + 1) * rowsPerSlide, totalRows);
  return `rows ${startRow}–${endRow} of ${totalRows}`;
}

/** Minimal viz shape for chat-style PDF export (preview page + data page). */
export type VisualizationPdfExport = {
  type?: string;
  title?: string;
  data?: Record<string, unknown>[];
};

export type ExportVisualizationPdfOptions = {
  visualization: VisualizationPdfExport;
  title?: string;
  description?: string;
  captureTarget?: HTMLElement | null;
  fileName?: string;
};

export type ExportVisualizationPdfResult = {
  chartEmbedded: boolean;
  hasDataPage: boolean;
};

const toSafeFileName = (value: string) =>
  (value || "export").replace(/[^a-z0-9]/gi, "_").toLowerCase();

const resolveElement = (ref: RefObject<HTMLElement> | HTMLElement) => {
  if (ref instanceof HTMLElement) return ref;
  return ref?.current || null;
};

const getCaptureDimensions = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect();
  const width = Math.ceil(Math.max(rect.width, element.scrollWidth));
  const height = Math.ceil(Math.max(rect.height, element.scrollHeight));
  return { width, height };
};

const buildCanvasOptions = (element: HTMLElement) => {
  const { width, height } = getCaptureDimensions(element);
  const exportId = `export-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  element.setAttribute("data-export-id", exportId);

  return {
    exportId,
    options: {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      scrollX: -window.scrollX,
      scrollY: -window.scrollY,
      windowWidth: width,
      windowHeight: height,
      onclone: (doc: Document) => {
        const cloned = doc.querySelector(
          `[data-export-id="${exportId}"]`
        ) as HTMLElement | null;
        if (!cloned) return;
        cloned.style.overflow = "visible";
        cloned.style.maxWidth = "none";
        cloned.style.width = `${width}px`;
        cloned.style.height = `${height}px`;
        const body = doc.body;
        body.style.width = `${width}px`;
        body.style.height = `${height}px`;
        body.style.overflow = "visible";
      },
    },
  };
};

export async function exportElementAsImage(
  target: RefObject<HTMLElement> | HTMLElement,
  type: "png" | "jpeg",
  fileName: string
) {
  const element = resolveElement(target);
  if (!element) {
    throw new Error("Export target not found.");
  }
  const html2canvas = (await import("html2canvas")).default;
  const { exportId, options } = buildCanvasOptions(element);
  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(element, options);
  } finally {
    element.removeAttribute("data-export-id");
  }
  const mime = type === "jpeg" ? "image/jpeg" : "image/png";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, 0.92)
  );
  if (!blob) throw new Error("Failed to generate image.");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${toSafeFileName(fileName)}.${type}`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportElementAsPdf(
  target: RefObject<HTMLElement> | HTMLElement,
  fileName: string
) {
  const element = resolveElement(target);
  if (!element) {
    throw new Error("Export target not found.");
  }
  const html2canvas = (await import("html2canvas")).default;
  const { jsPDF } = await import("jspdf");
  const { exportId, options } = buildCanvasOptions(element);
  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(element, options);
  } finally {
    element.removeAttribute("data-export-id");
  }
  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({
    orientation: canvas.width > canvas.height ? "landscape" : "portrait",
    unit: "pt",
    format: [canvas.width, canvas.height],
  });
  pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
  pdf.save(`${toSafeFileName(fileName)}.pdf`);
}

export async function captureElementAsPngDataUrl(
  element: HTMLElement,
): Promise<string | null> {
  const html2canvas = (await import("html2canvas")).default;
  const { exportId, options } = buildCanvasOptions(element);
  try {
    const canvas = await html2canvas(element, options);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    element.removeAttribute("data-export-id");
  }
}

/** Build row objects from ExportData for the data page (matches chat viz.data). */
export function exportDataToVisualization(
  data: ExportData,
): VisualizationPdfExport {
  const table = data.tables?.[0];
  if (!table?.headers?.length) {
    return { type: "table", title: data.title, data: [] };
  }
  const rows = table.rows.map((row) => {
    const record: Record<string, unknown> = {};
    table.headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });
    return record;
  });
  return { type: "table", title: data.title, data: rows };
}

/**
 * Chat-style PDF: landscape letter, preview image on page 1, tabular data on page 2.
 * Matches Cohi Chat `handleDownloadPDF` (used for tables and charts in chat).
 */
export async function exportVisualizationAsPdf(
  options: ExportVisualizationPdfOptions,
): Promise<ExportVisualizationPdfResult> {
  const viz = options.visualization;
  const displayTitle = options.title || viz.title || "Visualization";
  const desc = options.description;
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "letter",
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;

  const drawHeader = (pageTitle: string) => {
    doc.setFontSize(18);
    doc.setTextColor(30, 41, 59);
    doc.setFont(undefined as any, "bold");
    doc.text(pageTitle, margin, margin + 10);
    doc.setFont(undefined as any, "normal");

    const chartType = viz.type || "chart";
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Chart Type: ${chartType.charAt(0).toUpperCase() + chartType.slice(1)}`,
      margin,
      margin + 28,
    );
  };

  const drawFooter = () => {
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Generated by Coheus on ${new Date().toLocaleDateString()}`,
      margin,
      pageHeight - 20,
    );
    doc.text("coheus.ai", pageWidth - margin - 50, pageHeight - 20);
  };

  drawHeader(displayTitle);

  let currentY = margin + 48;
  if (desc) {
    doc.setFontSize(11);
    doc.setTextColor(71, 85, 105);
    const splitDescription = doc.splitTextToSize(desc, contentWidth);
    doc.text(splitDescription, margin, currentY);
    currentY += splitDescription.length * 14 + 10;
  }

  let chartEmbedded = false;
  const captureTarget = options.captureTarget;
  if (captureTarget) {
    try {
      const dataUrl = await captureElementAsPngDataUrl(captureTarget);
      if (dataUrl) {
        const { width: imgW, height: imgH } = await new Promise<{
          width: number;
          height: number;
        }>((resolve) => {
          const im = new window.Image();
          im.onload = () => resolve({ width: im.width, height: im.height });
          im.onerror = () => resolve({ width: 1024, height: 576 });
          im.src = dataUrl;
        });

        const maxImgHeight = pageHeight - currentY - margin - 24;
        const ratio = imgW / imgH || 16 / 9;
        let drawW = contentWidth;
        let drawH = drawW / ratio;
        if (drawH > maxImgHeight) {
          drawH = maxImgHeight;
          drawW = drawH * ratio;
        }
        const drawX = margin + (contentWidth - drawW) / 2;
        doc.addImage(
          dataUrl,
          "PNG",
          drawX,
          currentY,
          drawW,
          drawH,
          undefined,
          "FAST",
        );
        chartEmbedded = true;
      }
    } catch (captureErr) {
      console.warn("Visualization capture for PDF failed:", captureErr);
    }
  }

  if (!chartEmbedded) {
    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text(
      "Chart preview unavailable — see data table on the next page.",
      margin,
      currentY + 20,
    );
  }

  drawFooter();

  const data = viz.data || [];
  const hasTabularData =
    data.length > 0 && Object.keys(data[0] || {}).length > 0;

  if (hasTabularData) {
    doc.addPage();
    drawHeader(`${displayTitle} — Data`);

    let tableY = margin + 56;
    const columns = Object.keys(data[0]);
    const colCount = Math.min(columns.length, 6);
    const colWidth = contentWidth / colCount;

    doc.setFillColor(241, 245, 249);
    doc.rect(margin, tableY - 14, contentWidth, 22, "F");

    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.setFont(undefined as any, "bold");
    columns.slice(0, colCount).forEach((col, i) => {
      doc.text(col.substring(0, 22), margin + 6 + i * colWidth, tableY);
    });
    tableY += 14;

    doc.setFont(undefined as any, "normal");
    doc.setTextColor(51, 65, 85);
    doc.setFontSize(9);
    data.forEach((row) => {
      if (tableY > pageHeight - margin - 20) {
        drawFooter();
        doc.addPage();
        drawHeader(`${displayTitle} — Data`);
        tableY = margin + 56;
      }
      columns.slice(0, colCount).forEach((col, i) => {
        const value = String(row[col] ?? "").substring(0, 28);
        doc.text(value, margin + 6 + i * colWidth, tableY);
      });
      tableY += 14;
    });

    drawFooter();
  }

  const fileStem = (options.fileName || displayTitle).replace(/[^a-z0-9]/gi, "_");
  doc.save(`${fileStem}.pdf`);

  return { chartEmbedded, hasDataPage: hasTabularData };
}

export async function exportElementAsPpt(
  target: RefObject<HTMLElement> | HTMLElement,
  fileName: string,
  data?: ExportData
) {
  const element = resolveElement(target);
  if (!element) {
    throw new Error("Export target not found.");
  }
  const html2canvas = (await import("html2canvas")).default;
  const pptxgen = (await import("pptxgenjs")).default;
  const pres = new pptxgen();
  pres.author = "Coheus";
  pres.title = fileName || "Export";
  pres.layout = "LAYOUT_WIDE";

  const { exportId, options } = buildCanvasOptions(element);
  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(element, options);
  } finally {
    element.removeAttribute("data-export-id");
  }
  const imageData = canvas.toDataURL("image/png");
  const cover = pres.addSlide();
  cover.addImage({ data: imageData, x: 0.3, y: 0.5, w: 12.7, h: 6.8 });
  cover.addText(fileName || "Export", {
    x: 0.3,
    y: 0.1,
    w: 12,
    fontSize: 22,
    color: "1e293b",
    bold: true,
  });

  if (data?.tables?.length) {
    data.tables.forEach((table) => {
      const dataRows = table.rows.map((row) =>
        row.map((cell) => `${cell ?? ""}`),
      );
      const chunks = chunkRowsForPptSlides(dataRows);
      const pages = chunks.length > 0 ? chunks : [[]];
      const baseTitle = table.name || data.title;

      pages.forEach((chunk, pageIndex) => {
        const slide = pres.addSlide();
        const slideTitle =
          pages.length > 1
            ? `${baseTitle} (${pptTablePageRowRangeLabel(pageIndex, dataRows.length)})`
            : baseTitle;
        slide.addText(slideTitle, {
          x: 0.4,
          y: 0.3,
          w: 12.5,
          fontSize: 18,
          color: "1e293b",
          bold: true,
        });
        const rows = [table.headers, ...chunk];
        slide.addTable(rows, {
          x: 0.4,
          y: 0.9,
          w: 12.5,
          colW: table.headers.map(() => 12.5 / table.headers.length),
          fontSize: 10,
          border: { type: "solid", color: "e2e8f0" },
        });
      });
    });
  }

  await pres.writeFile({ fileName: `${toSafeFileName(fileName)}.pptx` });
}

const PPT_MARGIN = 0.5;
const PPT_SLIDE_W = 13.333;
const PPT_CONTENT_W = PPT_SLIDE_W - PPT_MARGIN * 2;
const PPT_SLIDE_H = 7.5;

function loadPngDimensions(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const im = new window.Image();
    im.onload = () => resolve({ width: im.width, height: im.height });
    im.onerror = () => resolve({ width: 1280, height: 720 });
    im.src = dataUrl;
  });
}

function splitPptText(text: string, maxLen = 900): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    const slice = rest.slice(0, maxLen);
    const breakAt = slice.lastIndexOf("\n");
    const cut = breakAt > maxLen * 0.5 ? breakAt : maxLen;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** Structured research report deck (no full-page screenshot). */
export async function exportResearchReportAsPpt(
  slides: ResearchPptSlide[],
  images: Map<string, string>,
  fileName: string,
): Promise<void> {
  const pptxgen = (await import("pptxgenjs")).default;
  const pres = new pptxgen();
  pres.author = "Coheus";
  pres.title = fileName || "Research Report";
  pres.layout = "LAYOUT_WIDE";

  const addFooter = (slide: ReturnType<typeof pres.addSlide>) => {
    slide.addText(
      `Generated by Coheus | ${new Date().toLocaleDateString()}`,
      {
        x: PPT_MARGIN,
        y: 7.1,
        w: PPT_CONTENT_W,
        h: 0.3,
        fontSize: 9,
        color: "94a3b8",
        fontFace: "Arial",
      },
    );
  };

  for (const spec of slides) {
    if (spec.kind === "intro") {
      const slide = pres.addSlide();
      let y = 0.35;
      slide.addText(spec.title, {
        x: PPT_MARGIN,
        y,
        w: PPT_CONTENT_W,
        h: 0.7,
        fontSize: 24,
        bold: true,
        color: "1e293b",
        fontFace: "Arial",
      });
      y += 0.85;
      if (spec.understory) {
        slide.addText(spec.understory, {
          x: PPT_MARGIN,
          y,
          w: PPT_CONTENT_W,
          h: 0.6,
          fontSize: 14,
          color: "475569",
          fontFace: "Arial",
        });
        y += 0.75;
      }
      for (const section of spec.sections ?? []) {
        if (y > 6.5) break;
        slide.addText(section.heading, {
          x: PPT_MARGIN,
          y,
          w: PPT_CONTENT_W,
          h: 0.35,
          fontSize: 13,
          bold: true,
          color: "1e293b",
          fontFace: "Arial",
        });
        y += 0.4;
        const parts = splitPptText(section.body, 800);
        for (const part of parts) {
          if (y > 6.6) break;
          slide.addText(part, {
            x: PPT_MARGIN,
            y,
            w: PPT_CONTENT_W,
            h: 1.2,
            fontSize: 11,
            color: "334155",
            fontFace: "Arial",
            valign: "top",
          });
          y += 1.25;
        }
        y += 0.15;
      }
      addFooter(slide);
      continue;
    }

    if (spec.kind === "findingIntro") {
      const slide = pres.addSlide();
      let y = 0.35;
      slide.addText(spec.findingLabel, {
        x: PPT_MARGIN,
        y,
        w: PPT_CONTENT_W,
        h: 0.55,
        fontSize: 22,
        bold: true,
        color: "1e293b",
        fontFace: "Arial",
      });
      y += 0.75;
      slide.addText(spec.headline, {
        x: PPT_MARGIN,
        y,
        w: PPT_CONTENT_W,
        h: 0.65,
        fontSize: 18,
        bold: true,
        color: "334155",
        fontFace: "Arial",
      });
      y += 0.85;
      if (spec.understory) {
        const parts = splitPptText(spec.understory, 900);
        for (const part of parts) {
          if (y > 6.6) break;
          slide.addText(part, {
            x: PPT_MARGIN,
            y,
            w: PPT_CONTENT_W,
            h: 1.2,
            fontSize: 12,
            color: "475569",
            fontFace: "Arial",
            valign: "top",
          });
          y += 1.2;
        }
      }
      addFooter(slide);
      continue;
    }

    if (spec.kind === "table") {
      const dataRows = spec.rows.map((row) =>
        row.map((cell) => `${cell ?? ""}`),
      );
      const chunks = chunkRowsForPptSlides(dataRows);
      const pages = chunks.length > 0 ? chunks : [[]];

      pages.forEach((chunk, pageIndex) => {
        const slide = pres.addSlide();
        const slideTitle =
          pages.length > 1
            ? `${spec.title} (${pptTablePageRowRangeLabel(pageIndex, dataRows.length)})`
            : spec.title;
        slide.addText(slideTitle, {
          x: PPT_MARGIN,
          y: 0.3,
          w: PPT_CONTENT_W,
          h: 0.55,
          fontSize: 20,
          bold: true,
          color: "1e293b",
          fontFace: "Arial",
        });
        const tableRows = [
          spec.headers,
          ...chunk.map((row) => row.map((c) => `${c}`)),
        ];
        const colCount = Math.max(spec.headers.length, 1);
        slide.addTable(tableRows, {
          x: PPT_MARGIN,
          y: 1.0,
          w: PPT_CONTENT_W,
          colW: Array(colCount).fill(PPT_CONTENT_W / colCount),
          fontSize: 10,
          border: { type: "solid", color: "e2e8f0" },
          fontFace: "Arial",
        });
        addFooter(slide);
      });
      continue;
    }

    if (spec.kind === "insightCapture") {
      const slide = pres.addSlide();
      const dataUrl = images.get(spec.captureKey);
      if (dataUrl) {
        const { width: imgW, height: imgH } = await loadPngDimensions(dataUrl);
        const maxW = PPT_CONTENT_W;
        const maxH = PPT_SLIDE_H - PPT_MARGIN - 0.55;
        const ratio = imgW / imgH || 16 / 9;
        let drawW = maxW;
        let drawH = drawW / ratio;
        if (drawH > maxH) {
          drawH = maxH;
          drawW = drawH * ratio;
        }
        const drawX = PPT_MARGIN + (maxW - drawW) / 2;
        slide.addImage({
          data: dataUrl,
          x: drawX,
          y: 0.35,
          w: drawW,
          h: drawH,
        });
      } else {
        slide.addText("Insight unavailable", {
          x: PPT_MARGIN,
          y: 2.5,
          w: PPT_CONTENT_W,
          h: 0.4,
          fontSize: 12,
          italic: true,
          color: "94a3b8",
          fontFace: "Arial",
        });
      }
      addFooter(slide);
      continue;
    }

    if (spec.kind === "image") {
      const slide = pres.addSlide();
      slide.addText(spec.title, {
        x: PPT_MARGIN,
        y: 0.3,
        w: PPT_CONTENT_W,
        h: 0.55,
        fontSize: 20,
        bold: true,
        color: "1e293b",
        fontFace: "Arial",
      });
      const dataUrl = images.get(spec.captureKey);
      if (dataUrl) {
        slide.addImage({
          data: dataUrl,
          x: PPT_MARGIN,
          y: 1.0,
          w: PPT_CONTENT_W,
          h: 5.8,
        });
      } else {
        slide.addText("Visualization unavailable", {
          x: PPT_MARGIN,
          y: 2.5,
          w: PPT_CONTENT_W,
          h: 0.4,
          fontSize: 12,
          italic: true,
          color: "94a3b8",
          fontFace: "Arial",
        });
      }
      addFooter(slide);
    }
  }

  await pres.writeFile({ fileName: `${toSafeFileName(fileName)}.pptx` });
}

export async function exportDataAsExcel(data: ExportData, fileName: string) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const safeName = (value: string) =>
    value.replace(/[\s\\/*?:\[\]]/g, "_").slice(0, 31) || "Sheet";

  const summaryRows: Array<Array<string | number>> = [
    [data.title || "Export"],
    ["Exported", new Date().toISOString()],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(summaryRows),
    safeName("Summary")
  );

  if (data.tables?.length) {
    data.tables.forEach((table, idx) => {
      const rows = [table.headers, ...table.rows];
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(rows),
        safeName(table.name || `Table_${idx + 1}`)
      );
    });
  } else {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["No structured data available"]]),
      safeName("Data")
    );
  }

  XLSX.writeFile(wb, `${toSafeFileName(fileName)}.xlsx`);
}
