import { pool as managementPool } from "../config/managementDatabase.js";
import { getIndustryNews } from "./newsService.js";
import { sendDailyBriefNewsletterEmail } from "./emailService.js";

const MAX_EMAIL_HEADLINES = 6;
const MAX_HEADLINE_AGE_MS = 2 * 24 * 60 * 60 * 1000;

type DailyBriefHeadline = {
  title: string;
  source: string;
  link?: string;
  publishedLabel: string;
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

function getTopHeadlines(newsFeed: any[]): DailyBriefHeadline[] {
  const flattened = newsFeed.flatMap((source: any) =>
    (source.items || []).map((item: any) => {
      const releaseDate = parseNewsReleaseDate(item);
      return {
        title: item?.title || "",
        source: source?.source || "Unknown source",
        link: item?.link || "",
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
    }));
}

function buildDailyBriefNewsletterHtml(headlines: DailyBriefHeadline[], lastUpdated: string): string {
  const generatedLabel = new Date(lastUpdated || Date.now()).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const headlineHtml =
    headlines.length === 0
      ? `<div class="empty">No qualifying fresh headlines were available in this cycle.</div>`
      : headlines
          .map(
            (headline) => `
        <div class="headline">
          <div class="headline-title">${headline.link ? `<a href="${headline.link}" target="_blank" rel="noopener noreferrer">${headline.title}</a>` : headline.title}</div>
          <div class="headline-meta">${headline.source} • ${headline.publishedLabel}</div>
        </div>
      `
          )
          .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; padding: 24px; background: #f5f7fb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a; }
    .wrap { max-width: 980px; margin: 0 auto; }
    .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 24px; padding: 24px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
    .title { font-size: 28px; font-weight: 300; letter-spacing: -0.02em; margin: 0; }
    .sub { font-size: 13px; color: #64748b; margin-top: 4px; }
    .ticker { border: 1px solid #dbe7f3; border-radius: 10px; background: #f3f9fc; padding: 8px 10px; font-size: 12px; color: #334155; margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
    .tile { border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc; padding: 12px; }
    .tile h4 { margin: 0; font-size: 12px; color: #0f172a; font-weight: 600; letter-spacing: 0.02em; }
    .tile p { margin: 3px 0 8px; font-size: 11px; color: #64748b; }
    .bars { display: flex; align-items: end; gap: 4px; height: 56px; }
    .bar { flex: 1; background: linear-gradient(180deg, #60a5fa 0%, #3b82f6 100%); border-radius: 4px 4px 0 0; }
    .bar.alt { background: linear-gradient(180deg, #fb923c 0%, #f97316 100%); }
    .headlines-wrap { border-top: 1px solid #e2e8f0; padding-top: 14px; }
    .headlines-head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
    .headlines-title { font-size: 18px; font-weight: 500; margin: 0; }
    .last-updated { font-size: 12px; color: #64748b; margin: 0; }
    .headline { border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px 12px; margin-bottom: 8px; background: #f8fafc; }
    .headline-title { font-size: 14px; line-height: 1.4; font-weight: 500; margin-bottom: 4px; }
    .headline-title a { color: #0f172a; text-decoration: none; }
    .headline-title a:hover { text-decoration: underline; color: #2563eb; }
    .headline-meta { font-size: 11px; color: #64748b; }
    .empty { font-size: 13px; color: #64748b; border: 1px dashed #cbd5e1; border-radius: 12px; padding: 14px; }
    .note { margin-top: 12px; font-size: 11px; color: #64748b; }
    @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } .header { flex-direction: column; align-items: flex-start; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="header">
        <div>
          <h1 class="title">Cohi Daily Morning Brief</h1>
          <p class="sub">${new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })} | Markets & Economy Update</p>
        </div>
        <p class="last-updated">Last fetched: ${generatedLabel}</p>
      </div>

      <div class="ticker">Market Intelligence Snapshot • 30-Yr Conforming 6.092% • Jumbo 6.263% • FHA 5.880% • VA 5.692%</div>

      <div class="grid">
        <div class="tile"><h4>30-YR FIXED RATE</h4><p>Lowest in several years — now sub-6%</p><div class="bars"><div class="bar" style="height:30%"></div><div class="bar" style="height:65%"></div><div class="bar" style="height:52%"></div><div class="bar" style="height:48%"></div><div class="bar" style="height:41%"></div><div class="bar" style="height:57%"></div></div></div>
        <div class="tile"><h4>10-YR TREASURY YIELD</h4><p>Fed-cut expectations reflected in yields</p><div class="bars"><div class="bar alt" style="height:52%"></div><div class="bar alt" style="height:44%"></div><div class="bar alt" style="height:46%"></div><div class="bar alt" style="height:49%"></div><div class="bar alt" style="height:54%"></div><div class="bar alt" style="height:47%"></div></div></div>
        <div class="tile"><h4>MBA APPLICATION INDEX</h4><p>Purchase and refi activity trend</p><div class="bars"><div class="bar" style="height:58%"></div><div class="bar alt" style="height:44%"></div><div class="bar" style="height:54%"></div><div class="bar alt" style="height:48%"></div><div class="bar" style="height:52%"></div><div class="bar alt" style="height:56%"></div></div></div>
        <div class="tile"><h4>NAHB BUILDER CONFIDENCE</h4><p>Builder sentiment and demand outlook</p><div class="bars"><div class="bar" style="height:38%"></div><div class="bar" style="height:42%"></div><div class="bar" style="height:33%"></div><div class="bar" style="height:39%"></div><div class="bar" style="height:37%"></div><div class="bar" style="height:38%"></div></div></div>
        <div class="tile"><h4>RATE SNAPSHOT BY PRODUCT</h4><p>Prior week vs current view</p><div class="bars"><div class="bar alt" style="height:48%"></div><div class="bar" style="height:52%"></div><div class="bar alt" style="height:44%"></div><div class="bar" style="height:50%"></div><div class="bar alt" style="height:54%"></div><div class="bar" style="height:56%"></div></div></div>
        <div class="tile"><h4>EXISTING HOME SALES (SAAR)</h4><p>Monthly unit pace snapshot</p><div class="bars"><div class="bar" style="height:46%"></div><div class="bar" style="height:49%"></div><div class="bar" style="height:50%"></div><div class="bar" style="height:45%"></div><div class="bar" style="height:32%"></div><div class="bar" style="height:43%"></div></div></div>
      </div>

      <div class="headlines-wrap">
        <div class="headlines-head">
          <h2 class="headlines-title">Top Headlines</h2>
          <p class="last-updated">No sensitive or tenant data included</p>
        </div>
        ${headlineHtml}
      </div>

      <p class="note">You are receiving this because you subscribed to the Cohi Daily Brief newsletter. You can disable it any time from the Industry News card in Cohi.</p>
    </div>
  </div>
</body>
</html>`;
}

function buildDailyBriefNewsletterText(headlines: DailyBriefHeadline[], lastUpdated: string): string {
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
  return `${header}\n\nTop Headlines:\n${list}\n\nNo sensitive or tenant data included.`;
}

export async function sendDailyBriefNewsletterPreview(recipientEmail: string): Promise<void> {
  const result = await getIndustryNews();
  const headlines = getTopHeadlines(result.newsFeed || []);
  await sendDailyBriefNewsletterEmail({
    to: recipientEmail,
    subject: `Cohi Daily Morning Brief - ${new Date().toLocaleDateString()}`,
    html: buildDailyBriefNewsletterHtml(headlines, result.lastUpdated || new Date().toISOString()),
    text: buildDailyBriefNewsletterText(headlines, result.lastUpdated || new Date().toISOString()),
  });
}

export async function sendDailyBriefNewsletterToSubscribers(reason: string, prefetchedNews?: any): Promise<void> {
  const subscriptionRows = await managementPool.query(
    `
      SELECT DISTINCT COALESCE(up.preference_value->>'email', u.email) AS email
      FROM user_preferences up
      LEFT JOIN coheus_users u ON u.id = up.user_id
      WHERE up.preference_key = 'dailyBriefEmailSubscription'
        AND lower(COALESCE(up.preference_value->>'enabled', 'false')) = 'true'
        AND COALESCE(up.preference_value->>'email', u.email) IS NOT NULL
    `
  );

  const recipients = Array.from(
    new Set(
      subscriptionRows.rows
        .map((row: any) => String(row.email || "").trim())
        .filter((email: string) => email.includes("@"))
    )
  );

  if (recipients.length === 0) {
    console.log("[DailyBriefEmail] No subscribed recipients found.");
    return;
  }

  const result = prefetchedNews || (await getIndustryNews());
  const headlines = getTopHeadlines(result.newsFeed || []);
  const lastUpdated = result.lastUpdated || new Date().toISOString();
  const html = buildDailyBriefNewsletterHtml(headlines, lastUpdated);
  const text = buildDailyBriefNewsletterText(headlines, lastUpdated);
  const subject = `Cohi Daily Morning Brief - ${new Date().toLocaleDateString()}`;

  const deliveries = await Promise.allSettled(
    recipients.map((to) =>
      sendDailyBriefNewsletterEmail({
        to,
        subject,
        html,
        text,
      })
    )
  );

  const sentCount = deliveries.filter((item) => item.status === "fulfilled").length;
  const failedCount = deliveries.length - sentCount;
  console.log(
    `[DailyBriefEmail] Dispatch complete (${reason}). Sent: ${sentCount}, Failed: ${failedCount}, Recipients: ${recipients.length}`
  );
}

