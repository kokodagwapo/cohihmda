import { pool as managementPool } from "../config/managementDatabase.js";
import { getIndustryNews } from "./newsService.js";
import { sendDailyBriefNewsletterEmail } from "./emailService.js";
import { assertNoPii } from "./emailContentSanitizer.js";
import {
  loadEmailTemplate,
  replacePlaceholders,
} from "./emailTemplateLoader.js";
import {
  getMultiSeriesSnapshot,
  type MultiSeriesSnapshot,
  type RateSnapshot,
} from "./dashboard/marketRateService.js";

const MAX_EMAIL_HEADLINES = 6;
const MAX_HEADLINE_AGE_MS = 2 * 24 * 60 * 60 * 1000;

type DailyBriefHeadline = {
  title: string;
  source: string;
  link?: string;
  publishedLabel: string;
  excerpt?: string;
};

function isValidDate(value: Date) {
  return !Number.isNaN(value.getTime());
}

function parseNewsReleaseDate(item: any): Date | null {
  const directCandidates = [
    item?.publishedAt,
    item?.published_at,
    item?.pubDate,
    item?.published,
    item?.dateTime,
    item?.datetime,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = new Date(candidate);
      if (isValidDate(parsed)) return parsed;
    }
  }

  if (typeof item?.date === "string" && item.date.trim()) {
    const combined = `${item.date}${item.time ? ` ${item.time}` : ""}`;
    const parsed = new Date(combined);
    if (isValidDate(parsed)) return parsed;
  }

  return null;
}

function formatReleaseLabel(date: Date | null) {
  if (!date) return "Unknown release date";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const MAX_EXCERPT_LENGTH = 120;

function truncateExcerpt(raw?: string): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const clean = raw.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  if (clean.length <= MAX_EXCERPT_LENGTH) return clean;
  return clean.slice(0, MAX_EXCERPT_LENGTH).replace(/\s+\S*$/, "") + "…";
}

function getTopHeadlines(newsFeed: any[]): DailyBriefHeadline[] {
  const flattened = newsFeed.flatMap((source: any) =>
    (source.items || []).map((item: any) => {
      const releaseDate = parseNewsReleaseDate(item);
      return {
        title: item?.title || "",
        source: source?.source || "Unknown source",
        link: item?.link || "",
        excerpt: item?.excerpt || item?.contentSnippet || "",
        releaseDate,
        relevanceScore: Number(item?.relevanceScore || 0),
      };
    })
  );

  return flattened
    .filter(
      (headline: any) =>
        !!headline.title &&
        !headline.title.toLowerCase().startsWith("visit ") &&
        !!headline.releaseDate &&
        Date.now() - headline.releaseDate.getTime() <= MAX_HEADLINE_AGE_MS
    )
    .sort(
      (a: any, b: any) =>
        b.relevanceScore - a.relevanceScore ||
        (b.releaseDate?.getTime() || 0) - (a.releaseDate?.getTime() || 0)
    )
    .slice(0, MAX_EMAIL_HEADLINES)
    .map((headline: any) => ({
      title: headline.title,
      source: headline.source,
      link: headline.link,
      publishedLabel: formatReleaseLabel(headline.releaseDate),
      excerpt: truncateExcerpt(headline.excerpt),
    }));
}

/**
 * Build the enhanced market-rate section showing all four OBMMI 30-yr fixed
 * rates (Conforming, Jumbo, FHA, VA) with daily-change arrows.
 * Compact HTML keeps email under the ~4.5 KB deliverability ceiling.
 */
function buildMarketSectionHtml(rates: MultiSeriesSnapshot): string {
  const fmt = (r: RateSnapshot) =>
    r.rate != null ? `${r.rate.toFixed(3)}%` : "\u2014";

  const delta = (r: RateSnapshot) => {
    if (r.delta == null || r.rate == null) return "";
    if (r.delta === 0) return '<div class="md">\u2014</div>';
    const arrow = r.delta < 0 ? "\u25BC" : "\u25B2";
    const cls = r.delta < 0 ? "g" : "r";
    return `<div class="md ${cls}">${arrow} ${Math.abs(r.delta).toFixed(3)}</div>`;
  };

  const cells = [
    { label: "Conforming", snap: rates.conforming },
    { label: "Jumbo", snap: rates.jumbo },
    { label: "FHA", snap: rates.fha },
    { label: "VA", snap: rates.va },
  ]
    .map(
      (c) =>
        `<td class="mc"><div class="mn">${c.label}</div><div class="mv">${fmt(c.snap)}</div>${delta(c.snap)}</td>`
    )
    .join("");

  return `<div class="mk"><div class="mh">Market Rate Snapshot <span class="ms">Optimal Blue OBMMI</span></div><table class="mt"><tr>${cells}</tr></table></div>`;
}

