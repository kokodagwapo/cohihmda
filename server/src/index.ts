import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { setupRoutes } from "./routes/index.js";
import { setupWebSocket } from "./services/websocket.js";
import { initDatabase } from "./config/database.js";
import {
  initSentry,
  setupSentryErrorHandler,
} from "./middleware/sentry.js";
import { apiLimiter } from "./middleware/rateLimiter.js";
import { devLogger, prodLogger } from "./middleware/logger.js";
import {
  assertMfaConfigurationReady,
  isCognitoAuthEnabled,
} from "./services/cognito/cognitoAuthService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file (for local development)
// In production (AWS), environment variables are set directly, so this is a no-op
dotenv.config({ path: join(__dirname, "../.env") });

// Log environment variable loading status (for debugging)
if (
  process.env.NODE_ENV !== "production" ||
  process.env.ENABLE_ENV_LOGGING === "true"
) {
  console.log("🔍 Environment variable check:", {
    hasJwtSecret: !!process.env.JWT_SECRET,
    jwtSecretLength: process.env.JWT_SECRET?.length || 0,
    hasDbHost: !!process.env.DB_HOST,
    hasDbName: !!process.env.DB_NAME,
    hasDbUser: !!process.env.DB_USER,
    hasDbPassword: !!process.env.DB_PASSWORD,
    nodeEnv: process.env.NODE_ENV,
    // Check if we're in AWS (Elastic Beanstalk sets these)
    isAws:
      !!process.env.AWS_REGION || !!process.env.ELASTIC_BEANSTALK_ENVIRONMENT,
  });
}

const app = express();

// Trust proxy - required when behind ALB/CloudFront to correctly identify client IPs
// This fixes express-rate-limit ERR_ERL_UNEXPECTED_X_FORWARDED_FOR error
app.set("trust proxy", 1);

const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;
const SKIP_DB = process.env.SKIP_DB === "true";
const NODE_ENV = process.env.NODE_ENV || "development";
// PROCESS_MODE: 'api' = HTTP server only; 'worker' = schedulers + sync job poller only; unset = both (local dev)
const PROCESS_MODE = process.env.PROCESS_MODE;

// Initialize Sentry (must be first)
initSentry();

// Middleware
// Get allowed origins from environment or use defaults
// Supports both HTTP (dev) and HTTPS (production) origins
const defaultOrigins =
  "http://localhost:5175,http://localhost:8080,http://localhost:8081,http://localhost:8083,http://localhost:8084,http://localhost:8080/Cohi,http://localhost:8081/Cohi,http://localhost:8083/Cohi,http://localhost:8084/Cohi,https://d2wvs4i87rs881.cloudfront.net,http://Cohi-frontend-1767135651.s3-website-us-east-1.amazonaws.com";
const envOrigins = process.env.FRONTEND_URL || "";
// Always include CloudFront URL in production
const cloudFrontOrigin = "https://d2wvs4i87rs881.cloudfront.net";
const allowedOrigins = (
  envOrigins ? `${envOrigins},${defaultOrigins}` : defaultOrigins
)
  .split(",")
  .map((o) => o.trim())
  .filter((o) => o.length > 0)
  // Always include CloudFront origin
  .concat([cloudFrontOrigin])
  // Remove duplicates
  .filter((value, index, self) => self.indexOf(value) === index)
  // Add HTTPS versions of HTTP origins for production
  .flatMap((origin) => {
    if (origin.startsWith("http://") && !origin.includes("localhost")) {
      return [origin, origin.replace("http://", "https://")];
    }
    return [origin];
  });

// CORS - Allow CloudFront and all configured origins
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, or same-origin)
      if (!origin) {
        return callback(null, true);
      }
      // Always allow CloudFront origin in production
      if (
        origin === "https://d2wvs4i87rs881.cloudfront.net" ||
        origin.startsWith("https://d2wvs4i87rs881.cloudfront.net")
      ) {
        return callback(null, true);
      }
      // Check if origin is in allowed list
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // In development, allow all origins
      if (NODE_ENV !== "production") {
        return callback(null, true);
      }
      // Log and block in production
      console.warn(`CORS blocked origins: ${origin}`);
      console.log("Allowed origins:", allowedOrigins);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Cache-Control"],
  }),
);

