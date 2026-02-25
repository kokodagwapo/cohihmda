import { Express } from "express";
import authRoutes from "./auth.js";
import { cognitoAuth, mfaRoutes } from "./auth/index.js";
import subscriptionsRoutes from "./subscriptions.js";
import ragRoutes from "./rag.js";
import metricsRoutes from "./metrics.js";
import dashboardRoutes from "./dashboard.js";
import adminRoutes from "./admin.js";
import losRoutes from "./los.js";
import synapseRoutes from "./synapse.js";
import loansRoutes from "./loans.js";
import scorecardRoutes from "./scorecard/index.js";
import toptieringRoutes from "./toptiering/index.js";
import predictionsRoutes from "./predictions/index.js";
import falloutRoutes from "./fallout/index.js";
import pricingDashboardRoutes from "./pricingDashboard/index.js";
import userPreferencesRoutes from "./userPreferences.js";
import encompassRoutes from "./encompass.js";
import tenantRoutes from "./tenants.js";
import tenantConfigRoutes from "./tenantConfig.js";
import cohiChatRoutes from "./cohiChat.js";
import cohiWorkbenchRoutes from "./cohiWorkbench.js";
import ragKnowledgeBaseRouter from "./ragKnowledgeBase.js";
import dataQualityRoutes from "./dataQuality.js";
import newsRoutes from "./news.js";
import globalKnowledgeRoutes from "./admin/globalKnowledge.js";
import aiPromptsRoutes from "./admin/aiPrompts.js";
import platformSettingsRoutes from "./admin/platformSettings.js";
import tenantConfigExportRoutes from "./admin/tenantConfigExport.js";
import insightFeedbackRoutes from "./admin/insightFeedback.js";
import knowledgeCenterRoutes from "./knowledgeCenter.js";
import workbenchRoutes from "./workbench.js";
import reportRoutes from "./reports.js";
import researchRoutes from "./research.js";
import trackedInsightRoutes from "./trackedInsights.js";
import onboardingRoutes from "./onboarding.js";
import jobsRoutes from "./jobs.js";
import helpContentRoutes from "./helpContent.js";
import { pool, resetPool } from "../config/database.js";
import { setupMockLosApi } from "../services/mockLosApi.js";
import { getVersionInfo } from "../services/versionService.js";
import { globalTenantContext } from "../middleware/tenantContext.js";
import crypto from "crypto";

