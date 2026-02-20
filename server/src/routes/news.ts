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

const router = Router();

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

export default router;
