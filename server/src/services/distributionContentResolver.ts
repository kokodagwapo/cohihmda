/**
 * Distribution Content Resolver
 * Generates exportable content (buffer or HTML) for each content_type:
 * report, canvas, dashboard, insight_digest.
 */

import type { Pool } from 'pg';
import {
  generatePptx,
  generatePdf,
  resolveReportData,
  canvasToReportDefinition,
  type ReportDefinition,
  type CanvasWidgetForReport,
} from './export/reportGenerationService.js';

export type ContentType = 'report' | 'dashboard' | 'canvas' | 'insight_digest';
export type ExportFormat = 'pdf' | 'pptx' | 'png' | 'html_inline';

export interface ResolveContentResult {
  attachment?: {
    buffer: Buffer;
    mime: string;
    filename: string;
  };
  /** For insight_digest, HTML body (no attachment) */
  html?: string;
  exportFormat: ExportFormat;
}

export interface ScheduleRow {
  id: string;
  name: string;
  content_type: ContentType;
  content_id: string | null;
  content_config: Record<string, any>;
}

/**
 * Map canvas layout item (workbench content.layout entry) to CanvasWidgetForReport
 */
function layoutItemToWidget(item: any): CanvasWidgetForReport | null {
  const type = item.type || '';
  const payload = item.payload || {};
  let category: 'kpi' | 'chart' | 'table' | 'embed' | 'other' = 'other';
  if (type === 'kpi') category = 'kpi';
  else if (type === 'chart') category = 'chart';
  else if (type === 'table') category = 'table';
  else if (['dashboard_section', 'registry_widget', 'cohi_widget'].includes(type)) category = 'embed';

  const widgetName = payload.title || payload.label || type || 'Widget';
  return {
    itemId: item.i || item.id || String(Math.random().toString(36).slice(2)),
    widgetName,
    category,
    data: payload.config || payload.data || payload,
    type,
  };
}

/**
 * Resolve content for a distribution schedule and return buffer and/or HTML.
 */
export async function resolveContent(
  tenantPool: Pool,
  schedule: ScheduleRow,
  options: {
    format?: ExportFormat;
    userFilter?: string | null;
  } = {}
): Promise<ResolveContentResult> {
  const format = options.format || (schedule.content_config?.exportFormat as ExportFormat) || 'pdf';
  const contentType = schedule.content_type;

  if (contentType === 'report') {
    const definition = await resolveReportDefinition(tenantPool, schedule);
    if (!definition) {
      throw new Error('Report definition not found');
    }
    const resolved = await resolveReportData(definition, tenantPool, options.userFilter || null);
    const usePdf = format === 'pdf';
    const buffer = usePdf ? await generatePdf(resolved) : await generatePptx(resolved);
    const ext = usePdf ? 'pdf' : 'pptx';
    const mime = usePdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    return {
      attachment: {
        buffer,
        mime,
        filename: `${sanitizeFilename(schedule.name)}.${ext}`,
      },
      exportFormat: usePdf ? 'pdf' : 'pptx',
    };
  }

  if (contentType === 'canvas') {
    const canvas = await loadCanvas(tenantPool, schedule.content_id);
    if (!canvas) {
      throw new Error('Canvas not found');
    }
    const layout = (canvas.content?.layout || canvas.content?.items) || [];
    const widgets: CanvasWidgetForReport[] = layout
      .map((item: any) => layoutItemToWidget(item))
      .filter(Boolean) as CanvasWidgetForReport[];
    if (widgets.length === 0) {
      throw new Error('Canvas has no exportable widgets');
    }
    const definition = canvasToReportDefinition(widgets, {
      title: canvas.title || schedule.name,
      theme: schedule.content_config?.theme,
    });
    const resolved = await resolveReportData(definition, tenantPool, options.userFilter || null);
    const usePdf = format === 'pdf';
    const buffer = usePdf ? await generatePdf(resolved) : await generatePptx(resolved);
    const ext = usePdf ? 'pdf' : 'pptx';
    const mime = usePdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    return {
      attachment: {
        buffer,
        mime,
        filename: `${sanitizeFilename(canvas.title || schedule.name)}.${ext}`,
      },
      exportFormat: usePdf ? 'pdf' : 'pptx',
    };
  }

  if (contentType === 'insight_digest') {
    const html = await buildInsightDigestHtml(tenantPool, schedule.content_config || {});
    return {
      html,
      exportFormat: 'html_inline',
    };
  }

  if (contentType === 'dashboard') {
    // Phase 2: Puppeteer or cached export; for now no attachment
    throw new Error('Dashboard distribution not yet implemented (use report or canvas)');
  }

  throw new Error(`Unsupported content_type: ${contentType}`);
}