async function buildDailyBriefNewsletterHtml(
  headlines: DailyBriefHeadline[],
  lastUpdated: string,
  options?: {
    managePreferencesUrl?: string;
    unsubscribeUrl?: string;
    marketRates?: MultiSeriesSnapshot;
    digestBaseUrl?: string;
    showMarketSnapshot?: boolean;
    showIndustryNews?: boolean;
    showDigest?: boolean;
  }
): Promise<string> {
  const showMarket = options?.showMarketSnapshot !== false;
  const showNews = options?.showIndustryNews !== false;
  const showDigest = options?.showDigest !== false;
  const dateLabel = new Date().toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const headlineHtml =
    headlines.length === 0
      ? '<div class="em">No qualifying fresh headlines were available in this cycle.</div>'
      : headlines
          .map(
            (h) =>
              `<div class="h"><div class="ht">${h.link ? `<a href="${h.link}">${h.title}</a>` : h.title}</div>${h.excerpt ? `<div class="sm">${h.excerpt}</div>` : ""}<div class="hm">${h.source} &bull; ${h.publishedLabel}</div></div>`
          )
          .join("\n");

  const marketSection =
    showMarket && options?.marketRates
      ? buildMarketSectionHtml(options.marketRates)
      : "";

  const headlinesSection = showNews
    ? `<div style="border-top:1px solid #e2e8f0;padding-top:14px;"><h2 style="font-size:18px;font-weight:500;margin:0 0 10px;">Top Headlines</h2>\n${headlineHtml}</div>`
    : "";

  const digestSection =
    showDigest && options?.digestBaseUrl
      ? `<div class="dw"><h2 class="dh">Your Cohi Digest</h2><div class="di"><a href="${options.digestBaseUrl}/insights?utm_source=daily_brief&utm_medium=email">View Insights</a></div><div class="di"><a href="${options.digestBaseUrl}/research?utm_source=daily_brief&utm_medium=email">View Research</a></div></div>`
      : "";

  const footerNote =
    "Subscribed to Cohi Daily Brief." +
    (options?.unsubscribeUrl || options?.managePreferencesUrl
      ? " " +
        [
          options.unsubscribeUrl
            ? `<a href="${options.unsubscribeUrl}">Unsubscribe</a>`
            : "",
          options.managePreferencesUrl
            ? `<a href="${options.managePreferencesUrl}">Manage preferences</a>`
            : "",
        ]
          .filter(Boolean)
          .join(" | ") +
        "."
      : "");

  const template = await loadEmailTemplate("daily-brief.html");
  if (template) {
    return replacePlaceholders(template, {
      DATE_LABEL: dateLabel,
      MARKET_SECTION: marketSection,
      HEADLINES_SECTION: headlinesSection,
      DIGEST_SECTION: digestSection,
      FOOTER_NOTE: footerNote,
    });
  }

  return inlineDailyBriefHtml(
    dateLabel,
    marketSection,
    headlinesSection,
    digestSection,
    footerNote,
  );
}

