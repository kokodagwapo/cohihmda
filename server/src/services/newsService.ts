import Parser from "rss-parser";
import axios from "axios";
import * as cheerio from "cheerio";

/**
 * News Service
 * Fetches real-time industry news from mortgage/housing industry sources
 *
 * Two types of sources:
 * 1. HTML Scraping (MBA, Fannie Mae, Freddie Mac, CFPB, FHFA) - enabled by default
 * 2. RSS Feeds (National Mortgage News, Mortgage News Daily) - disabled by default
 */

const rssParser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/rss+xml, application/xml, text/xml, */*",
  },
});

export interface NewsItem {
  title: string;
  time: string;
  date: string;
  link: string;
  publishedAt?: string;
  excerpt?: string;
  relevanceScore?: number;
}

export interface NewsSource {
  source: string;
  icon: string;
  color: string;
  bg: string;
  summary: string;
  items: NewsItem[];
  enabledByDefault?: boolean;
}

// Cache for news data (5 minute TTL)
let newsCache: {
  data: NewsSource[];
  timestamp: number;
} | null = null;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Format time ago from date
 */
function getTimeAgo(pubDate: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - pubDate.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "1d ago";
  if (diffDays < 7) return `${diffDays}d ago`;
  return pubDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Parse various date formats
 */
function parseDate(dateStr: string): Date {
  if (!dateStr) return new Date();

  // Clean up the string
  const cleaned = dateStr.trim().replace(/\s+/g, " ");

  try {
    // Try standard date parsing
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) return parsed;

    // Try "Month Day, Year" format (e.g., "January 21, 2026")
    const monthDayYear = cleaned.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (monthDayYear) {
      const parsed = new Date(
        `${monthDayYear[1]} ${monthDayYear[2]}, ${monthDayYear[3]}`
      );
      if (!isNaN(parsed.getTime())) return parsed;
    }

    // Try "MMM DD, YYYY" format (e.g., "JAN 12, 2026")
    const shortMonth = cleaned.match(/([A-Z]{3})\s+(\d{1,2}),?\s+(\d{4})/i);
    if (shortMonth) {
      const parsed = new Date(
        `${shortMonth[1]} ${shortMonth[2]}, ${shortMonth[3]}`
      );
      if (!isNaN(parsed.getTime())) return parsed;
    }
  } catch {
    // Fall through
  }

  return new Date();
}

const axiosConfig = {
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  },
};

/**
 * Scrape MBA news - uses newslink.mba.org which bypasses Cloudflare
 */
async function scrapeMBA(): Promise<NewsSource | null> {
  try {
    console.log("[NewsService] Scraping MBA NewsLink...");
    // Use newslink.mba.org which doesn't have Cloudflare protection
    const response = await axios.get("https://newslink.mba.org/", axiosConfig);
    const $ = cheerio.load(response.data);
    const items: NewsItem[] = [];

    // First, find the current newsletter link to get the latest content
    const currentIssueLink = $('a[href*="/mba-newslinks/"]')
      .filter((i, el) => {
        const href = $(el).attr("href") || "";
        // Match newsletter URLs like /mba-newslinks/2026/january/mba-newslink-friday-jan-9-2026
        return /\/mba-newslinks\/\d{4}\/[a-z]+\/mba-newslink-/.test(href);
      })
      .first()
      .attr("href");

    if (currentIssueLink) {
      // Fetch the current newsletter issue
      const issueUrl = currentIssueLink.startsWith("http")
        ? currentIssueLink
        : `https://newslink.mba.org${currentIssueLink}`;

      console.log(`[NewsService] Fetching MBA NewsLink issue: ${issueUrl}`);
      const issueResponse = await axios.get(issueUrl, axiosConfig);
      const $issue = cheerio.load(issueResponse.data);

      // Extract headlines from the newsletter
      // Headlines are typically in h1, h2 tags or list items with links
      $issue("h1, h2").each((i, elem) => {
        if (items.length >= 4) return false;

        const $heading = $issue(elem);
        let title = $heading.text().trim();

        // Clean up title
        title = title.replace(/\s+/g, " ").trim();

        // Skip navigation, dates, volume info, etc.
        if (!title || title.length < 25 || title.length > 200) return;
        if (
          /^(volume|friday|monday|tuesday|wednesday|thursday|saturday|sunday|mba newslink|top national|upcoming|about mba)/i.test(
            title
          )
        )
          return;
        if (/^\d{4}$/.test(title)) return; // Skip years

        // Look for a link in or near the heading
        let link =
          $heading.find("a").attr("href") ||
          $heading.closest("a").attr("href") ||
          "";
        if (!link) {
          // Check sibling or parent for link
          const $parent = $heading.parent();
          link = $parent.find("a").first().attr("href") || "";
        }

        // Default to the newsletter issue URL if no specific link
        if (!link) {
          link = issueUrl;
        } else if (!link.startsWith("http")) {
          link = `https://newslink.mba.org${link}`;
        }

        // Extract date from URL if possible
        const dateMatch = issueUrl.match(
          /(\d{4})\/([a-z]+)\/mba-newslink-[a-z]+-([a-z]+)-(\d+)-(\d{4})/i
        );
        let pubDate = new Date();
        if (dateMatch) {
          const monthNames: Record<string, number> = {
            january: 0,
            february: 1,
            march: 2,
            april: 3,
            may: 4,
            june: 5,
            july: 6,
            august: 7,
            september: 8,
            october: 9,
            november: 10,
            december: 11,
            jan: 0,
            feb: 1,
            mar: 2,
            apr: 3,
            jun: 5,
            jul: 6,
            aug: 7,
            sep: 8,
            oct: 9,
            nov: 10,
            dec: 11,
          };
          const month = monthNames[dateMatch[3].toLowerCase()];
          if (month !== undefined) {
            pubDate = new Date(
              parseInt(dateMatch[5]),
              month,
              parseInt(dateMatch[4])
            );
          }
        }

        // Avoid duplicates
        if (!items.some((item) => item.title === title)) {
          items.push({
            title,
            time: getTimeAgo(pubDate),
            date: pubDate.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            }),
            link,
          });
        }
      });

      // Also check list items in "TOP NATIONAL NEWS" section
      $issue('a[href*="newslink.mba.org"]').each((i, elem) => {
        if (items.length >= 4) return false;

        const $link = $issue(elem);
        const href = $link.attr("href") || "";
        let title = $link.text().trim();

        // Skip if too short or looks like navigation
        if (!title || title.length < 25 || title.length > 200) return;
        if (/^(click|view|subscribe|go to|prior articles)/i.test(title)) return;

        // Use issue date
        const dateMatch = issueUrl.match(
          /(\d{4})\/([a-z]+)\/mba-newslink-[a-z]+-([a-z]+)-(\d+)-(\d{4})/i
        );
        let pubDate = new Date();
        if (dateMatch) {
          const monthNames: Record<string, number> = {
            january: 0,
            february: 1,
            march: 2,
            april: 3,
            may: 4,
            june: 5,
            july: 6,
            august: 7,
            september: 8,
            october: 9,
            november: 10,
            december: 11,
            jan: 0,
            feb: 1,
            mar: 2,
            apr: 3,
            jun: 5,
            jul: 6,
            aug: 7,
            sep: 8,
            oct: 9,
            nov: 10,
            dec: 11,
          };
          const month = monthNames[dateMatch[3].toLowerCase()];
          if (month !== undefined) {
            pubDate = new Date(
              parseInt(dateMatch[5]),
              month,
              parseInt(dateMatch[4])
            );
          }
        }

        const link = href.startsWith("http")
          ? href
          : `https://newslink.mba.org${href}`;

        // Avoid duplicates
        if (!items.some((item) => item.title === title)) {
          items.push({
            title,
            time: getTimeAgo(pubDate),
            date: pubDate.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            }),
            link,
          });
        }
      });
    }

    if (items.length === 0) {
      console.warn("[NewsService] No items found for MBA NewsLink");
      return null;
    }

    console.log(
      `[NewsService] MBA: Found ${
        items.length
      } items. First: "${items[0].title.substring(0, 50)}..."`
    );

    return {
      source: "MBA",
      icon: "Building2",
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950/20",
      summary:
        "The Mortgage Bankers Association (MBA) provides market analysis, economic forecasts, and industry insights for mortgage rates, application volumes, and market trends.",
      items: items.slice(0, 2),
      enabledByDefault: true,
    };
  } catch (error: any) {
    console.error("[NewsService] MBA scrape failed:", error.message);
    return null;
  }
}

