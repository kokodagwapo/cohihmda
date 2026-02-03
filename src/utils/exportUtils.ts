import type { RefObject } from "react";

export type ExportTable = {
  name?: string;
  headers: Array<string>;
  rows: Array<Array<string | number | null | undefined>>;
};

export type ExportData = {
  title: string;
  tables?: ExportTable[];
};

const toSafeFileName = (value: string) =>
  (value || "export").replace(/[^a-z0-9]/gi, "_").toLowerCase();

const resolveElement = (ref: RefObject<HTMLElement> | HTMLElement) => {
  if (ref instanceof HTMLElement) return ref;
  return ref?.current || null;
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
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
  });
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
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
  });
  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({
    orientation: canvas.width > canvas.height ? "landscape" : "portrait",
    unit: "pt",
    format: [canvas.width, canvas.height],
  });
  pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
  pdf.save(`${toSafeFileName(fileName)}.pdf`);
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

  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
  });
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
      const slide = pres.addSlide();
      slide.addText(table.name || data.title, {
        x: 0.4,
        y: 0.3,
        w: 12.5,
        fontSize: 18,
        color: "1e293b",
        bold: true,
      });
      const rows = [table.headers, ...table.rows.map((row) => row.map((cell) => `${cell ?? ""}`))];
      slide.addTable(rows, {
        x: 0.4,
        y: 0.9,
        w: 12.5,
        colW: table.headers.map(() => 12.5 / table.headers.length),
        fontSize: 10,
        border: { type: "solid", color: "e2e8f0" },
      });
    });
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
