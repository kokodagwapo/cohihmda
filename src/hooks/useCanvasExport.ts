/**
 * useCanvasExport
 *
 * Workbench canvas export: per-widget capture + composite for exact look.
 * PNG, PDF, PowerPoint, Excel, and Email screenshot.
 */

import { useCallback } from 'react';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';
import type { CanvasLayoutItem } from '@/components/workbench/canvas/types';
import {
  captureChartAsImage,
  captureWidgetElement,
  compositeCanvasFromCaptures,
  buildExportImageWithHeader,
  isChartType,
  type WidgetCapture,
} from '@/utils/canvasExportUtils';

export interface UseCanvasExportOptions {
  items: CanvasLayoutItem[];
  saveTitle: string;
  /** Optional logo URL (data URL or same-origin) for export header */
  logoUrl?: string;
  /** Optional title shown on export header */
  exportTitle?: string;
}

export function useCanvasExport({ items, saveTitle, logoUrl, exportTitle }: UseCanvasExportOptions) {
  const { toast } = useToast();

  const captureCanvasAsBlob = useCallback(async (): Promise<Blob | null> => {
    const root = document.getElementById('workbench-canvas-root');
    if (!root) return null;

    await document.fonts.ready();

    if (items.length === 0) {
      try {
        const html2canvas = (await import('html2canvas')).default;
        const canvas = await html2canvas(root, {
          useCORS: true,
          allowTaint: true,
          scale: 2,
          backgroundColor: undefined,
          logging: false,
        });
        return new Promise<Blob | null>((resolve) => {
          canvas.toBlob((b) => resolve(b ?? null), 'image/png', 1);
        });
      } catch (e) {
        console.error('Canvas capture error:', e);
        return null;
      }
    }

    const captures: WidgetCapture[] = [];
    let failedCount = 0;

    for (const item of items) {
      const node = root.querySelector<HTMLElement>(`[data-item-id="${item.i}"]`);
      if (!node) {
        failedCount += 1;
        continue;
      }
      const blob = isChartType(item)
        ? await captureChartAsImage(node)
        : await captureWidgetElement(node);
      if (blob) {
        captures.push({
          itemId: item.i,
          blob,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
        });
      } else {
        failedCount += 1;
      }
    }

    let composite: Blob | null = await compositeCanvasFromCaptures(captures);
    if (!composite && captures.length === 0) {
      try {
        const html2canvas = (await import('html2canvas')).default;
        const canvas = await html2canvas(root, {
          useCORS: true,
          allowTaint: true,
          scale: 2,
          backgroundColor: undefined,
          logging: false,
        });
        composite = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((b) => resolve(b ?? null), 'image/png', 1);
        });
      } catch {
        return null;
      }
    }

    if (!composite) return null;

    if (logoUrl || exportTitle) {
      try {
        return await buildExportImageWithHeader(composite, {
          logoUrl,
          title: (exportTitle ?? saveTitle) || 'Canvas',
          backgroundColor: '#ffffff',
        });
      } catch {
        return composite;
      }
    }

    return composite;
  }, [items, saveTitle, logoUrl, exportTitle]);

  const handleExportPng = useCallback(async () => {
    toast({ title: 'Exporting…', description: 'Capturing canvas.' });
    const blob = await captureCanvasAsBlob();
    if (!blob) {
      toast({ title: 'Capture failed', description: 'Could not capture canvas.', variant: 'destructive' });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(saveTitle || 'canvas').replace(/[^a-z0-9]/gi, '_')}.png`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Downloaded', description: 'Canvas saved as PNG.' });
  }, [captureCanvasAsBlob, saveTitle, toast]);

  const handleExportPdf = useCallback(async () => {
    toast({ title: 'Exporting…', description: 'Capturing canvas.' });
    const blob = await captureCanvasAsBlob();
    if (!blob) {
      toast({ title: 'Capture failed', description: 'Could not capture canvas.', variant: 'destructive' });
      return;
    }
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'landscape' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const imgData = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = imgData;
      });
      const aspect = img.naturalHeight / img.naturalWidth;
      const fitW = pageW;
      const fitH = Math.min(pageH, pageW * aspect);
      const marginX = (pageW - fitW) / 2;
      const marginY = (pageH - fitH) / 2;
      doc.addImage(imgData, 'PNG', marginX, marginY, fitW, fitH);
      doc.save(`${(saveTitle || 'canvas').replace(/[^a-z0-9]/gi, '_')}.pdf`);
      toast({ title: 'Downloaded', description: 'Canvas saved as PDF.' });
    } catch (err) {
      toast({ title: 'Export failed', description: err instanceof Error ? err.message : 'Could not create PDF', variant: 'destructive' });
    }
  }, [captureCanvasAsBlob, saveTitle, toast]);

  const handleExportPptx = useCallback(async () => {
    toast({ title: 'Exporting…', description: 'Capturing canvas.' });
    const blob = await captureCanvasAsBlob();
    if (!blob) {
      toast({ title: 'Capture failed', description: 'Could not capture canvas.', variant: 'destructive' });
      return;
    }
    try {
      const pptxgen = (await import('pptxgenjs')).default;
      const pres = new pptxgen();
      pres.author = 'Coheus';
      pres.title = saveTitle || 'Canvas';
      const slide = pres.addSlide();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
        const title = (exportTitle ?? saveTitle) || 'Canvas';
      slide.addText(title, { x: 0.5, y: 0.2, w: 9, fontSize: 24, bold: true, color: '1e293b' });
      slide.addImage({ data: dataUrl, x: 0.5, y: 0.6, w: 9, h: 5.25 });
      await pres.writeFile({ fileName: `${(saveTitle || 'canvas').replace(/[^a-z0-9]/gi, '_')}.pptx` });
      toast({ title: 'Downloaded', description: 'PowerPoint saved.' });
    } catch (err) {
      toast({ title: 'Export failed', description: err instanceof Error ? err.message : 'Could not create PowerPoint', variant: 'destructive' });
    }
  }, [captureCanvasAsBlob, saveTitle, exportTitle, toast]);

  /** Excel export: multi-sheet workbook from widget data. */
  const handleExportExcel = useCallback(() => {
    const safeName = (saveTitle || 'canvas').replace(/[^a-z0-9]/gi, '_');
    const sanitizeSheetName = (name: string) =>
      name.replace(/[\s\\/*?:[\]]]/g, '_').slice(0, 31) || 'Sheet';
    const stripHtml = (html: string) =>
      html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();

    const wb = XLSX.utils.book_new();

    // Summary
    const typeCounts: Record<string, number> = {};
    items.forEach((i) => { typeCounts[i.type] = (typeCounts[i.type] ?? 0) + 1; });
    const summaryRows: (string | number)[][] = [
      ['Canvas Export'],
      ['Title', saveTitle || 'Untitled canvas'],
      ['Exported', new Date().toISOString()],
      [],
      ['Widget type', 'Count'],
      ...Object.entries(typeCounts).map(([k, v]) => [k, v]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), sanitizeSheetName('Summary'));

    // KPIs
    const kpiItems = items.filter((i) => i.type === 'kpi' && i.payload.type === 'kpi');
    if (kpiItems.length > 0) {
      const kpiRows: (string | number)[][] = [['Label', 'Value', 'Format']];
      kpiItems.forEach((i) => {
        const p = i.payload as { label: string; value: number | string; format?: string };
        kpiRows.push([p.label, p.value, p.format ?? '']);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kpiRows), sanitizeSheetName('KPIs'));
    }

    // Table widgets
    const tableItems = items.filter((i) => i.type === 'table' && i.payload.type === 'table');
    tableItems.forEach((item, idx) => {
      const p = item.payload as { columns: { key: string; label: string }[]; data: Record<string, unknown>[] };
      const cols = p.columns ?? [];
      const header = cols.map((c) => c.label || c.key);
      const rows = (p.data ?? []).map((row: Record<string, unknown>) => cols.map((c) => String(row[c.key] ?? '')));
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([header, ...rows]),
        sanitizeSheetName(`Table ${idx + 1}`)
      );
    });

    // Chart widgets
    const chartItems = items.filter((i) => i.type === 'chart' && i.payload.type === 'chart');
    chartItems.forEach((item, idx) => {
      const p = item.payload as { config?: { title?: string; data?: Record<string, unknown>[] } };
      const chartData = p.config?.data;
      if (Array.isArray(chartData) && chartData.length > 0) {
        const cols = Object.keys(chartData[0]);
        const rows = chartData.map((row: Record<string, unknown>) => cols.map((c) => String(row[c] ?? '')));
        const sheetName = sanitizeSheetName(`Chart ${idx + 1}` + (p.config?.title ? ` - ${p.config.title}` : ''));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cols, ...rows]), sheetName);
      }
    });

    // Text
    const textRows: (string | number)[][] = [['Title', 'Content']];
    items.forEach((i) => {
      if (i.type === 'text_block' && i.payload.type === 'text_block') {
        const p = i.payload as { title?: string; content: string };
        textRows.push([p.title ?? '', p.content ?? '']);
      } else if (i.type === 'rich_text' && i.payload.type === 'rich_text') {
        const p = i.payload as { html: string };
        textRows.push(['', stripHtml(p.html ?? '')]);
      }
    });
    if (textRows.length > 1) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(textRows), sanitizeSheetName('Text'));
    }

    // Insights
    const insightRows: (string | number)[][] = [['Title', 'Content/Summary', 'Link']];
    items.forEach((i) => {
      if (i.type === 'pinned_insight' && i.payload.type === 'pinned_insight') {
        const p = i.payload as { title: string; content: string };
        insightRows.push([p.title ?? '', p.content ?? '', '']);
      } else if (i.type === 'news_card' && i.payload.type === 'news_card') {
        const p = i.payload as { title: string; summary: string; link?: string };
        insightRows.push([p.title ?? '', p.summary ?? '', p.link ?? '']);
      }
    });
    if (insightRows.length > 1) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(insightRows), sanitizeSheetName('Insights'));
    }

    // Dashboard sections
    const sectionItems = items.filter(
      (i) => i.type === 'dashboard_section' && i.payload.type === 'dashboard_section'
    );
    if (sectionItems.length > 0) {
      const sectionRows: (string | number)[][] = [['Section ID', 'Title']];
      sectionItems.forEach((i) => {
        const p = i.payload as { sectionId: string; title: string };
        sectionRows.push([p.sectionId ?? '', p.title ?? '']);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sectionRows), sanitizeSheetName('Dashboard Sections'));
    }

    try {
      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Downloaded', description: 'Canvas data exported as Excel.' });
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Could not create Excel file',
        variant: 'destructive',
      });
    }
  }, [items, saveTitle, toast]);

  const handleEmailScreenshot = useCallback(async () => {
    const blob = await captureCanvasAsBlob();
    if (!blob) {
      toast({ title: 'Capture failed', description: 'Could not capture canvas.', variant: 'destructive' });
      return;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      const subject = encodeURIComponent(`${saveTitle || 'Canvas'} – Coheus`);
      const body = encodeURIComponent(
        'Hi,\n\nThe canvas image has been copied to your clipboard. Paste it here with Ctrl+V (Windows/Linux) or Cmd+V (Mac).\n\n— Coheus'
      );
      window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
      toast({ title: 'Image copied', description: 'Paste into your email with Ctrl+V.' });
    } catch {
      toast({ title: 'Clipboard failed', description: 'Could not copy image.', variant: 'destructive' });
    }
  }, [captureCanvasAsBlob, saveTitle, toast]);

  return {
    captureCanvasAsBlob,
    handleExportPng,
    handleExportPdf,
    handleExportPptx,
    handleExportExcel,
    handleEmailScreenshot,
  };
}