export function setupRoutes(app: Express) {
  // Setup Mock LOS API (for testing without real LOS accounts)
  // Only enable in development or when MOCK_LOS_API=true
  if (
    process.env.MOCK_LOS_API === "true" ||
    process.env.NODE_ENV !== "production"
  ) {
    setupMockLosApi(app, "/mock-los");
    console.log("✅ Mock LOS API enabled - use mock API endpoints for testing");
  }

  // Global tenant context middleware — defense-in-depth layer that silently
  // attaches tenant context to authenticated requests so new routes get it
  // by default even if the developer forgets attachTenantContext.
  app.use("/api", globalTenantContext);

  app.use("/api/auth", authRoutes);
  app.use("/api/auth/cognito", cognitoAuth);
  app.use("/api/auth/mfa", mfaRoutes);

  // SaaS & Enterprise Features
  app.use("/api/subscriptions", subscriptionsRoutes);
  app.use("/api/rag", ragRoutes);
  app.use("/api/rag/knowledge-base", ragKnowledgeBaseRouter);
  app.use("/api/metrics", metricsRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/los", losRoutes);
  app.use("/api/synapse", synapseRoutes);
  app.use("/api/loans", loansRoutes);
  app.use("/api/scorecard", scorecardRoutes);
  app.use("/api/toptiering", toptieringRoutes);
  app.use("/api/pricing-dashboard", pricingDashboardRoutes);
  app.use("/api/predictions", predictionsRoutes);
  app.use("/api/fallout", falloutRoutes);
  app.use("/api/user", userPreferencesRoutes);
  app.use("/api/encompass", encompassRoutes);
  app.use("/api/tenants", tenantRoutes);
  app.use("/api/tenant-config", tenantConfigRoutes);
  app.use("/api/cohi-chat", cohiChatRoutes); // Cohi Chat service
  app.use("/api/cohi-chat/workbench", cohiWorkbenchRoutes); // Workbench AI assistant
  app.use("/api/data-quality", dataQualityRoutes);
  app.use("/api/news", newsRoutes);
  app.use("/api/admin/global-knowledge", globalKnowledgeRoutes);
  app.use("/api/admin/ai-prompts", aiPromptsRoutes);
  app.use("/api/admin/platform-settings", platformSettingsRoutes);
  app.use("/api/admin/tenant-config-transfer", tenantConfigExportRoutes);
  app.use("/api/admin/insight-feedback", insightFeedbackRoutes);
  app.use("/api/knowledge-center", knowledgeCenterRoutes);
  app.use("/api/workbench/canvases", workbenchRoutes); // Workbench canvas CRUD (tenant DB)
  app.use("/api/workbench/reports", reportRoutes); // Report generation (PPTX/PDF)
  app.use("/api/research", researchRoutes); // Research Analyst agentic system
  app.use("/api/insights/tracked", trackedInsightRoutes); // Tracked insights watchlist
  app.use("/api/onboarding", onboardingRoutes); // Onboarding analysis agent
  app.use("/api/jobs", jobsRoutes); // Async job status polling
  app.use("/api/help", helpContentRoutes); // Help content RAG seeding

  // Health check handler (shared by both /health and /api/health)
  const healthCheckHandler = async (req: any, res: any) => {
    const versionInfo = getVersionInfo();
    const dbHost = (process.env.DB_HOST || "").trim();
    const dbHostHash = dbHost
      ? crypto.createHash("sha256").update(dbHost).digest("hex").slice(0, 10)
      : null;
    const health: any = {
      status: "ok",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      uptime: process.uptime(),
      database: "unknown",
      version: {
        version: versionInfo.version,
        commit: versionInfo.commit.short,
        branch: versionInfo.branch,
        buildTime: versionInfo.buildTime,
      },
      config: {
        hasJwtSecret: !!process.env.JWT_SECRET,
        jwtSecretLength: process.env.JWT_SECRET?.length || 0,
        hasDbHost: !!process.env.DB_HOST,
        dbHostHash,
        hasDbName: !!process.env.DB_NAME,
        hasDbUser: !!process.env.DB_USER,
        hasDbPassword: !!process.env.DB_PASSWORD,
        dbPort: process.env.DB_PORT || "5432",
        nodeEnv: process.env.NODE_ENV,
      },
    };

    // Check database connection with timeout (non-blocking)
    if (process.env.SKIP_DB !== "true") {
      try {
        // Use Promise.race to timeout database check after 5 seconds
        // (2s was too tight — page load fires 20+ concurrent queries that can saturate the pool)
        const dbCheck = Promise.race([
          pool.query("SELECT NOW(), current_database(), version()"),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Database query timeout")), 5000)
          ),
        ]);

        const result = (await dbCheck) as any;
        health.database = "connected";
        health.databaseInfo = {
          connected: true,
          database: result.rows[0]?.current_database || "unknown",
          serverTime: result.rows[0]?.now || null,
        };
      } catch (error: any) {
        // Database is disconnected, but server is still running
        health.database = "disconnected";
        health.status = "degraded";
        health.databaseError =
          error.message || "Database connection check failed";
        health.databaseInfo = {
          connected: false,
          error: error.message,
          errorCode: error.code,
          errorType: error.constructor?.name,
        };
        // Log the actual failure so we can tell ECONNREFUSED vs ETIMEDOUT vs auth
        console.warn("Health check: Database unreachable:", {
          code: error.code,
          message: error.message,
          errno: error.errno,
          syscall: error.syscall,
          address: error.address,
          port: error.port,
        });
        // Try to reset the pool to reconnect
        try {
          resetPool();
          console.log(
            "🔄 Reset database pool - next query will attempt reconnection"
          );
        } catch (resetError) {
          console.warn("Could not reset pool:", resetError);
        }
      }
    } else {
      health.database = "skipped";
    }

    // Always return 200 for health check - even if degraded, server is still running
    // Frontend can check the status field to determine if it's degraded
    // This ensures the server is always considered "reachable" even if DB is down
    res.status(200).json(health);
  };

  // Health check endpoints (bypass rate limiting - added before routes)
  // These endpoints must be fast and reliable - used for connection checks
  // Support both /health and /api/health for CloudFront compatibility
  app.get("/health", healthCheckHandler);
  app.get("/api/health", healthCheckHandler);

  // Root endpoint - API information
  app.get("/", (req, res) => {
    const versionInfo = getVersionInfo();
    res.json({
      name: "Coheus API Server",
      version: versionInfo.version,
      commit: versionInfo.commit.short,
      branch: versionInfo.branch,
      buildTime: versionInfo.buildTime,
      status: "running",
      endpoints: {
        health: "/health",
        apiHealth: "/api/health",
        version: "/api/version",
        auth: "/api/auth",
        admin: "/api/admin",
        dashboard: "/api/dashboard",
        rag: "/api/rag",
        loans: "/api/loans",
        scorecard: "/api/scorecard",
        toptiering: "/api/toptiering",
        predictions: "/api/predictions",
        los: "/api/los",
      },
      documentation: "See README.md for API documentation",
    });
  });

  // Version endpoint - Comprehensive version information
  app.get("/api/version", (req, res) => {
    const versionInfo = getVersionInfo();
    res.json(versionInfo);
  });
}
