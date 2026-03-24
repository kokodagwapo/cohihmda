/**
 * One-time script: create Jira issues documenting completed COHI platform work,
 * organize under epics, and transition everything to Done.
 *
 * Usage:
 *   node --env-file=jira-import.env.local scripts/jira-completed-work-evidence.mjs --dry-run
 *   node --env-file=jira-import.env.local scripts/jira-completed-work-evidence.mjs
 *
 * Idempotent: skips issues whose summary already exists in the project.
 * All created issues are transitioned to Done (handles resolution fields when required).
 */
import process from "process";

const PROJECT = process.env.JIRA_PROJECT_KEY || "COHI";
const BASE = (process.env.JIRA_BASE_URL || "").replace(/\/$/, "");
const EMAIL = process.env.JIRA_EMAIL || "";
const TOKEN = process.env.JIRA_API_TOKEN || "";

const BATCH_LABEL = "completed-work-evidence-2026-03";
const dryRun = process.argv.includes("--dry-run");

const AUTH = {
  Authorization: `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`, "utf8").toString("base64")}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

// ---------------------------------------------------------------------------
// Jira helpers
// ---------------------------------------------------------------------------

async function api(path, opts = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, { ...opts, headers: { ...AUTH, ...opts.headers } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${opts.method || "GET"} ${path} -> ${res.status}: ${text.slice(0, 800)}`);
    err.body = json;
    throw err;
  }
  return json;
}

async function searchJql(jql, fields = "summary,issuetype,labels,status") {
  const all = [];
  let token = null;
  while (true) {
    const url = new URL(`${BASE}/rest/api/3/search/jql`);
    url.searchParams.set("jql", jql);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("fields", fields);
    if (token) url.searchParams.set("nextPageToken", token);
    const page = await api(url.pathname + url.search);
    for (const i of page.issues || []) all.push(i);
    token = page.nextPageToken || null;
    if (!token || !(page.issues || []).length) break;
  }
  return all;
}

function adf(...paragraphs) {
  return {
    type: "doc",
    version: 1,
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  };
}

// ---------------------------------------------------------------------------
// Issue definitions
// ---------------------------------------------------------------------------

const EPICS = [
  {
    slug: "platform-infra",
    summary: "Platform architecture and infrastructure",
    description: adf(
      "Covers the foundational multi-tenant SaaS architecture, AWS infrastructure as code (CloudFormation, Terraform), ECS Fargate deployment, Aurora Serverless databases, the database migration framework, and all deployment automation.",
      "Key repo areas: server/src/config/ (tenantDatabaseManager, managementDatabase, database, secrets, encryption), infrastructure/cloudformation/, infrastructure/terraform/, scripts/deploy/, server/migrations/, docker/.",
    ),
  },
  {
    slug: "app-features",
    summary: "Application features and data integrations",
    description: adf(
      "Covers all user-facing application capabilities: authentication and access control, LOS connectors and data sync, executive dashboards and AI-driven insights, the workbench/canvas system, AI chat, research lab, analytics suite, billing, and email/notification systems.",
      "Key repo areas: server/src/routes/, server/src/services/, server/src/middleware/, src/pages/, src/components/, src/hooks/, src/stores/.",
    ),
  },
  {
    slug: "quality-ops",
    summary: "Quality assurance, observability, and operational readiness",
    description: adf(
      "Covers the CI/CD pipeline, automated test suites (unit, integration, E2E, load), error tracking and observability, session replay, monitoring infrastructure, and the full documentation corpus (architecture, deployment, security, QA).",
      "Key repo areas: bitbucket-pipelines.yml, e2e/, tests/load/, server/src/test/, server/src/middleware/sentry.ts, src/services/sessionReplayRecorder.ts, docs/, scripts/deploy/04-deploy-monitoring.ps1, infrastructure/cloudformation/coheus_monitoring_stack.yaml.",
    ),
  },
];

const TASKS = [
  // --- Epic 1: Platform architecture and infrastructure ---
  {
    epicSlug: "platform-infra",
    summary: "Multi-tenant SaaS platform with database-per-tenant isolation and KMS encryption",
    description: adf(
      "Implemented a multi-tenant architecture where each tenant gets an isolated PostgreSQL database. The management database (coheus_management) stores tenant metadata, platform users, subscriptions, API keys, and global configuration. Per-tenant pools are managed by tenantDatabaseManager with LRU eviction and KMS-decrypted credentials.",
      "Tenant provisioning handles database creation, schema migration, seed data, and optional duplication from template tenants. The tenantProvisioningService, tenantDuplicationService, and tenantRefreshService support the full tenant lifecycle. Field-level encryption uses AWS KMS in production with a plaintext fallback for local development.",
      "Relevant paths: server/src/config/tenantDatabaseManager.ts, server/src/config/managementDatabase.ts, server/src/config/database.ts, server/src/config/secrets.ts, server/src/services/encryption.ts, server/src/services/tenantProvisioningService.ts, server/src/services/tenantDuplicationService.ts, server/src/services/tenantSchemaResolver.ts, server/src/middleware/tenantContext.ts.",
    ),
  },
  {
    epicSlug: "platform-infra",
    summary: "AWS infrastructure as code — CloudFormation and Terraform for Aurora, ECS, WAF, and CloudFront",
    description: adf(
      "Full infrastructure defined in code across CloudFormation and Terraform. CloudFormation stacks cover Aurora Serverless (coheus_aurora_cluster_stack.yaml), ECS Fargate with ALB (coheus_ecs_fargate_stack.yaml), WAF and CloudFront (coheus_waf_cloudfront_stack.yaml), frontend S3 + CloudFront distribution (coheus_frontend_cloud_front_s3_stack.yaml), Lambda functions (coheus_lambda_functions_stack.yaml), monitoring with SNS-to-Teams alerting (coheus_monitoring_stack.yaml), tenant provisioning automation (coheus_tenant_provisioning_stack.yaml), Bitbucket OIDC role (bitbucket-oidc-role.yaml), and a marketplace self-hosted template.",
      "Terraform modules provide ECS Fargate, Aurora Serverless, and VPC under infrastructure/terraform/modules/ with a SaaS production deployment under deployments/saas/prod/. API Gateway definitions exist for REST and WebSocket in infrastructure/aws/.",
      "Relevant paths: infrastructure/cloudformation/*.yaml, infrastructure/terraform/, infrastructure/aws/, infrastructure/lambda/sns-to-teams/index.js, scripts/deploy/config.ps1.",
    ),
  },
  {
    epicSlug: "platform-infra",
    summary: "Database migration framework — 118 versioned migrations, CLI, checksums, and repair tooling",
    description: adf(
      "Built a migration runner (server/src/migrations/runner.ts) with versioned numbered SQL files, SHA-256 checksums in a schema_migrations table, transaction wrapping, and dry-run support. The CLI (server/src/migrations/cli.ts) supports up, status, tenant, tenant --all, and create commands with automatic database creation when missing.",
      "27 management-database migrations cover platform schema (tenants, users, subscriptions, API keys, auth config, lockout, metrics, AI prompts, platform settings, analytics events, sync jobs, release notes, Cognito, email logs, global knowledge, Aletheia settings, insight training). 91 tenant-database migrations cover per-tenant schema (loans, LOS config, RAG, RBAC, Encompass, workbench, distributions, research, fallout, pricing dashboard, podcast, dashboard insights, and more).",
      "Additional tooling: repair-tenant-schemas.ts, migrate-tenant-schemas.ts, audit-tenant-pricing-schema.ts, seed scripts (super admin, local dev, default AI prompts), cleanup-shadow-users.ts.",
      "Relevant paths: server/migrations/management/ (27 files), server/migrations/tenant/ (91 files), server/src/migrations/, server/scripts/, server/package.json (migrate:* scripts).",
    ),
  },
  {
    epicSlug: "platform-infra",
    summary: "Deployment automation — PowerShell scripts, Docker containers, and CI-driven release flow",
    description: adf(
      "Ordered deployment via PowerShell scripts (scripts/deploy/): 01-deploy-aurora.ps1, 02-deploy-backend.ps1, 03-deploy-waf-cloudfront.ps1, 04-deploy-monitoring.ps1, 05-deploy-tenant-provisioning.ps1, 06-run-migrations.ps1, 07-cleanup-management-db.ps1, with deploy-all.ps1 orchestrating the full sequence and destroy.ps1 / status.ps1 for lifecycle management. Central config in config.ps1 with AWS profile, VPC, ECR, ECS, Cognito, and domain settings.",
      "Docker support includes dev and production compose files (docker-compose.yml, docker/dev/, docker/prod/) with separate backend and frontend Dockerfiles, nginx reverse-proxy configs, health checks, and EC2/CloudFormation setup helpers. Bitbucket pipeline scripts under scripts/bitbucket/ (deploy-frontend.sh, deploy-backend-ecs.sh, deploy-infrastructure.sh, run-migrations.sh) handle S3 sync, ECR push, ECS service update, and CloudFront invalidation.",
      "Relevant paths: scripts/deploy/, docker/, docker/prod/nginx/, scripts/bitbucket/, Dockerfile.backend, Dockerfile.backend.prod, docker-compose.yml.",
    ),
  },

  // --- Epic 2: Application features and data integrations ---
  {
    epicSlug: "app-features",
    summary: "Authentication, Cognito SSO, MFA enforcement, RBAC, and audit logging",
    description: adf(
      "Authentication uses AWS Cognito as the identity provider with JWT session tokens issued by the backend. Flows include Cognito password auth (with mandatory MFA preflight check at startup), SSO code exchange and ID token verification, and MFA setup/completion. Routes: /api/auth (login, session), /api/auth/cognito (SSO callback, logout URLs), /api/auth/mfa. Frontend: Login, ForgotPassword, ResetPassword, SSOCallback pages with MFA setup in settings.",
      "Role-based access control via middleware/rbac.ts supports platform roles (super_admin, etc.), tenant roles, and a canvas-only persona (tenant_canvas_only_user) with method/path allowlists. The tenantContext middleware resolves tenant from JWT, loads the correct database pool, and audits cross-tenant access by platform staff. Rate limiting (express-rate-limit) applies globally with stricter limits on auth endpoints.",
      "Audit logging covers login attempts, failed logins, session lifecycle, cross-tenant access, and email events (auditLogger.ts, emailAuditLogger.ts). Account lockout policies are enforced at the auth route level.",
      "Relevant paths: server/src/middleware/auth.ts, rbac.ts, tenantContext.ts, rateLimiter.ts; server/src/routes/auth.ts, auth/cognitoAuth.ts, auth/mfa.ts; server/src/services/cognito/; server/src/services/auditLogger.ts; src/contexts/AuthContext.tsx; src/components/auth/; docs/security/.",
    ),
  },
  {
    epicSlug: "app-features",
    summary: "LOS connector framework, Encompass integration, field mapping, and automated data sync",
    description: adf(
      "Pluggable LOS connector architecture with BaseConnector, EncompassConnector, MeridianLinkConnector, and ConnectorFactory under server/src/services/connectors/. The Encompass integration includes API service (encompassApiService.ts), webhook ingestion and scheduling (encompassWebhookService.ts, encompassWebhookScheduler.ts), credentials via Secrets Manager (encompassCredentialsService.ts), field discovery (encompassFieldDiscoveryService.ts), loan extraction ETL (encompassLoanExtractor.ts, etl/encompassEtlService.ts), user sync (encompassUserSyncService.ts), and field backfill (etl/fieldBackfillService.ts).",
      "Field mapping system: autoMapper.ts for intelligent field matching, fieldMapper.ts, default Encompass field mappings config, LOS field library shared between frontend and backend. CSV import processor (csvProcessor.ts, csvTemplateService.ts) with data transformation pipeline (dataTransformer.ts). Mock LOS API for testing available at /mock-los when enabled.",
      "Background sync: losSyncScheduler.ts, vendorSyncScheduler.ts, syncJobPoller.ts, hybridSync.ts for incremental sync. Post-sync hooks (hooks/postSyncHookService.ts) trigger insight regeneration. Job management with async status polling (jobManager.ts, /api/jobs route).",
      "Relevant paths: server/src/services/connectors/, server/src/services/encompass*, server/src/services/mapping/, server/src/services/csvProcessor.ts, server/src/services/losApiService.ts, server/src/services/losSyncScheduler.ts, server/src/routes/los.ts, server/src/routes/encompass.ts; docs/data/.",
    ),
  },
  {
    epicSlug: "app-features",
    summary: "Executive dashboards, AI-generated insights, analytics suite, and Aletheia briefing",
    description: adf(
      "Dashboard system with template-based creation, data import, analytics endpoints, and insight detail hydration (server/src/routes/dashboard/). Dashboard insights pipeline (server/src/services/dashboardInsights/) with orchestrator, storage, and adapters for loan complexity, company scorecard, and leaderboard analysis. AI insight generation uses evaluator, investigator, and planner agents (server/src/services/insights/agents/) with LLM-backed generators and metrics collectors. Tracked insights watchlist for monitoring key indicators over time.",
      "Analytics portfolio: operations scorecard trends, sales scorecard, company scorecard, workflow conversion, fallout modeling (segment rates, numeric profiles, sequencer, historical aggregation), pricing dashboard, lock stratification, pipeline analysis, loan complexity scoring, top-tiering, credit risk management, high performers, and financial modeling sandbox. Each has dedicated routes, services, and frontend pages/views.",
      "Aletheia daily briefing with podcast/TTS streaming, prefetch worker, and asset storage. News feed via RSS ingestion (newsService.ts, newsRefreshScheduler.ts). Scheduled report distributions with email delivery (distributionScheduler.ts, distributionContentResolver.ts, SES templates). Email system with SES sending, templates (daily-brief, distribution, fallout-alert, release-notes), and verification.",
      "Relevant paths: server/src/routes/dashboard/, dashboardInsights.ts; server/src/services/dashboardInsights/, insights/, fallout/, scoring/, scorecard/, ai/; server/src/routes/podcast.ts, news.ts, distributions.ts, falloutAlerts.ts, email.ts; src/pages/ (Dashboard, scorecards, fallout, pricing, pipeline, etc.); src/components/dashboard/, widgets/, visualizations/, aletheia/.",
    ),
  },
  {
    epicSlug: "app-features",
    summary: "Workbench canvas, AI chat, research lab, RAG knowledge base, and report generation",
    description: adf(
      "Workbench system: drag-and-drop canvas editor (react-grid-layout, @dnd-kit, react-rnd) with a widget registry containing 20+ widget types (company scorecard, credit risk, sales/ops, loan funnel, leaderboard, closing forecast, financial modeling, Aletheia, news, workflow conversion, high performers, pricing, pipeline, lock stratification, loan complexity, etc.). Canvas CRUD stored per-tenant with sharing via groups, team folders, favorites, and scheduled distributions. Widget adapter bridges visualization components to canvas data payloads.",
      "AI chat (Cohi Chat): global chat panel with conversation history, natural-language query builder, schema-aware context, dashboard image generation. Server-side: cohiChat.ts route, ai/ services. Research lab: multi-agent orchestrator with planner, data analyst, and synthesis agents. Research sessions with drill-down, timelines, and report output. Workbench-specific insight deep dive for drill-through from canvas widgets.",
      "RAG system: embedding service (embeddingService.ts), vector database abstraction (vectorDatabase.ts), document chunking (documentChunker.ts) and parsing (documentParser.ts supporting PDF, DOCX, HTML), knowledge base CRUD routes, global knowledge sync service, and help content seeding. Admin AI prompt management with default configs and force-seed tooling.",
      "Report generation: PPTX and PDF via pptxgenjs and jspdf (server/src/services/export/reportGenerationService.ts). Frontend report builder with slide editor, template gallery, and export utilities (canvas export, PDF export, XLSX). Workbench hub for discovery, plus dedicated pages for SharedWithMe, TeamFolders, Favorites, Distributions.",
      "Relevant paths: src/components/workbench/, src/components/widgets/, src/pages/WorkbenchHub.tsx, workbench/; server/src/routes/workbench.ts, cohiWorkbench.ts, cohiChat.ts, research.ts, rag.ts, ragKnowledgeBase.ts; server/src/services/ai/, research/, embeddingService.ts, vectorDatabase.ts, workbench/.",
    ),
  },

  // --- Epic 3: Quality, observability, and operational readiness ---
  {
    epicSlug: "quality-ops",
    summary: "CI/CD pipeline — Bitbucket Pipelines with build, test, deploy stages, and AWS OIDC",
    description: adf(
      "Bitbucket Pipelines (bitbucket-pipelines.yml) with Node 20, Docker service (Postgres 15 for integration tests), npm caching, and AWS OIDC authentication. Pipeline stages: frontend build, backend build, frontend Vitest, backend Vitest, backend integration tests (Postgres service container), and E2E testing using the official Playwright Docker image (mcr.microsoft.com/playwright).",
      "E2E test tiers: @smoke (PR gate, fast), @critical (dev deploy gate, Chromium), @regression (nightly, cross-browser). Branch strategy: PRs to dev/main run smoke E2E; dev branch deploys then runs critical E2E; main production deploy is manual. Custom pipelines for partial deploys, force deploy-all with migrations, and standalone migration execution (run-migrations-dev, run-migrations-prod).",
      "Deploy steps: frontend to S3 with CloudFront invalidation, backend ECR push and ECS service update, CloudFormation via bitbucket deploy scripts. Artifacts always retained: traces, screenshots, videos, JUnit reports.",
      "Relevant paths: bitbucket-pipelines.yml, scripts/bitbucket/ (deploy-frontend.sh, deploy-backend-ecs.sh, deploy-infrastructure.sh, run-migrations.sh), playwright.config.ts, e2e/global-setup.ts.",
    ),
  },
  {
    epicSlug: "quality-ops",
    summary: "Automated test suite — Playwright E2E, Vitest unit/integration, k6 load testing",
    description: adf(
      "End-to-end suite (e2e/): Playwright with Chromium, Firefox, and WebKit projects. Spec files cover auth, admin, settings, navigation, critical routes, role access, workbench, research lab, insights dashboard, dashboard data, distributions, top-tiering, and help center. Page objects (auth.po.ts, navigation.po.ts), shared fixtures and helpers, TOTP helper for MFA flows, and a route coverage matrix (route-matrix.md). Global setup/teardown with provision-state for cross-test data.",
      "Frontend unit tests: Vitest with jsdom, component tests under src/components/ui/__tests__/, utility tests under src/utils/, lib tests. Backend unit and integration tests: Vitest with Node environment, coverage scoped to middleware and routes with function/branch thresholds. Test infrastructure includes appFactory.ts, tokenFactory.ts, seedData.ts, setupTestDb.ts, role matrix, and route matrix coverage tests (routeMatrixCoverage.test.ts, roleAccess.test.ts).",
      "Load testing: k6 script (tests/load/load-test.js) with staged virtual-user ramp, latency and error-rate thresholds, configurable base URL and auth token.",
      "Relevant paths: e2e/*.spec.ts, e2e/page-objects/, e2e/fixtures.ts, e2e/helpers.ts, e2e/totp.ts, e2e/route-matrix.md; server/src/test/; tests/load/load-test.js; playwright.config.ts, server/vitest.config.ts, vite.config.ts (test block).",
    ),
  },
  {
    epicSlug: "quality-ops",
    summary: "Observability — Sentry error tracking, session replay, analytics pipeline, and CloudWatch monitoring",
    description: adf(
      "Sentry integration on both frontend (@sentry/react with browser tracing and replay in src/main.tsx, ErrorBoundary.tsx) and backend (@sentry/node with Express integration in server/src/middleware/sentry.ts). DSN configured via environment variables (VITE_SENTRY_DSN, SENTRY_DSN).",
      "Custom analytics pipeline: frontend analyticsService.ts batches page/click/form events to /api/analytics, AnalyticsContext wraps identity and session lifecycle. Session replay recording via rrweb (sessionReplayRecorder.ts) with chunk upload to /api/analytics/replay; admin SessionReplayPlayer.tsx for playback. Backend LLM/voice/embedding cost tracking middleware (costTracking.ts) for billable usage visibility.",
      "AWS monitoring: CloudFormation monitoring stack (coheus_monitoring_stack.yaml) deployed via scripts/deploy/04-deploy-monitoring.ps1. SNS-to-Teams Lambda (infrastructure/lambda/sns-to-teams/index.js) for alert routing. Backend structured logging (morgan + logger service). Health endpoints (/health, /api/health) and version endpoint (/api/version) with build metadata.",
      "Relevant paths: src/main.tsx, src/services/analyticsService.ts, src/services/sessionReplayRecorder.ts, src/contexts/AnalyticsContext.tsx; server/src/middleware/sentry.ts, costTracking.ts, logger.ts; server/src/services/versionService.ts; infrastructure/cloudformation/coheus_monitoring_stack.yaml, infrastructure/lambda/.",
    ),
  },
  {
    epicSlug: "quality-ops",
    summary: "Documentation — architecture, deployment runbooks, security guides, and QA conventions",
    description: adf(
      "Architecture documentation: FULL_STACK_ARCHITECTURE.md, BACKEND_ARCHITECTURE.md, EXECUTIVE_DASHBOARD_ARCHITECTURE.md covering system design, data flow, and domain model. Multi-tenant architecture (docs/architecture/MULTI_TENANT.md, OVERVIEW.md), self-hosted and marketplace guides (SELF_HOSTED.md, AWS_MARKETPLACE.md), admin panel requirements (ADMIN_PANEL.md, INTERNAL_ADMIN_REQUIREMENTS.md, CLIENT_ADMIN_REQUIREMENTS.md), Aurora cluster patterns (AURORA_CLUSTERS.md).",
      "Deployment documentation: DEPLOYMENT_RUNBOOK.md, TERRAFORM_MODULES.md, scripts/deploy/README.md (ordered CloudFormation deploy, troubleshooting, cost estimates), LOCAL_DEV_SETUP.md, BITBUCKET_PIPELINE_SETUP.md. Docker README with dev and production workflows.",
      "Security documentation: SSO_AUTHENTICATION.md, SSO_MIGRATION_GUIDE.md, SSO_REVIEW.md, USER_MANAGEMENT.md, ROW_LEVEL_SECURITY.md, AUTH_REFACTOR.md, STATE_MANAGEMENT.md. Cognito setup guides (cognito-prod-config.md, enable-cognito-password-auth.md, cognito-email-ses-and-branding.md).",
      "Data integration docs: docs/data/ (OVERVIEW.md, DATA_QUALITY.md, INCREMENTAL_SYNC.md, CSV_IMPORT.md, UNIVERSAL_CONNECTOR.md, integrations/Encompass, MeridianLink, Servicing). QA conventions: QA_RUNBOOK.md (test layers, pipeline model, release checklist, bug handling, Jira organization). Client onboarding: CLIENT_ONBOARDING_GUIDE.md, ENCOMPASS_USER_SYNC.md. Product backlog tracking: COHI_JIRA_BACKLOG.md, COHI_JIRA_IMPORT.json.",
      "Relevant paths: docs/ (35+ markdown files across architecture/, deployment/, security/, data/, admin/, release-notes/), server/migrations/README.md, docker/README.md, e2e/route-matrix.md.",
    ),
  },
];

// ---------------------------------------------------------------------------
// Create + link + transition logic
// ---------------------------------------------------------------------------

async function createIssue(fields) {
  if (dryRun) {
    const type = fields.issuetype?.name || "?";
    const parent = fields.parent?.key || "";
    const tag = parent ? ` (under ${parent})` : "";
    console.log(`[dry-run] ${type}: ${fields.summary}${tag}`);
    return { key: `DRYRUN-${Date.now()}` };
  }
  const res = await api("/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  console.log(`Created ${res.key} — ${fields.summary}`);
  return res;
}

async function transitionToDone(issueKey) {
  if (dryRun) {
    console.log(`[dry-run] Transition ${issueKey} -> Done`);
    return;
  }
  const issue = await api(`/rest/api/3/issue/${issueKey}?fields=status`);
  if (issue.fields?.status?.statusCategory?.key === "done") {
    console.log(`  Already Done: ${issueKey}`);
    return;
  }
  const data = await api(`/rest/api/3/issue/${issueKey}/transitions?expand=transitions.fields`);
  const transitions = data.transitions || [];
  const t = transitions.find(
    (x) =>
      x.to?.statusCategory?.key === "done" ||
      /\bdone\b/i.test(x.name || "") ||
      /\bcomplete/i.test(x.name || ""),
  );
  if (!t) {
    console.error(`  No Done transition for ${issueKey}:`, transitions.map((x) => x.name));
    return;
  }

  const body = { transition: { id: t.id } };
  const reqFields = t.fields || {};
  if (reqFields.resolution?.allowedValues?.length) {
    const allowed = reqFields.resolution.allowedValues;
    const pick =
      allowed.find((r) => /done|complete|fixed/i.test(r.name || "")) || allowed[0];
    if (pick) body.fields = { resolution: { id: pick.id } };
  }

  await api(`/rest/api/3/issue/${issueKey}/transitions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  console.log(`  Transitioned ${issueKey} -> ${t.name}`);
}

async function main() {
  if (!BASE || !EMAIL || !TOKEN) {
    console.error("Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN.");
    process.exit(1);
  }

  console.error(`Project: ${PROJECT} | Batch label: ${BATCH_LABEL}\n`);

  // Load existing summaries for skip-existing behavior
  const existing = new Map();
  const all = await searchJql(`project = ${PROJECT}`);
  for (const i of all) {
    const s = (i.fields?.summary || "").trim();
    if (s) existing.set(s, i.key);
  }
  console.error(`Found ${existing.size} existing issue(s) in ${PROJECT}.\n`);

  // 1. Create epics
  const epicKeyBySlug = new Map();
  const allCreatedKeys = [];

  for (const epic of EPICS) {
    const s = epic.summary.trim();
    if (existing.has(s)) {
      const key = existing.get(s);
      epicKeyBySlug.set(epic.slug, key);
      console.log(`Skip Epic (exists ${key}): ${s}`);
      allCreatedKeys.push(key);
    } else {
      const res = await createIssue({
        project: { key: PROJECT },
        summary: s,
        issuetype: { name: "Epic" },
        labels: [BATCH_LABEL, "completed-work"],
        description: epic.description,
      });
      epicKeyBySlug.set(epic.slug, res.key);
      existing.set(s, res.key);
      allCreatedKeys.push(res.key);
    }
    await sleep(300);
  }

  console.log("");

  // 2. Create tasks under epics
  for (const task of TASKS) {
    const s = task.summary.trim();
    const epicKey = epicKeyBySlug.get(task.epicSlug);
    if (!epicKey) {
      console.error(`No epic key for slug ${task.epicSlug}, skipping: ${s}`);
      continue;
    }
    if (existing.has(s)) {
      console.log(`Skip Task (exists ${existing.get(s)}): ${s}`);
      allCreatedKeys.push(existing.get(s));
    } else {
      const fields = {
        project: { key: PROJECT },
        summary: s,
        issuetype: { name: "Task" },
        labels: [BATCH_LABEL, "completed-work"],
        description: task.description,
        ...(dryRun ? {} : { parent: { key: epicKey } }),
      };
      if (dryRun) {
        fields.parent = { key: epicKey };
      }
      const res = await createIssue(fields);
      existing.set(s, res.key);
      allCreatedKeys.push(res.key);
    }
    await sleep(300);
  }

  // 3. Transition all batch issues to Done
  const unique = [...new Set(allCreatedKeys)].filter((k) => !k.startsWith("DRYRUN-"));

  console.log(`\n--- Transitioning ${unique.length} issue(s) to Done ---\n`);

  for (const key of unique) {
    try {
      await transitionToDone(key);
    } catch (e) {
      console.error(`  ${key}: ${e.message}`);
    }
    await sleep(250);
  }

  if (dryRun) {
    console.error(`\nDry run: ${EPICS.length} epics + ${TASKS.length} tasks = ${EPICS.length + TASKS.length} issues.`);
    console.error("Run without --dry-run to create and close.\n");
  } else {
    console.error(`\nDone. Jira filter: project = ${PROJECT} AND labels = "${BATCH_LABEL}"`);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((e) => { console.error(e); process.exit(1); });
