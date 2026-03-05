/**
 * Distribution Content Resolver
 * Resolves link-based content for each distribution content_type.
 */

import type { Pool } from 'pg';

export type ContentType = 'report' | 'dashboard' | 'canvas' | 'insight_digest';

export interface ResolveContentResult {
  link: string;
  title: string;
  description: string;
  html?: string;
}

export interface ScheduleRow {
  id: string;
  name: string;
  content_type: ContentType;
  content_id: string | null;
  content_config: Record<string, any>;
  description?: string | null;
  /** Inline recipient emails (from distribution_schedules.recipient_emails) */
  recipient_emails?: string[];
  /** FK to distribution_recipient_lists (from distribution_schedules.recipient_list_id) */
  recipient_list_id?: string | null;
}

/**
 * Resolve content for a distribution schedule and return link + optional HTML.
 */
export async function resolveContent(
  tenantPool: Pool,
  schedule: ScheduleRow,
  options: {
    userFilter?: string | null;
  } = {}
): Promise<ResolveContentResult> {
  const contentType = schedule.content_type;
  const description = schedule.description?.trim() || 'You have new shared content in Coheus.';

  if (contentType === 'report') {
    return {
      link: '/my-dashboard',
      title: schedule.name || 'Report',
      description,
    };
  }

  if (contentType === 'canvas') {
    const canvas = await loadCanvas(tenantPool, schedule.content_id);
    if (!canvas) {
      throw new Error('Canvas not found');
    }
    return {
      link: `/my-dashboard/${schedule.content_id}`,
      title: canvas.title || schedule.name || 'Canvas',
      description,
    };
  }

  if (contentType === 'insight_digest') {
    const html = await buildInsightDigestHtml(tenantPool, schedule.content_config || {});
    return {
      link: '/insights',
      title: schedule.name || 'Insight Digest',
      description,
      html,
    };
  }

  if (contentType === 'dashboard') {
    return {
      link: '/insights',
      title: schedule.name || 'Dashboard',
      description,
    };
  }

  throw new Error(`Unsupported content_type: ${contentType}`);
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