/**
 * Scrape Fannie Mae news
 */
async function scrapeFannieMae(): Promise<NewsSource | null> {
  try {
    console.log("[NewsService] Scraping Fannie Mae...");
    const response = await axios.get(
      "https://www.fanniemae.com/newsroom/fannie-mae-news",
      axiosConfig
    );
    const $ = cheerio.load(response.data);
    const items: NewsItem[] = [];

    // Fannie Mae news links contain /newsroom/fannie-mae-news/
    $('a[href*="/newsroom/fannie-mae-news/"]').each((i, elem) => {
      if (items.length >= 3) return false;

      const $elem = $(elem);
      const href = $elem.attr("href") || "";
      let title = $elem.text().trim();

      // Skip navigation links
      if (
        !href.includes("/newsroom/fannie-mae-news/") ||
        href.endsWith("/fannie-mae-news") ||
        href.endsWith("/fannie-mae-news/")
      )
        return;
      if (!title || title.length < 20 || title.length > 200) return;
      if (title.toLowerCase().includes("newsroom") && title.length < 30) return;

      // Look for date in parent or nearby elements
      let pubDate = new Date();
      const parentText = $elem.parent().parent().text();
      const dateMatch = parentText.match(/([A-Za-z]+\s+\d{1,2},?\s+\d{4})/);
      if (dateMatch) {
        pubDate = parseDate(dateMatch[1]);
      }

      const link = href.startsWith("http")
        ? href
        : `https://www.fanniemae.com${href}`;

      if (!items.some((item) => item.title === title)) {
        items.push({
          title,
          time: getTimeAgo(pubDate),
          date: pubDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
          link,
        });
      }
    });

    if (items.length === 0) {
      console.warn("[NewsService] No items found for Fannie Mae");
      return null;
    }

    console.log(
      `[NewsService] Fannie Mae: Found ${
        items.length
      } items. First: "${items[0].title.substring(0, 50)}..."`
    );

    return {
      source: "Fannie Mae",
      icon: "TrendingUp",
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-50 dark:bg-purple-950/20",
      summary:
        "Fannie Mae provides housing market research and economic forecasts on home price trends, housing supply dynamics, and mortgage origination strategies.",
      items: items.slice(0, 2),
      enabledByDefault: true,
    };
  } catch (error: any) {
    console.error("[NewsService] Fannie Mae scrape failed:", error.message);
    return null;
  }
}

/**
 * Scrape Freddie Mac news
 */