// Request logging
app.use(NODE_ENV === "production" ? prodLogger : devLogger);

// Body parsing - increased limits for CSV uploads
// Add error handling for JSON parsing failures
app.use(
  express.json({
    limit: "500mb",
    strict: true,
    verify: (req: any, res: any, buf: Buffer) => {
      // Store raw body for debugging
      req.rawBody = buf.toString("utf8");
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: "500mb" }));

// Error handler for JSON parsing errors
app.use((err: any, req: any, res: any, next: any) => {
  if (err instanceof SyntaxError && "body" in err) {
    console.error("JSON parsing error:", {
      path: req.path,
      method: req.method,
      error: err.message,
      rawBody: req.rawBody?.substring(0, 200), // First 200 chars only
    });
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }
  next(err);
});

// Add Cache-Control headers to all API responses to prevent CloudFront caching
app.use((req, res, next) => {
  // Set no-cache headers for all API routes
  if (req.path.startsWith("/api/")) {
    res.set({
      "Cache-Control":
        "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "Surrogate-Control": "no-store",
    });
  }
  next();
});

// Rate limiting (apply to all routes except health check)
app.use((req, res, next) => {
  // Skip rate limiting for health check endpoint
  if (req.path === "/health") {
    return next();
  }
  return apiLimiter(req, res, next);
});

// Validate required environment variables at startup
const validateEnvironment = () => {
  const requiredVars = [
    "JWT_SECRET",
    "COGNITO_USER_POOL_ID",
    "COGNITO_CLIENT_ID",
    "COGNITO_REGION",
  ];
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const varName of requiredVars) {
    const value = process.env[varName];
    if (!value || value.trim() === "") {
      missing.push(varName);
    } else if (varName === "JWT_SECRET") {
      const trimmed = value.trim();
      if (trimmed.length < 32) {
        console.error(
          `❌ ${varName} must be at least 32 characters long (current: ${trimmed.length})`,
        );
        missing.push(varName);
      } else {
        // Check for common issues
        if (value.length !== trimmed.length) {
          warnings.push(
            `${varName} has leading/trailing whitespace (will be trimmed)`,
          );
        }
        if (/\s/.test(trimmed)) {
          warnings.push(
            `${varName} contains internal whitespace - this may cause issues`,
          );
        }
        // Check if it looks like a placeholder
        if (
          trimmed.toLowerCase().includes("change") ||
          trimmed.toLowerCase().includes("secret") ||
          trimmed === "your_jwt_secret_min_32_chars"
        ) {
          warnings.push(
            `${varName} appears to be a placeholder value - please set a real secret`,
          );
        }
      }
    }
  }

  if (warnings.length > 0) {
    console.warn("⚠️  Environment variable warnings:");
    warnings.forEach((w) => console.warn(`   - ${w}`));
  }

  if (missing.length > 0) {
    console.error("❌ Missing or invalid required environment variables:");
    missing.forEach((v) => console.error(`   - ${v}`));
    console.error("\n⚠️  Server will start but authentication will fail.");
    console.error(
      "   Please set these variables in your Elastic Beanstalk environment configuration.",
    );
    console.error(
      "   In AWS: Go to Elastic Beanstalk → Environment → Configuration → Software → Environment properties",
    );
    return false;
  }

  if (process.env.COGNITO_PASSWORD_AUTH !== "true") {
    console.error(
      "❌ COGNITO_PASSWORD_AUTH must be set to 'true'. Local DB password auth is disabled by policy.",
    );
    return false;
  }

  return true;
};