async function resolveReportDefinition(
  tenantPool: Pool,
  schedule: ScheduleRow
): Promise<ReportDefinition | null> {
  const config = schedule.content_config || {};
  if (config.definition && config.definition.slides?.length) {
    return config.definition as ReportDefinition;
  }
  if (schedule.content_id) {
    const row = await tenantPool.query(
      `SELECT definition FROM public.workbench_report_templates WHERE id = $1`,
      [schedule.content_id]
    );
    if (row.rows[0]?.definition) {
      return row.rows[0].definition as ReportDefinition;
    }
  }
  return null;
}

async function loadCanvas(tenantPool: Pool, canvasId: string | null): Promise<{ title: string; content: any } | null> {
  if (!canvasId) return null;
  const row = await tenantPool.query(
    `SELECT title, content FROM public.workbench_canvases WHERE id = $1`,
    [canvasId]
  );
  if (row.rows.length === 0) return null;
  return {
    title: row.rows[0].title,
    content: row.rows[0].content,
  };
}

async function buildInsightDigestHtml(
  tenantPool: Pool,
  config: { buckets?: string[]; limit?: number; dateFilter?: string }
): Promise<string> {
  const buckets = config.buckets || ['critical', 'attention', 'working', 'context'];
  const limit = Math.min(config.limit || 20, 50);
  const dateFilter = config.dateFilter || 'ytd';

  const result = await tenantPool.query(
    `SELECT id, bucket, headline, understory, insight_type, source, generated_at
     FROM public.generated_insights
     WHERE date_filter = $1 AND bucket = ANY($2)
     ORDER BY
       CASE bucket
         WHEN 'critical' THEN 1
         WHEN 'attention' THEN 2
         WHEN 'working' THEN 3
         ELSE 4
       END,
       generated_at DESC
     LIMIT $3`,
    [dateFilter, buckets, limit]
  );

  const rows = result.rows;
  const sections: string[] = [];
  const byBucket = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byBucket.has(r.bucket)) byBucket.set(r.bucket, []);
    byBucket.get(r.bucket)!.push(r);
  }

  const bucketLabels: Record<string, string> = {
    critical: 'Critical',
    attention: 'Attention',
    working: 'Working',
    context: 'Context',
  };

  for (const bucket of buckets) {
    const items = byBucket.get(bucket) || [];
    if (items.length === 0) continue;
    sections.push(`<h2>${bucketLabels[bucket] || bucket}</h2>`);
    sections.push('<ul>');
    for (const i of items) {
      sections.push(
        `<li><strong>${escapeHtml(i.headline)}</strong>` +
          (i.understory ? `<br/><span style="color:#64748b">${escapeHtml(i.understory)}</span>` : '') +
          `</li>`
      );
    }
    sections.push('</ul>');
  }

  const title = 'Insight Digest';
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><title>${escapeHtml(title)}</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px; color: #1e293b;">
  <h1 style="font-size: 24px;">${escapeHtml(title)}</h1>
  <p style="color: #64748b;">${escapeHtml(dateStr)}</p>
  ${sections.join('\n')}
  <p style="margin-top: 24px; font-size: 12px; color: #94a3b8;">Powered by Coheus</p>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeFilename(name: string): string {
  return (name || 'export').replace(/[^a-z0-9]/gi, '_').slice(0, 80);
}