async function scrapeFreddieMac(): Promise<NewsSource | null> {
  try {
    console.log("[NewsService] Scraping Freddie Mac...");
    const response = await axios.get(
      "https://www.freddiemac.com/news",
      axiosConfig
    );
    const $ = cheerio.load(response.data);
    const items: NewsItem[] = [];

    // Freddie Mac links go to freddiemac.gcs-web.com
    $('a[href*="freddiemac.gcs-web.com/news-releases"]').each((i, elem) => {
      if (items.length >= 3) return false;

      const $elem = $(elem);
      const href = $elem.attr("href") || "";
      let title = $elem.find("strong").text().trim() || $elem.text().trim();

      // Clean up - remove "Read More" suffix
      title = title
        .replace(/Read More$/i, "")
        .replace(/\s+/g, " ")
        .trim();

      if (!title || title.length < 15 || title.length > 200) return;
      if (title.toLowerCase() === "read more") return;

      // Look for date
      let pubDate = new Date();
      const parentText = $elem.parent().text();
      const dateMatch = parentText.match(/([A-Za-z]+\s+\d{1,2},?\s+\d{4})/);
      if (dateMatch) {
        pubDate = parseDate(dateMatch[1]);
      }

      if (!items.some((item) => item.title === title)) {
        items.push({
          title,
          time: getTimeAgo(pubDate),
          date: pubDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
          link: href,
        });
      }
    });

    if (items.length === 0) {
      console.warn("[NewsService] No items found for Freddie Mac");
      return null;
    }

    console.log(
      `[NewsService] Freddie Mac: Found ${
        items.length
      } items. First: "${items[0].title.substring(0, 50)}..."`
    );

    return {
      source: "Freddie Mac",
      icon: "BarChart3",
      color: "text-indigo-600 dark:text-indigo-400",
      bg: "bg-indigo-50 dark:bg-indigo-950/20",
      summary:
        "Freddie Mac provides market insights, economic research, and policy updates on GSE guidelines, market trends, and regulatory changes.",
      items: items.slice(0, 2),
      enabledByDefault: true,
    };
  } catch (error: any) {
    console.error("[NewsService] Freddie Mac scrape failed:", error.message);
    return null;
  }
}

/**
 * Scrape CFPB news
 */
async function scrapeCFPB(): Promise<NewsSource | null> {
  try {
    console.log("[NewsService] Scraping CFPB...");
    const response = await axios.get(
      "https://www.consumerfinance.gov/about-us/newsroom/",
      axiosConfig
    );
    const $ = cheerio.load(response.data);
    const items: NewsItem[] = [];

    // CFPB has h3 tags with links inside for headlines
    $('h3 a[href*="/about-us/newsroom/"]').each((i, elem) => {
      if (items.length >= 3) return false;

      const $elem = $(elem);
      const href = $elem.attr("href") || "";
      let title = $elem.text().trim();

      // Skip if it's just the newsroom page itself
      if (href.endsWith("/newsroom/") || href.endsWith("/newsroom")) return;
      if (!title || title.length < 20 || title.length > 250) return;

      // Look for date - CFPB has "PublishedJAN 12, 2026" format
      let pubDate = new Date();
      const article = $elem.closest("article, .o-post-preview, div");
      const articleText = article.text();
      const dateMatch = articleText.match(
        /Published([A-Z]{3})\s+(\d{1,2}),?\s+(\d{4})/i
      );
      if (dateMatch) {
        pubDate = parseDate(`${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`);
      }

      const link = href.startsWith("http")
        ? href
        : `https://www.consumerfinance.gov${href}`;

      if (!items.some((item) => item.title === title)) {
        items.push({
          title,
          time: getTimeAgo(pubDate),
          date: pubDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
          link,
        });
      }
    });

    if (items.length === 0) {
      console.warn("[NewsService] No items found for CFPB");
      return null;
    }

    console.log(
      `[NewsService] CFPB: Found ${
        items.length
      } items. First: "${items[0].title.substring(0, 50)}..."`
    );

    return {
      source: "CFPB",
      icon: "AlertTriangle",
      color: "text-rose-600 dark:text-rose-400",
      bg: "bg-rose-50 dark:bg-rose-950/20",
      summary:
        "The Consumer Financial Protection Bureau issues regulations and enforcement actions that impact mortgage lending operations. Critical for compliance.",
      items: items.slice(0, 2),
      enabledByDefault: true,
    };
  } catch (error: any) {
    console.error("[NewsService] CFPB scrape failed:", error.message);
    return null;
  }
}

/**
 * Scrape FHFA news
 */
async function scrapeFHFA(): Promise<NewsSource | null> {
  try {
    console.log("[NewsService] Scraping FHFA...");
    // Try the main FHFA site
    const response = await axios.get("https://www.fhfa.gov/news", axiosConfig);
    const $ = cheerio.load(response.data);
    const items: NewsItem[] = [];

    // Look for news links
    $('a[href*="/news/"]').each((i, elem) => {
      if (items.length >= 3) return false;

      const $elem = $(elem);
      const href = $elem.attr("href") || "";
      let title = $elem.text().trim();

      // Skip navigation and short titles
      if (!title || title.length < 20 || title.length > 200) return;
      if (href === "/news" || href === "/news/" || href.endsWith("/news"))
        return;
      if (
        title.toLowerCase().includes("more news") ||
        title.toLowerCase().includes("news releases")
      )
        return;

      // Look for date
      let pubDate = new Date();
      const parentText = $elem.parent().text();
      const dateMatch = parentText.match(/([A-Za-z]+\s+\d{1,2},?\s+\d{4})/);
      if (dateMatch) {
        pubDate = parseDate(dateMatch[1]);
      }

      const link = href.startsWith("http")
        ? href
        : `https://www.fhfa.gov${href}`;

      if (!items.some((item) => item.title === title)) {
        items.push({
          title,
          time: getTimeAgo(pubDate),
          date: pubDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
          link,
        });
      }
    });

    if (items.length === 0) {
      console.warn("[NewsService] No items found for FHFA");
      return null;
    }

    console.log(
      `[NewsService] FHFA: Found ${
        items.length
      } items. First: "${items[0].title.substring(0, 50)}..."`
    );

    return {
      source: "FHFA",
      icon: "Activity",
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/20",
      summary:
        "The Federal Housing Finance Agency regulates Fannie Mae, Freddie Mac, and the Federal Home Loan Banks. Policy updates affect lending standards.",
      items: items.slice(0, 2),
      enabledByDefault: true,
    };
  } catch (error: any) {
    console.error("[NewsService] FHFA scrape failed:", error.message);
    return null;
  }
}