function inlineDailyBriefHtml(
  dateLabel: string,
  marketSection: string,
  headlinesSection: string,
  digestSection: string,
  footerNote: string,
): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{margin:0;padding:24px;background:#f5f7fb;font-family:sans-serif;color:#0f172a}
.w{max-width:640px;margin:0 auto}.c{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px}
.mk{border:1px solid #dbe7f3;border-radius:10px;background:#f3f9fc;padding:10px 12px;margin:16px 0}
.mh{font-size:13px;font-weight:600;color:#1e293b;margin-bottom:8px}.ms{font-weight:400;color:#94a3b8;font-size:11px}
.mt{width:100%;border-collapse:collapse}.mc{text-align:center;padding:4px 6px;width:25%}
.mn{font-size:11px;color:#64748b}.mv{font-size:16px;font-weight:600;color:#0f172a}
.md{font-size:10px}.g{color:#16a34a}.r{color:#dc2626}
.h{border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;margin-bottom:8px;background:#f8fafc}
.ht{font-size:14px;font-weight:500;margin-bottom:2px}.ht a{color:#0f172a;text-decoration:none}
.sm{font-size:12px;color:#475569;line-height:1.4;margin-bottom:4px}.hm{font-size:11px;color:#94a3b8}
.em{font-size:13px;color:#64748b;border:1px dashed #cbd5e1;border-radius:12px;padding:14px}
.dw{border-top:1px solid #e2e8f0;padding-top:14px;margin-top:14px}.dh{font-size:18px;font-weight:500;margin:0 0 10px}
.di{margin-bottom:8px}.di a{color:#2563eb;text-decoration:none;font-size:14px}
</style></head><body><div class="w"><div class="c">
<h1 style="font-size:24px;font-weight:300;margin:0;">Cohi Daily Morning Brief</h1>
<p style="font-size:13px;color:#64748b;margin-top:4px;">${dateLabel}</p>
${marketSection}
${headlinesSection}
${digestSection}
<p style="margin-top:12px;font-size:11px;color:#64748b;">${footerNote}</p>
</div></div></body></html>`;
}

function buildDailyBriefNewsletterText(
  headlines: DailyBriefHeadline[],
  lastUpdated: string,
  options?: { managePreferencesUrl?: string; unsubscribeUrl?: string }
): string {
  const header = `Cohi Daily Morning Brief\nLast fetched: ${new Date(lastUpdated).toLocaleString()}`;
  const list =
    headlines.length === 0
      ? "No qualifying fresh headlines were available in this cycle."
      : headlines
          .map(
            (headline, idx) =>
              `${idx + 1}. ${headline.title}\n   ${headline.source} • ${headline.publishedLabel}\n   ${headline.link || ""}`
          )
          .join("\n\n");
  const footer = options?.unsubscribeUrl || options?.managePreferencesUrl
    ? [options.unsubscribeUrl && `Unsubscribe: ${options.unsubscribeUrl}`, options.managePreferencesUrl && `Manage preferences: ${options.managePreferencesUrl}`].filter(Boolean).join("\n")
    : "";
  return `${header}\n\nTop Headlines:\n${list}\n\nNo sensitive or tenant data included.${footer ? "\n\n" + footer : ""}`;
}

async function getLiveMarketRates(): Promise<MultiSeriesSnapshot | undefined> {
  try {
    return await getMultiSeriesSnapshot();
  } catch {
    return undefined;
  }
}

export async function sendDailyBriefNewsletterPreview(
  recipientEmail: string,
): Promise<string | undefined> {
  const [result, marketRates] = await Promise.all([
    getIndustryNews(),
    getLiveMarketRates(),
  ]);
  const headlines = getTopHeadlines(result.newsFeed || []);
  const lastUpdated = result.lastUpdated || new Date().toISOString();
  const baseUrl = getFrontendUrl();
  const html = await buildDailyBriefNewsletterHtml(headlines, lastUpdated, {
    marketRates,
    digestBaseUrl: baseUrl,
  });
  console.log(`[DailyBriefPreview] HTML length=${html.length}, frontendUrl=${baseUrl}`);
  return sendDailyBriefNewsletterEmail({
    to: recipientEmail,
    subject: `Cohi Daily Morning Brief - ${new Date().toLocaleDateString()}`,
    html,
    text: buildDailyBriefNewsletterText(headlines, lastUpdated),
  });
}

const DEFAULT_SECTIONS = {
  marketSnapshot: true,
  industryNews: true,
  pipelineDigest: true,
  researchUpdates: true,
  trackedMetrics: true,
};

export type DailyBriefSubscriber = {
  email: string;
  unsubscribeToken: string | null;
  sections: typeof DEFAULT_SECTIONS;
  newsSourceFilter: string[];
};

/**
 * Get all subscribers from emailPreferences (new) and dailyBriefEmailSubscription (legacy).
 * Prefers emailPreferences when both exist. Returns email, token, sections, and newsSourceFilter.
 */
async function getDailyBriefSubscribers(): Promise<DailyBriefSubscriber[]> {
  const [newRows, legacyRows] = await Promise.all([
    managementPool.query(
      `
        SELECT up.user_id,
               COALESCE(up.preference_value->'dailyBrief'->>'email', u.email) AS email,
               up.preference_value->>'unsubscribeToken' AS unsubscribe_token,
               up.preference_value AS preference_value
        FROM user_preferences up
        LEFT JOIN coheus_users u ON u.id = up.user_id
        WHERE up.preference_key = 'emailPreferences'
          AND (up.preference_value->'dailyBrief'->>'enabled')::text = 'true'
          AND COALESCE(up.preference_value->'dailyBrief'->>'email', u.email) IS NOT NULL
      `
    ),
    managementPool.query(
      `
        SELECT up.user_id, COALESCE(up.preference_value->>'email', u.email) AS email, NULL::text AS unsubscribe_token, NULL::jsonb AS preference_value
        FROM user_preferences up
        LEFT JOIN coheus_users u ON u.id = up.user_id
        WHERE up.preference_key = 'dailyBriefEmailSubscription'
          AND lower(COALESCE(up.preference_value->>'enabled', 'false')) = 'true'
          AND COALESCE(up.preference_value->>'email', u.email) IS NOT NULL
      `
    ),
  ]);

  const byUser = new Map<string, DailyBriefSubscriber>();
  for (const row of newRows.rows as {
    user_id: string;
    email: string;
    unsubscribe_token: string | null;
    preference_value: { dailyBrief?: { sections?: Record<string, boolean>; newsSourceFilter?: string[] } } | null;
  }[]) {
    const email = String(row?.email || "").trim();
    if (!email || !email.includes("@")) continue;
    const db = row.preference_value?.dailyBrief;
    const sections = { ...DEFAULT_SECTIONS, ...db?.sections };
    const newsSourceFilter = Array.isArray(db?.newsSourceFilter) ? db.newsSourceFilter : [];
    byUser.set(row.user_id, {
      email,
      unsubscribeToken: row.unsubscribe_token || null,
      sections,
      newsSourceFilter,
    });
  }
  for (const row of legacyRows.rows as { user_id: string; email: string }[]) {
    const email = String(row?.email || "").trim();
    if (email && email.includes("@") && !byUser.has(row.user_id))
      byUser.set(row.user_id, {
        email,
        unsubscribeToken: null,
        sections: { ...DEFAULT_SECTIONS },
        newsSourceFilter: [],
      });
  }
  return Array.from(byUser.values());
}

/**
 * Resolve a public-facing frontend URL suitable for email deep-links.
 * Skips localhost entries (which would trigger spam filters) and falls back
 * to the production domain.
 */
const PRODUCTION_FRONTEND_URL = "https://cohi.coheus1.com";

function getFrontendUrl(): string {
  const raw = process.env.FRONTEND_URL || PRODUCTION_FRONTEND_URL;
  const candidates = raw.split(",").map((u) => u.trim()).filter(Boolean);
  const publicUrl = candidates.find((u) => !u.includes("localhost") && !u.includes("127.0.0.1"));
  return publicUrl || PRODUCTION_FRONTEND_URL;
}

export async function sendDailyBriefNewsletterToSubscribers(reason: string, prefetchedNews?: any): Promise<void> {
  const subscribers = await getDailyBriefSubscribers();
  if (subscribers.length === 0) {
    console.log("[DailyBriefEmail] No subscribed recipients found.");
    return;
  }

  const [result, marketRates] = await Promise.all([
    prefetchedNews ? Promise.resolve(prefetchedNews) : getIndustryNews(),
    getLiveMarketRates(),
  ]);
  const headlines = getTopHeadlines(result.newsFeed || []);
  const lastUpdated = result.lastUpdated || new Date().toISOString();
  const subject = `Cohi Daily Morning Brief - ${new Date().toLocaleDateString()}`;
  const baseUrl = getFrontendUrl();
  const managePreferencesUrl = `${baseUrl}/settings?tab=notifications&utm_source=daily_brief&utm_medium=email`;

  const deliveries = await Promise.allSettled(
    subscribers.map(async (sub) => {
      const filteredHeadlines =
        sub.newsSourceFilter.length > 0
          ? headlines.filter((h) => sub.newsSourceFilter.includes(h.source))
          : headlines;
      const unsubscribeUrl = sub.unsubscribeToken
        ? `${baseUrl}/unsubscribe/${sub.unsubscribeToken}?utm_source=daily_brief&utm_medium=email`
        : undefined;
      const footerOptions = {
        managePreferencesUrl,
        unsubscribeUrl,
        marketRates,
        digestBaseUrl: baseUrl,
        showMarketSnapshot: sub.sections.marketSnapshot,
        showIndustryNews: sub.sections.industryNews,
        showDigest: sub.sections.pipelineDigest || sub.sections.researchUpdates || sub.sections.trackedMetrics,
      };
      const html = await buildDailyBriefNewsletterHtml(filteredHeadlines, lastUpdated, footerOptions);
      const text = buildDailyBriefNewsletterText(filteredHeadlines, lastUpdated, footerOptions);
      assertNoPii(html, text);
      return sendDailyBriefNewsletterEmail({
        to: sub.email,
        subject,
        html,
        text,
        unsubscribeUrl: unsubscribeUrl || undefined,
      });
    })
  );

  const sentCount = deliveries.filter((item) => item.status === "fulfilled").length;
  const failedCount = deliveries.length - sentCount;
  console.log(
    `[DailyBriefEmail] Dispatch complete (${reason}). Sent: ${sentCount}, Failed: ${failedCount}, Recipients: ${subscribers.length}`
  );
}

