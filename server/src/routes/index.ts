import { Express } from "express";
import authRoutes from "./auth.js";
import { cognitoAuth } from "./auth/index.js";
import subscriptionsRoutes from "./subscriptions.js";
import ragRoutes from "./rag.js";
import metricsRoutes from "./metrics.js";
import costsRoutes from "./costs.js";
import deploymentsRoutes from "./deployments.js";
import dashboardRoutes from "./dashboard.js";
import adminRoutes from "./admin.js";
import losRoutes from "./los.js";
import synapseRoutes from "./synapse.js";
import loansRoutes from "./loans.js";
import scorecardRoutes from "./scorecard/index.js";
import toptieringRoutes from "./toptiering/index.js";
import predictionsRoutes from "./predictions/index.js";
import fieldMappingsRoutes from "./fieldMappings.js";
import demoRoutes from "./demo.js";
import userPreferencesRoutes from "./userPreferences.js";
import awsHostingRoutes from "./aws-hosting.js";
import encompassRoutes from "./encompass.js";
import tenantRoutes from "./tenants.js";
import tenantConfigRoutes from "./tenantConfig.js";
import dataChatRoutes from "./dataChat.js";
import cohiChatRoutes from "./cohiChat.js";
import cohiRoutes from "./cohi.js";
import ragKnowledgeBaseRouter from "./ragKnowledgeBase.js";
import dataQualityRoutes from "./dataQuality.js";
import newsRoutes from "./news.js";
import globalKnowledgeRoutes from "./admin/globalKnowledge.js";
import aiPromptsRoutes from "./admin/aiPrompts.js";
import platformSettingsRoutes from "./admin/platformSettings.js";
import knowledgeCenterRoutes from "./knowledgeCenter.js";
import shareLinksRoutes from "./shareLinks.js";
import { pool, resetPool } from "../config/database.js";
import { setupMockLosApi } from "../services/mockLosApi.js";
import { getVersionInfo } from "../services/versionService.js";
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

  app.use("/api/auth", authRoutes);
  app.use("/api/auth/cognito", cognitoAuth);

  // SaaS & Enterprise Features
  app.use("/api/subscriptions", subscriptionsRoutes);
  app.use("/api/rag", ragRoutes);
  app.use("/api/rag/knowledge-base", ragKnowledgeBaseRouter);
  app.use("/api/metrics", metricsRoutes);
  app.use("/api/costs", costsRoutes);
  app.use("/api/deployments", deploymentsRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/los", losRoutes);
  app.use("/api/synapse", synapseRoutes);
  app.use("/api/loans", loansRoutes);
  app.use("/api/scorecard", scorecardRoutes);
  app.use("/api/toptiering", toptieringRoutes);
  app.use("/api/predictions", predictionsRoutes);
  app.use("/api/field-mappings", fieldMappingsRoutes);
  app.use("/api/demo", demoRoutes);
  app.use("/api/user", userPreferencesRoutes);
  app.use("/api/aws-hosting", awsHostingRoutes);
  app.use("/api/encompass", encompassRoutes);
  app.use("/api/tenants", tenantRoutes);
  app.use("/api/tenant-config", tenantConfigRoutes);
  app.use("/api/data-chat", dataChatRoutes); // Legacy route - kept for backwards compatibility
  app.use("/api/cohi-chat", cohiChatRoutes); // New hybrid chat service
  app.use("/api/cohi", cohiRoutes); // COHI query (responsePlan + dataPayloads)
  app.use("/api/data-quality", dataQualityRoutes);
  app.use("/api/news", newsRoutes);
  app.use("/api/admin/global-knowledge", globalKnowledgeRoutes);
  app.use("/api/admin/ai-prompts", aiPromptsRoutes);
  app.use("/api/admin/platform-settings", platformSettingsRoutes);
  app.use("/api/knowledge-center", knowledgeCenterRoutes);
  app.use("/api/share-links", shareLinksRoutes);

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
        // Use Promise.race to timeout database check after 2 seconds
        const dbCheck = Promise.race([
          pool.query("SELECT NOW(), current_database(), version()"),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Database query timeout")), 2000)
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