/**
 * Fetch National Mortgage News RSS
 */
async function fetchNationalMortgageNews(): Promise<NewsSource | null> {
  try {
    console.log("[NewsService] Fetching National Mortgage News RSS...");
    const feed = await rssParser.parseURL(
      "https://www.nationalmortgagenews.com/feed"
    );

    if (!feed?.items?.length) return null;

    const items: NewsItem[] = feed.items.slice(0, 3).map((item: any) => {
      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      return {
        title: (item.title || "Untitled").trim(),
        time: pubDate.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
        date: pubDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        link: item.link || "https://www.nationalmortgagenews.com/",
        publishedAt: pubDate.toISOString(),
        excerpt: (item.contentSnippet || "").trim(),
      };
    });

    console.log(
      `[NewsService] National Mortgage News: ${
        items.length
      } items. First: "${items[0]?.title?.substring(0, 50)}..."`
    );

    return {
      source: "National Mortgage News",
      icon: "Newspaper",
      color: "text-orange-600 dark:text-orange-400",
      bg: "bg-orange-50 dark:bg-orange-950/20",
      summary:
        "National Mortgage News provides breaking news and analysis on mortgage rates, regulations, compliance, and industry trends.",
      items: items.slice(0, 2),
      enabledByDefault: false,
    };
  } catch (error: any) {
    console.error(
      "[NewsService] National Mortgage News RSS failed:",
      error.message
    );
    return null;
  }
}

/**
 * Fetch Mortgage News Daily RSS
 */
async function fetchMortgageNewsDaily(): Promise<NewsSource | null> {
  try {
    console.log("[NewsService] Fetching Mortgage News Daily RSS...");
    const feed = await rssParser.parseURL(
      "http://www.mortgagenewsdaily.com/rss/news"
    );

    if (!feed?.items?.length) return null;

    const items: NewsItem[] = feed.items.slice(0, 3).map((item: any) => {
      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      return {
        title: (item.title || "Untitled").trim(),
        time: pubDate.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
        date: pubDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        link: item.link || "https://www.mortgagenewsdaily.com/",
        publishedAt: pubDate.toISOString(),
        excerpt: (item.contentSnippet || "").trim(),
      };
    });

    console.log(
      `[NewsService] Mortgage News Daily: ${
        items.length
      } items. First: "${items[0]?.title?.substring(0, 50)}..."`
    );

    return {
      source: "Mortgage News Daily",
      icon: "Newspaper",
      color: "text-cyan-600 dark:text-cyan-400",
      bg: "bg-cyan-50 dark:bg-cyan-950/20",
      summary:
        "Mortgage News Daily offers daily mortgage rate updates, MBS market commentary, and industry news.",
      items: items.slice(0, 2),
      enabledByDefault: false,
    };
  } catch (error: any) {
    console.error(
      "[NewsService] Mortgage News Daily RSS failed:",
      error.message
    );
    return null;
  }
}

/**
 * Fetch MND Rate Watch RSS
 */
async function fetchMNDRateWatch(): Promise<NewsSource | null> {
  try {
    console.log("[NewsService] Fetching MND Rate Watch RSS...");
    const feed = await rssParser.parseURL(
      "http://www.mortgagenewsdaily.com/rss/rates"
    );

    if (!feed?.items?.length) return null;

    const items: NewsItem[] = feed.items.slice(0, 3).map((item: any) => {
      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      return {
        title: (item.title || "Untitled").trim(),
        time: pubDate.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
        date: pubDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        link: item.link || "https://www.mortgagenewsdaily.com/mortgage-rates/",
        publishedAt: pubDate.toISOString(),
        excerpt: (item.contentSnippet || "").trim(),
      };
    });

    console.log(
      `[NewsService] MND Rate Watch: ${
        items.length
      } items. First: "${items[0]?.title?.substring(0, 50)}..."`
    );

    return {
      source: "MND Rate Watch",
      icon: "BarChart3",
      color: "text-pink-600 dark:text-pink-400",
      bg: "bg-pink-50 dark:bg-pink-950/20",
      summary:
        "Mortgage rate analysis and daily rate movements, helping lenders stay informed on rate lock timing.",
      items: items.slice(0, 2),
      enabledByDefault: false,
    };
  } catch (error: any) {
    console.error("[NewsService] MND Rate Watch RSS failed:", error.message);
    return null;
  }
}

/**
 * Fetch Federal Reserve press releases (policy/rates/macroeconomic context)
 */
async function fetchFederalReserveNews(): Promise<NewsSource | null> {
  try {
    console.log("[NewsService] Fetching Federal Reserve RSS...");
    const feed = await rssParser.parseURL(
      "https://www.federalreserve.gov/feeds/press_all.xml"
    );

    if (!feed?.items?.length) return null;

    const items: NewsItem[] = feed.items.slice(0, 4).map((item: any) => {
      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      return {
        title: (item.title || "Untitled").trim(),
        time: pubDate.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
        date: pubDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        link: item.link || "https://www.federalreserve.gov/newsevents.htm",
        publishedAt: pubDate.toISOString(),
        excerpt: (item.contentSnippet || "").trim(),
      };
    });

    console.log(
      `[NewsService] Federal Reserve: ${
        items.length
      } items. First: "${items[0]?.title?.substring(0, 50)}..."`
    );

    return {
      source: "Federal Reserve",
      icon: "Activity",
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950/20",
      summary:
        "Federal Reserve press releases and policy communications relevant to rates, liquidity, and mortgage market conditions.",
      items: items.slice(0, 2),
      enabledByDefault: true,
    };
  } catch (error: any) {
    console.error("[NewsService] Federal Reserve RSS failed:", error.message);
    return null;
  }
}