// Initialize database (optional for local dev voice testing)
const startServer = async () => {
  // Validate environment variables
  const envValid = validateEnvironment();
  if (!envValid) {
    console.error(
      "⚠️  Continuing with invalid environment - authentication will fail",
    );
  }

  // Fail fast if Cognito auth isn't enabled or pool MFA config is unsafe.
  if (!isCognitoAuthEnabled()) {
    throw new Error(
      "Cognito password auth must be enabled. Refusing to start without COGNITO_PASSWORD_AUTH=true and Cognito config.",
    );
  }
  await assertMfaConfigurationReady();
  console.log(
    "✅ Cognito MFA preflight passed (EMAIL_OTP + SOFTWARE_TOKEN_MFA enabled)",
  );

  // Setup routes
  setupRoutes(app);

  // Sentry error handler (must be after routes, before other error handlers)
  setupSentryErrorHandler(app);

  // Final catch-all error handler to ensure all errors return JSON
  // This prevents empty responses that cause "Unexpected end of JSON input" errors
  app.use((err: any, req: any, res: any, next: any) => {
    // If response already sent, don't try to send again
    if (res.headersSent) {
      return next(err);
    }

    // Log the error
    console.error("Unhandled error in request:", {
      path: req.path,
      method: req.method,
      error: err.message,
      stack: err.stack,
    });

    // Always send a JSON response, even for unhandled errors
    try {
      res.status(err.status || 500).json({
        error: err.message || "Internal server error",
        ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
      });
    } catch (sendError) {
      // If we can't send JSON, at least try to end the response
      if (!res.headersSent) {
        res.status(500).end();
      }
    }
  });

  // 404 handler for unmatched routes - ensure JSON response
  app.use((req: any, res: any) => {
    if (!res.headersSent) {
      res.status(404).json({ error: "Route not found", path: req.path });
    }
  });

  // Setup WebSocket
  setupWebSocket(wss);

  // Increase server timeouts to handle long-running API requests (predictions, insights, etc.)
  // CloudFront OriginReadTimeout is 60s (default max); long-lived SSE connections use periodic heartbeats to keep the connection alive.
  server.keepAliveTimeout = 300_000; // 5 min — must exceed ALB idle timeout
  server.headersTimeout = 305_000; // slightly above keepAliveTimeout per Node docs

  server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 WebSocket server ready`);
    console.log(
      `🔗 Frontend URL: ${process.env.FRONTEND_URL || "http://localhost:8080"}`,
    );
    console.log(`🌍 Environment: ${NODE_ENV}`);
    if (SKIP_DB) {
      console.log("⚠️ Database initialization skipped (SKIP_DB=true)");
    }
    if (envValid) {
      console.log("✅ Environment variables validated");
    }
    const cognitoPasswordAuth = process.env.COGNITO_PASSWORD_AUTH === "true";
    const cognitoSso = !!(process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_DOMAIN);
    console.log(`🔐 Auth: SSO=${cognitoSso ? "cognito" : "off"}, Password=${cognitoPasswordAuth ? "cognito" : "bcrypt"}`);
  });
};

/**
 * Start worker process: schedulers + sync job poller. No HTTP server.
 * Used when PROCESS_MODE=worker (dedicated ECS worker container).
 */
async function startWorker() {
  console.log("🔧 Starting worker (schedulers + sync job poller)...");
  if (NODE_ENV === "test") return;

  try {
    const { startSyncScheduler } =
      await import("./services/losSyncScheduler.js");
    startSyncScheduler();
  } catch (error) {
    console.warn("⚠️ Failed to start LOS sync scheduler:", error);
  }

  if (process.env.ENCOMPASS_WEBHOOK_SCHEDULER_ENABLED !== "false") {
    try {
      const { startEncompassWebhookScheduler } = await import(
        "./services/encompassWebhookScheduler.js"
      );
      startEncompassWebhookScheduler();
    } catch (error) {
      console.warn("⚠️ Failed to start Encompass webhook scheduler:", error);
    }
  }

  try {
    const { registerInsightHooks } =
      await import("./services/hooks/registerInsightHooks.js");
    registerInsightHooks();
  } catch (error) {
    console.warn("⚠️ Failed to register insight hooks:", error);
  }

  try {
    const { startNewsRefreshScheduler } = await import(
      "./services/newsRefreshScheduler.js"
    );
    startNewsRefreshScheduler();
  } catch (error) {
    console.warn("⚠️ Failed to start news refresh scheduler:", error);
  }

  try {
    const { startDistributionScheduler } = await import(
      "./services/distributionScheduler.js"
    );
    startDistributionScheduler();
  } catch (error) {
    console.warn("⚠️ Failed to start distribution scheduler:", error);
  }

  try {
    const { startAletheiaPrefetchWorker } = await import(
      "./services/aletheiaPrefetchWorker.js"
    );
    startAletheiaPrefetchWorker();
  } catch (error) {
    console.warn("⚠️ Failed to start Aletheia prefetch worker:", error);
  }

  try {
    const { startSyncJobPoller } = await import(
      "./services/syncJobPoller.js"
    );
    startSyncJobPoller();
    console.log("✅ Sync job poller started");
  } catch (error) {
    console.warn("⚠️ Failed to start sync job poller:", error);
  }

  try {
    const { startLoanComplexityRecomputeSchedulerFromManagement } =
      await import("./services/loanComplexityRecomputeScheduler.js");
    startLoanComplexityRecomputeSchedulerFromManagement();
    console.log("✅ Loan complexity recompute scheduler started (worker)");
  } catch (error) {
    console.warn(
      "⚠️ Failed to start loan complexity recompute scheduler:",
      error,
    );
  }
}

if (SKIP_DB) {
  startServer().catch((error) => {
    console.error("❌ Server startup preflight failed:", error);
    process.exit(1);
  });
} else {
  initDatabase()
    .then(async () => {
      if (PROCESS_MODE === "worker") {
        await startWorker();
        return;
      }

      await startServer();

      // Start schedulers only when not in api-only mode (unset = legacy: API + schedulers in one process)
      if (NODE_ENV !== "test" && PROCESS_MODE !== "api") {
        try {
          const { startSyncScheduler } =
            await import("./services/losSyncScheduler.js");
          startSyncScheduler();
        } catch (error) {
          console.warn("⚠️ Failed to start LOS sync scheduler:", error);
        }

        if (process.env.ENCOMPASS_WEBHOOK_SCHEDULER_ENABLED !== "false") {
          try {
            const { startEncompassWebhookScheduler } = await import(
              "./services/encompassWebhookScheduler.js"
            );
            startEncompassWebhookScheduler();
          } catch (error) {
            console.warn("⚠️ Failed to start Encompass webhook scheduler:", error);
          }
        }

        try {
          const { registerInsightHooks } =
            await import("./services/hooks/registerInsightHooks.js");
          registerInsightHooks();
        } catch (error) {
          console.warn("⚠️ Failed to register insight hooks:", error);
        }

        try {
          const { startNewsRefreshScheduler } = await import(
            "./services/newsRefreshScheduler.js"
          );
          startNewsRefreshScheduler();
        } catch (error) {
          console.warn("⚠️ Failed to start news refresh scheduler:", error);
        }

        try {
          const { startDistributionScheduler } = await import(
            "./services/distributionScheduler.js"
          );
          startDistributionScheduler();
        } catch (error) {
          console.warn("⚠️ Failed to start distribution scheduler:", error);
        }

        try {
          const { startAletheiaPrefetchWorker } = await import(
            "./services/aletheiaPrefetchWorker.js"
          );
          startAletheiaPrefetchWorker();
        } catch (error) {
          console.warn("⚠️ Failed to start Aletheia prefetch worker:", error);
        }

        try {
          const { startSyncJobPoller } = await import(
            "./services/syncJobPoller.js"
          );
          startSyncJobPoller();
        } catch (error) {
          console.warn("⚠️ Failed to start sync job poller:", error);
        }

        try {
          const { startLoanComplexityRecomputeSchedulerFromManagement } =
            await import("./services/loanComplexityRecomputeScheduler.js");
          startLoanComplexityRecomputeSchedulerFromManagement();
          console.log("✅ Loan complexity recompute scheduler started");
        } catch (error) {
          console.warn(
            "⚠️ Failed to start loan complexity recompute scheduler:",
            error,
          );
        }
      }
    })
    .catch((error) => {
      console.error("❌ Failed to initialize database:", error);
      console.error(
        "⚠️ Starting server without database (some features may be unavailable)",
      );
      // Don't exit - start server anyway so health check and basic routes work
      startServer().catch((startupError) => {
        console.error("❌ Server startup preflight failed:", startupError);
        process.exit(1);
      });
    });
}
