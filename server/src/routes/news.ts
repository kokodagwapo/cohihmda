import { Router } from "express";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import {
  getIndustryNews,
  clearNewsCache,
  generateNewsInsights,
  NewsInsightRequest,
  generateNewsDetails,
  NewsDetailRequest,
} from "../services/newsService.js";
import { pool as managementPool } from "../config/managementDatabase.js";
import { sendDailyBriefNewsletterPreview } from "../services/dailyBriefNewsletterService.js";

const router = Router();

type DailyBriefPreference = {
  enabled: boolean;
  email: string;
};

/**
 * GET /api/news
 * Get industry news from multiple sources (MBA, Fannie Mae, Freddie Mac, CFPB, FHFA)
 * News is cached for 5 minutes to prevent excessive scraping
 */
router.get("/", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const result = await getIndustryNews();
    res.json(result);
  } catch (error: any) {
    console.error("[News Route] Error fetching news:", error);
    res.status(500).json({
      error: "Failed to fetch industry news",
      newsFeed: [],
      lastUpdated: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/news/refresh
 * Force refresh the news cache
 * Useful for admin or testing purposes
 */
router.post("/refresh", authenticateToken, async (req: AuthRequest, res) => {
  try {
    clearNewsCache();
    const result = await getIndustryNews();
    res.json({
      ...result,
      refreshed: true,
    });
  } catch (error: any) {
    console.error("[News Route] Error refreshing news:", error);
    res.status(500).json({
      error: "Failed to refresh industry news",
      newsFeed: [],
      lastUpdated: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/news/insights
 * Generate AI-powered insights for a specific news article
 * Uses OpenAI to analyze the article and relate it to client's loan data
 */
router.post("/insights", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const article = req.body as NewsInsightRequest;

    if (!article?.title || !article?.source) {
      return res.status(400).json({
        error: "Article title and source are required",
      });
    }

    const tenantId = req.tenantId || "default";
    console.log(
      `[News Route] Generating insights for: "${article.title.substring(
        0,
        50
      )}..." (tenant: ${tenantId})`
    );

    const result = await generateNewsInsights(article, tenantId);
    res.json(result);
  } catch (error: any) {
    console.error("[News Route] Error generating insights:", error);
    res.status(500).json({
      error: "Failed to generate insights",
      insights: [],
    });
  }
});

/**
 * POST /api/news/details
 * Generate a 3-paragraph Cohi brief for a selected headline.
 */
router.post("/details", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const article = req.body as NewsDetailRequest;
    if (!article?.title || !article?.source || !article?.link) {
      return res.status(400).json({
        error: "Article title, source, and link are required",
      });
    }

    const result = await generateNewsDetails(article);
    res.json(result);
  } catch (error: any) {
    console.error("[News Route] Error generating details:", error);
    res.status(500).json({
      error: "Failed to generate article details",
      articleParagraphs: [],
      fullArticleUrl: req.body?.link || "",
      fetchedAt: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/news/newsletter/subscription
 * Get current user's daily brief newsletter preference.
 */
router.get(
  "/newsletter/subscription",
  authenticateToken,
  async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const result = await managementPool.query(
        `
          SELECT preference_value
          FROM user_preferences
          WHERE user_id = $1 AND preference_key = 'dailyBriefEmailSubscription'
          LIMIT 1
        `,
        [req.userId]
      );

      const existing = result.rows[0]?.preference_value as
        | DailyBriefPreference
        | undefined;

      res.json({
        enabled: Boolean(existing?.enabled),
        email: existing?.email || req.userEmail || "",
      });
    } catch (error: any) {
      console.error("[News Route] Error fetching newsletter preference:", error);
      res.status(500).json({ error: "Failed to fetch newsletter preference" });
    }
  }
);

/**
 * PUT /api/news/newsletter/subscription
 * Save current user's daily brief newsletter preference.
 */
router.put(
  "/newsletter/subscription",
  authenticateToken,
  async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const enabled = Boolean(req.body?.enabled);
      const email = String(req.body?.email || req.userEmail || "").trim();

      if (!email || !email.includes("@")) {
        return res.status(400).json({ error: "A valid email is required" });
      }

      const preferenceValue: DailyBriefPreference = { enabled, email };

      await managementPool.query(
        `
          INSERT INTO user_preferences (user_id, preference_key, preference_value)
          VALUES ($1, 'dailyBriefEmailSubscription', $2::jsonb)
          ON CONFLICT (user_id, preference_key)
          DO UPDATE SET preference_value = $2::jsonb, updated_at = NOW()
        `,
        [req.userId, JSON.stringify(preferenceValue)]
      );

      res.json({
        success: true,
        enabled,
        email,
      });
    } catch (error: any) {
      console.error("[News Route] Error saving newsletter preference:", error);
      res.status(500).json({ error: "Failed to save newsletter preference" });
    }
  }
);

/**
 * POST /api/news/newsletter/send-preview
 * Send a preview of the daily brief email to the user.
 */
router.post(
  "/newsletter/send-preview",
  authenticateToken,
  async (req: AuthRequest, res) => {
    try {
      const recipient = String(req.body?.email || req.userEmail || "").trim();
      if (!recipient || !recipient.includes("@")) {
        return res.status(400).json({ error: "A valid recipient email is required" });
      }

      await sendDailyBriefNewsletterPreview(recipient);

      res.json({
        success: true,
        message: "Preview email queued",
        recipient,
      });
    } catch (error: any) {
      console.error("[News Route] Error sending newsletter preview:", error);
      res.status(500).json({ error: "Failed to send preview email" });
    }
  }
);

export default router;