/**
 * Fetch Reuters business feed and filter for lending/mortgage/Fed topics
 */
async function fetchReutersLendingNews(): Promise<NewsSource | null> {
  try {
    console.log("[NewsService] Fetching Reuters business RSS...");
    const feed = await rssParser.parseURL(
      "https://feeds.reuters.com/reuters/businessNews"
    );

    if (!feed?.items?.length) return null;

    const keywords = [
      "mortgage",
      "lending",
      "loan",
      "federal reserve",
      "fed",
      "treasury",
      "housing",
      "real estate",
      "refinance",
      "rates",
    ];

    const filteredItems = feed.items.filter((item: any) => {
      const haystack = `${item?.title || ""} ${item?.contentSnippet || ""}`.toLowerCase();
      return keywords.some((keyword) => haystack.includes(keyword));
    });

    if (!filteredItems.length) return null;

    const items: NewsItem[] = filteredItems.slice(0, 4).map((item: any) => {
      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      return {
        title: (item.title || "Untitled").trim(),
        time: pubDate.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
        date: pubDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        link: item.link || "https://www.reuters.com/business/",
        publishedAt: pubDate.toISOString(),
        excerpt: (item.contentSnippet || "").trim(),
      };
    });

    console.log(
      `[NewsService] Reuters Lending: ${
        items.length
      } items. First: "${items[0]?.title?.substring(0, 50)}..."`
    );

    return {
      source: "Reuters",
      icon: "Newspaper",
      color: "text-slate-700 dark:text-slate-300",
      bg: "bg-slate-100 dark:bg-slate-800/40",
      summary:
        "National business coverage filtered for mortgage, lending, Federal Reserve, and rates-related breaking developments.",
      items: items.slice(0, 2),
      enabledByDefault: true,
    };
  } catch (error: any) {
    console.error("[NewsService] Reuters business RSS failed:", error.message);
    return null;
  }
}

/**
 * Get default news item for a source when scraping fails
 */
function getDefaultForSource(
  sourceName: string,
  url: string,
  config: Partial<NewsSource>
): NewsSource {
  const today = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return {
    source: sourceName,
    icon: config.icon || "Newspaper",
    color: config.color || "text-slate-600 dark:text-slate-400",
    bg: config.bg || "bg-slate-50 dark:bg-slate-950/20",
    summary: config.summary || "",
    items: [
      {
        title: `Visit ${sourceName} for the latest updates`,
        time: "Now",
        date: today,
        link: url,
        excerpt: "",
        relevanceScore: 0,
      },
    ],
    enabledByDefault: config.enabledByDefault ?? true,
  };
}

const EXEC_KEYWORDS = [
  "mortgage",
  "lending",
  "loan",
  "bank",
  "banking",
  "fintech",
  "federal reserve",
  "fed",
  "rates",
  "treasury",
  "mbs",
  "housing",
  "compliance",
  "regulation",
  "servicing",
  "origination",
];

function heuristicRelevanceScore(title: string, source: string, date?: string): number {
  const haystack = `${title} ${source}`.toLowerCase();
  let score = 10;
  for (const keyword of EXEC_KEYWORDS) {
    if (haystack.includes(keyword)) score += 7;
  }

  // Slight recency bonus for "today" headlines.
  if (date) {
    const parsed = parseDate(date);
    const ageDays = Math.max(
      0,
      Math.floor((Date.now() - parsed.getTime()) / (24 * 60 * 60 * 1000))
    );
    score += Math.max(0, 12 - ageDays * 2);
  }

  return Math.min(100, score);
}

async function rankHeadlinesForExecutives(results: NewsSource[]): Promise<void> {
  const allItems: Array<{
    id: string;
    source: string;
    title: string;
    date: string;
    itemRef: NewsItem;
  }> = [];

  results.forEach((source, sourceIdx) => {
    source.items.forEach((item, itemIdx) => {
      const id = `${sourceIdx}-${itemIdx}`;
      allItems.push({
        id,
        source: source.source,
        title: item.title,
        date: item.date,
        itemRef: item,
      });
    });
  });

  if (!allItems.length) return;

  // Start with heuristic score.
  allItems.forEach((entry) => {
    entry.itemRef.relevanceScore = heuristicRelevanceScore(
      entry.title,
      entry.source,
      entry.date
    );
  });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;

  try {
    const payload = allItems
      .map((entry) => `${entry.id} | ${entry.source} | ${entry.date} | ${entry.title}`)
      .join("\n");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are ranking news for C-suite lending executives. Prioritize mortgage banking, lending, Federal Reserve policy, banking/fintech disruption, compliance and macro risk. Return JSON: {\"rankings\":[{\"id\":\"...\",\"score\":0-100}]}.",
          },
          {
            role: "user",
            content: `Rank these headlines by relevance:\n${payload}`,
          },
        ],
      }),
    });

    if (!response.ok) return;
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return;
    const parsed = JSON.parse(content) as {
      rankings?: Array<{ id: string; score: number }>;
    };

    const rankMap = new Map<string, number>();
    (parsed.rankings || []).forEach((r) => rankMap.set(r.id, r.score));

    allItems.forEach((entry) => {
      const aiScore = rankMap.get(entry.id);
      if (typeof aiScore === "number") {
        entry.itemRef.relevanceScore = Math.max(
          entry.itemRef.relevanceScore || 0,
          Math.min(100, aiScore)
        );
      }
    });
  } catch (error: any) {
    console.warn("[NewsService] AI ranking failed:", error.message);
  }
}

/**
 * Fetch all news sources
 */
async function fetchAllNews(): Promise<NewsSource[]> {
  console.log("[NewsService] Fetching news from all sources...");

  const results: NewsSource[] = [];

  // Scrape HTML sources in parallel
  const [mba, fannieMae, freddieMac, cfpb, fhfa] = await Promise.all([
    scrapeMBA(),
    scrapeFannieMae(),
    scrapeFreddieMac(),
    scrapeCFPB(),
    scrapeFHFA(),
  ]);

  // Add results or defaults
  results.push(
    mba ||
      getDefaultForSource("MBA", "https://newslink.mba.org/", {
        icon: "Building2",
        color: "text-blue-600 dark:text-blue-400",
        bg: "bg-blue-50 dark:bg-blue-950/20",
        summary:
          "The Mortgage Bankers Association provides market analysis and industry insights.",
        enabledByDefault: true,
      })
  );

  results.push(
    fannieMae ||
      getDefaultForSource(
        "Fannie Mae",
        "https://www.fanniemae.com/newsroom/fannie-mae-news",
        {
          icon: "TrendingUp",
          color: "text-purple-600 dark:text-purple-400",
          bg: "bg-purple-50 dark:bg-purple-950/20",
          summary:
            "Fannie Mae provides housing market research and economic forecasts.",
          enabledByDefault: true,
        }
      )
  );

  results.push(
    freddieMac ||
      getDefaultForSource("Freddie Mac", "https://www.freddiemac.com/news", {
        icon: "BarChart3",
        color: "text-indigo-600 dark:text-indigo-400",
        bg: "bg-indigo-50 dark:bg-indigo-950/20",
        summary: "Freddie Mac provides market insights and policy updates.",
        enabledByDefault: true,
      })
  );

  results.push(
    cfpb ||
      getDefaultForSource(
        "CFPB",
        "https://www.consumerfinance.gov/about-us/newsroom/",
        {
          icon: "AlertTriangle",
          color: "text-rose-600 dark:text-rose-400",
          bg: "bg-rose-50 dark:bg-rose-950/20",
          summary:
            "CFPB issues regulations and enforcement actions impacting mortgage lending.",
          enabledByDefault: true,
        }
      )
  );

  results.push(
    fhfa ||
      getDefaultForSource("FHFA", "https://www.fhfa.gov/news", {
        icon: "Activity",
        color: "text-emerald-600 dark:text-emerald-400",
        bg: "bg-emerald-50 dark:bg-emerald-950/20",
        summary:
          "FHFA regulates Fannie Mae, Freddie Mac, and Federal Home Loan Banks.",
        enabledByDefault: true,
      })
  );

  // Fetch RSS sources in parallel
  const [nmn, mnd, mndRates, fed, reuters] = await Promise.all([
    fetchNationalMortgageNews(),
    fetchMortgageNewsDaily(),
    fetchMNDRateWatch(),
    fetchFederalReserveNews(),
    fetchReutersLendingNews(),
  ]);

  if (nmn) results.push(nmn);
  else
    results.push(
      getDefaultForSource(
        "National Mortgage News",
        "https://www.nationalmortgagenews.com/",
        {
          icon: "Newspaper",
          color: "text-orange-600 dark:text-orange-400",
          bg: "bg-orange-50 dark:bg-orange-950/20",
          summary:
            "Breaking news on mortgage rates, regulations, and industry trends.",
          enabledByDefault: false,
        }
      )
    );

  if (mnd) results.push(mnd);
  else
    results.push(
      getDefaultForSource(
        "Mortgage News Daily",
        "https://www.mortgagenewsdaily.com/",
        {
          icon: "Newspaper",
          color: "text-cyan-600 dark:text-cyan-400",
          bg: "bg-cyan-50 dark:bg-cyan-950/20",
          summary: "Daily mortgage rate updates and MBS market commentary.",
          enabledByDefault: false,
        }
      )
    );

  if (mndRates) results.push(mndRates);
  else
    results.push(
      getDefaultForSource(
        "MND Rate Watch",
        "https://www.mortgagenewsdaily.com/mortgage-rates/",
        {
          icon: "BarChart3",
          color: "text-pink-600 dark:text-pink-400",
          bg: "bg-pink-50 dark:bg-pink-950/20",
          summary: "Mortgage rate analysis and daily rate movements.",
          enabledByDefault: false,
        }
      )
    );

  if (fed) results.push(fed);
  else
    results.push(
      getDefaultForSource(
        "Federal Reserve",
        "https://www.federalreserve.gov/newsevents.htm",
        {
          icon: "Activity",
          color: "text-amber-600 dark:text-amber-400",
          bg: "bg-amber-50 dark:bg-amber-950/20",
          summary:
            "Federal Reserve policy and press updates relevant to lending and mortgage markets.",
          enabledByDefault: true,
        }
      )
    );

  if (reuters) results.push(reuters);
  else
    results.push(
      getDefaultForSource("Reuters", "https://www.reuters.com/business/", {
        icon: "Newspaper",
        color: "text-slate-700 dark:text-slate-300",
        bg: "bg-slate-100 dark:bg-slate-800/40",
        summary:
          "National business coverage relevant to lending, rates, and Federal Reserve developments.",
        enabledByDefault: true,
      })
    );

  const successCount = results.filter(
    (r) => r.items.length > 0 && !r.items[0].title.includes("Visit ")
  ).length;

  await rankHeadlinesForExecutives(results);

  // Sort each source by executive relevance + recency.
  results.forEach((source) => {
    source.items.sort((a, b) => {
      const scoreDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const aDate = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const bDate = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return bDate - aDate;
    });
  });

  console.log(
    `[NewsService] Completed: ${successCount}/${results.length} sources with real articles`
  );

  return results;
}

/**
 * Get industry news from all sources
 */
export async function getIndustryNews(): Promise<{
  newsFeed: NewsSource[];
  lastUpdated: string;
  error?: string;
  fromCache?: boolean;
}> {
  // Check cache
  if (newsCache && Date.now() - newsCache.timestamp < CACHE_TTL_MS) {
    console.log("[NewsService] Returning cached data");
    return {
      newsFeed: newsCache.data,
      lastUpdated: new Date(newsCache.timestamp).toISOString(),
      fromCache: true,
    };
  }

  console.log("[NewsService] Cache miss, fetching fresh...");

  try {
    const newsFeed = await fetchAllNews();

    newsCache = {
      data: newsFeed,
      timestamp: Date.now(),
    };

    return {
      newsFeed,
      lastUpdated: new Date().toISOString(),
    };
  } catch (err: any) {
    console.error("[NewsService] Error:", err);

    if (newsCache) {
      return {
        newsFeed: newsCache.data,
        lastUpdated: new Date(newsCache.timestamp).toISOString(),
        error: "Using cached data due to fetch error",
        fromCache: true,
      };
    }

    return {
      newsFeed: [],
      lastUpdated: new Date().toISOString(),
      error: "Failed to fetch news",
    };
  }
}

/**
 * Clear the news cache
 */
export function clearNewsCache(): void {
  newsCache = null;
  console.log("[NewsService] Cache cleared");
}

export interface NewsDetailRequest {
  title: string;
  source: string;
  link: string;
}

export interface NewsDetailResponse {
  articleParagraphs: string[];
  fullArticleUrl: string;
  fetchedAt: string;
  error?: string;
}

async function extractArticleParagraphs(url: string): Promise<string[]> {
  const response = await axios.get(url, axiosConfig);
  const $ = cheerio.load(response.data);
  $("script, style, nav, footer, header, aside, form, noscript").remove();

  const paragraphs: string[] = [];
  $("article p, main p, p").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length < 80 || text.length > 800) return;
    if (!paragraphs.includes(text)) paragraphs.push(text);
  });

  return paragraphs.slice(0, 18);
}

function fallbackArticleParagraphs(title: string, source: string): string[] {
  return [
    `We could not extract article body text from ${source} for "${title}".`,
    "Use the full article view below to read the complete source content directly from the publisher.",
    "Cohi insights remain available to help summarize likely implications for lending operations and market strategy.",
  ];
}

export async function generateNewsDetails(
  article: NewsDetailRequest
): Promise<NewsDetailResponse> {
  try {
    const paragraphs = await extractArticleParagraphs(article.link);
    const articleParagraphs = paragraphs.slice(0, 5);
    return {
      articleParagraphs:
        articleParagraphs.length >= 3
          ? articleParagraphs
          : fallbackArticleParagraphs(article.title, article.source),
      fullArticleUrl: article.link,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error("[NewsDetails] Failed to generate details:", error.message);
    return {
      articleParagraphs: fallbackArticleParagraphs(article.title, article.source),
      fullArticleUrl: article.link,
      fetchedAt: new Date().toISOString(),
      error: "Could not load article details",
    };
  }
}

// ============================================================================
// AI-Powered News Insights
// ============================================================================

export interface NewsInsightRequest {
  title: string;
  source: string;
  link: string;
  sourceSummary?: string;
}

export interface NewsInsightResponse {
  insights: Array<{
    type: "pipeline" | "competitive" | "compliance" | "market" | "action";
    label: string;
    content: string;
    color: string;
  }>;
  clientDataSummary?: string;
  error?: string;
}

/**
 * Generate AI-powered insights for a news article
 * Analyzes the article and relates it to the client's loan data
 */
export async function generateNewsInsights(
  article: NewsInsightRequest,
  tenantId: string,
  clientMetrics?: Record<string, any>
): Promise<NewsInsightResponse> {
  // Import dynamically to avoid circular dependencies
  const { tenantDbManager } = await import(
    "../config/tenantDatabaseManager.js"
  );
  const { decryptAPIKeys } = await import("./encryption.js");

  // Get OpenAI API key
  let apiKey = process.env.OPENAI_API_KEY;

  try {
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);
    const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'rag_settings'
      ) as exists
    `);

    if (tableCheck.rows[0]?.exists) {
      const result = await tenantPool.query(
        `SELECT openai_api_key FROM public.rag_settings LIMIT 1`
      );
      if (result.rows[0]?.openai_api_key) {
        const decrypted = await decryptAPIKeys({
          openai_api_key: result.rows[0].openai_api_key,
        });
        if (decrypted.openai_api_key) {
          apiKey = decrypted.openai_api_key;
        }
      }
    }
  } catch (error: any) {
    console.warn("[NewsInsights] Could not get tenant API key:", error.message);
  }

  if (!apiKey) {
    return {
      insights: getDefaultInsights(article),
      error: "AI not configured - showing generic insights",
    };
  }

  // Gather client metrics if not provided
  let metrics = clientMetrics;
  if (!metrics) {
    try {
      metrics = await gatherClientMetrics(tenantId);
    } catch (error: any) {
      console.warn(
        "[NewsInsights] Could not gather client metrics:",
        error.message
      );
    }
  }

  const systemPrompt = `You are Cohi, an AI analytics engine for mortgage lending executives. 
Your job is to analyze industry news articles and provide fact-based insights on their implications for mortgage lenders.

Guidelines:
- Be strictly fact-based — state implications, not recommendations. Never say "consider", "recommend", "you should", or "look into".
- Reference the article content when possible
- When client data is provided, relate insights factually to their specific numbers
- Use professional, precise tone
- Each insight should be 1-2 sentences stating the factual implication
- Focus on what this means for mortgage operations — not what to do about it

Response format (JSON):
{
  "insights": [
    {
      "type": "pipeline|competitive|compliance|market|impact",
      "label": "Short 2-3 word label",
      "content": "The insight content - specific and factual",
      "color": "blue|emerald|rose|amber|violet"
    }
  ],
  "clientDataSummary": "Optional: 1 sentence relating to client's specific data if provided"
}

Insight types:
- pipeline: Impact on loan pipeline, volume, processing
- competitive: Competitive positioning, market landscape changes
- compliance: Regulatory implications, risk exposure
- market: Market trends, rate movements, economic factors
- impact: Direct operational or financial impact (no suggested actions)`;

  const userPrompt = `Analyze this industry news article and provide 3 insights for a mortgage lending executive:

**Article Title:** ${article.title}
**Source:** ${article.source}
**Source Context:** ${article.sourceSummary || "Industry news source"}

${metrics ? formatMetricsForPrompt(metrics) : ""}

Provide 3 specific, actionable insights based on this article. If client data is provided, include one insight that specifically relates to their data.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 800,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const error = (await response.json()) as { error?: { message?: string } };
      throw new Error(error.error?.message || "OpenAI API error");
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content || "";

    const parsed = JSON.parse(content);
    return {
      insights: parsed.insights || getDefaultInsights(article),
      clientDataSummary: parsed.clientDataSummary,
    };
  } catch (error: any) {
    console.error("[NewsInsights] AI generation failed:", error.message);
    return {
      insights: getDefaultInsights(article),
      error: "Could not generate AI insights",
    };
  }
}

/**
 * Gather basic client metrics for context
 */
async function gatherClientMetrics(
  tenantId: string
): Promise<Record<string, any>> {
  const { tenantDbManager } = await import(
    "../config/tenantDatabaseManager.js"
  );
  const pool = await tenantDbManager.getTenantPool(tenantId);
  const metrics: Record<string, any> = {};

  try {
    // Get basic loan metrics
    const summary = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE current_loan_status = 'Active Loan') as active_loans,
        COUNT(*) FILTER (WHERE funding_date >= CURRENT_DATE - INTERVAL '30 days') as funded_30d,
        COALESCE(SUM(loan_amount) FILTER (WHERE application_date >= CURRENT_DATE - INTERVAL '30 days'), 0) as volume_30d,
        COALESCE(AVG(interest_rate) FILTER (WHERE application_date >= CURRENT_DATE - INTERVAL '30 days'), 0) as avg_rate
      FROM public.loans
    `);
    metrics.summary = summary.rows[0];

    // Get loan type mix
    const loanTypes = await pool.query(`
      SELECT loan_type, COUNT(*) as count
      FROM public.loans
      WHERE application_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY loan_type
      ORDER BY count DESC
      LIMIT 3
    `);
    metrics.topLoanTypes = loanTypes.rows;
  } catch (error: any) {
    console.warn("[NewsInsights] Metrics query failed:", error.message);
  }

  return metrics;
}

/**
 * Format metrics for AI prompt
 */
function formatMetricsForPrompt(metrics: Record<string, any>): string {
  if (!metrics.summary) return "";

  const summary = metrics.summary;
  const volume = Number(summary.volume_30d) || 0;
  const volumeStr =
    volume >= 1000000
      ? `$${(volume / 1000000).toFixed(1)}M`
      : `$${(volume / 1000).toFixed(0)}K`;

  let prompt = `\n**Client's Current Data (Last 30 Days):**
- Active Pipeline: ${summary.active_loans || 0} loans
- Recently Funded: ${summary.funded_30d || 0} loans
- Volume: ${volumeStr}
- Average Rate: ${(Number(summary.avg_rate) || 0).toFixed(2)}%`;

  if (metrics.topLoanTypes?.length > 0) {
    const types = metrics.topLoanTypes
      .map((t: any) => `${t.loan_type}: ${t.count}`)
      .join(", ");
    prompt += `\n- Top Loan Types: ${types}`;
  }

  return prompt;
}

/**
 * Get default insights when AI is not available
 */
function getDefaultInsights(
  article: NewsInsightRequest
): NewsInsightResponse["insights"] {
  const title = article.title.toLowerCase();

  if (title.includes("rate") || title.includes("mortgage")) {
    return [
      {
        type: "pipeline",
        label: "Pipeline Impact",
        content:
          "Rate movements may affect application volume and lock timing decisions. Monitor pipeline closely.",
        color: "blue",
      },
      {
        type: "competitive",
        label: "Market Opportunity",
        content:
          "Consider proactive outreach to borrowers who may benefit from rate changes.",
        color: "emerald",
      },
      {
        type: "action",
        label: "Recommended Action",
        content:
          "Review rate lock policies and ensure pricing team is aligned with market conditions.",
        color: "violet",
      },
    ];
  }

  if (
    title.includes("compliance") ||
    title.includes("regulation") ||
    title.includes("cfpb")
  ) {
    return [
      {
        type: "compliance",
        label: "Compliance Alert",
        content:
          "New regulatory guidance may require process updates. Schedule compliance review.",
        color: "rose",
      },
      {
        type: "action",
        label: "Immediate Action",
        content:
          "Brief compliance team and assess impact on current loan pipeline.",
        color: "violet",
      },
      {
        type: "competitive",
        label: "Positioning",
        content:
          "Early adoption of compliance changes can differentiate your organization.",
        color: "emerald",
      },
    ];
  }

  // Default generic insights
  return [
    {
      type: "market",
      label: "Market Signal",
      content:
        "This development may indicate broader industry trends. Monitor for follow-up announcements.",
      color: "blue",
    },
    {
      type: "competitive",
      label: "Strategic Fit",
      content:
        "Evaluate how this aligns with your current market positioning and growth strategy.",
      color: "emerald",
    },
    {
      type: "action",
      label: "Next Steps",
      content:
        "Consider discussing implications with leadership team within 48 hours.",
      color: "violet",
    },
  ];
}
