# Cohi Full Stack Architecture

A comprehensive review of the backend architecture and frontend-backend interaction patterns.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Backend Architecture](#backend-architecture)
   - [Server Entry Point & Configuration](#1-server-entry-point--configuration)
   - [Routes Organization](#2-routes-organization)
   - [Middleware](#3-middleware)
   - [Services Layer](#4-services-layer)
   - [Database Configuration](#5-database-configuration)
3. [Frontend Architecture](#frontend-architecture)
   - [API Layer](#1-api-layer)
   - [Data Fetching Hooks](#2-data-fetching-hooks)
   - [Contexts & State Management](#3-contexts--state-management)
   - [Pages & Components Pattern](#4-pages--components-pattern)
   - [Types & Interfaces](#5-types--interfaces)
4. [Frontend-Backend Interaction Flow](#frontend-backend-interaction-flow)
5. [Security Architecture](#security-architecture)
6. [Key Files Reference](#key-files-reference)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React + TypeScript)                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Pages (src/pages/)                                                         │
│    ↓                                                                        │
│  Contexts (AuthContext, DashboardContext, AdminTenantContext)               │
│    ↓                                                                        │
│  Data Hooks (useCompanyData, useDashboardStats, useSalesData, etc.)         │
│    ↓                                                                        │
│  API Client (src/lib/api.ts) ──── JWT Token Management                      │
│    ↓                                                                        │
│  HTTP Requests (Authorization: Bearer <token>)                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (Express + TypeScript)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  Middleware Chain:                                                          │
│    Sentry → CORS → Logger → Body Parser → Rate Limiter                      │
│    → authenticateToken → attachTenantContext → Route Handler                │
│                                                                             │
│  Routes (server/src/routes/)                                                │
│    ↓                                                                        │
│  Services (server/src/services/)                                            │
│    ↓                                                                        │
│  Database Layer (PostgreSQL)                                                │
│    • Management DB (coheus_management) ── Tenant registry, platform users   │
│    • Tenant DBs (tenant_*) ── Isolated per-tenant data                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Backend Architecture

### 1. Server Entry Point & Configuration

**Main Server File:** `server/src/index.ts`

#### Middleware Chain (in order)

1. **Sentry initialization** - Error tracking and performance monitoring
2. **Sentry request handler** - Captures request context
3. **Sentry tracing handler** - Performance tracing
4. **CORS** - Supports CloudFront and configured origins
5. **Request logging** - Dev (detailed) / Prod (concise with user/tenant)
6. **Body parsing** - JSON and URL-encoded (500MB limit for uploads)
7. **JSON parsing error handler** - Catches malformed JSON
8. **Cache-Control headers** - No-cache for API routes
9. **Rate limiting** - Skips `/health` endpoint
10. **Routes setup** - All API routes mounted
11. **Sentry error handler** - Captures errors
12. **Global error handler** - JSON error responses
13. **404 handler** - Unknown routes

#### Environment Configuration

```bash
# Required
JWT_SECRET=<min 32 characters>

# Database (Management DB)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=coheus_management
DB_USER=postgres
DB_PASSWORD=password

# Optional
MANAGEMENT_DB_NAME=coheus_management  # Override management DB name
FRONTEND_URL=http://localhost:5173    # CORS origin
SENTRY_DSN=<sentry dsn>               # Error tracking
SKIP_DB=true                          # Start without DB connection
PORT=3001                             # Server port (default: 3001)
```

#### WebSocket Support

- HTTP server with WebSocket upgrade support
- WebSocket setup via `services/websocket.ts`
- Used for real-time features (live data updates, voice sessions)

---

### 2. Routes Organization

**Route Registration:** `server/src/routes/index.ts`

All routes are prefixed with `/api/`:

#### Authentication & Authorization

| Route File | Base Path | Endpoints |
|------------|-----------|-----------|
| `auth.ts` | `/api/auth` | `POST /login`, `POST /register`, `POST /logout`, `GET /me`, `GET /tenants` |
| `admin.ts` | `/api/admin` | `GET /stats`, user/tenant CRUD, system management |

#### Core Business Data

| Route File | Base Path | Endpoints |
|------------|-----------|-----------|
| `loans.ts` | `/api/loans` | `GET /`, `GET /schema`, `GET /stats`, `GET /funnel`, `PUT /:loanId`, `DELETE /:loanId` |
| `scorecard/index.ts` | `/api/scorecard` | `GET /sales`, `GET /operations`, `GET /operations-trends`, `GET /sales-trends` |
| `toptiering/index.ts` | `/api/toptiering` | `GET /`, `GET /comparison` |
| `predictions/index.ts` | `/api/predictions` | `POST /`, `GET /status`, `GET /`, `GET /:loanId/recommendations` |

#### Dashboard & Analytics

| Route File | Base Path | Endpoints |
|------------|-----------|-----------|
| `dashboard/index.ts` | `/api/dashboard` | Dashboard routes aggregator |
| `dashboard/analytics.ts` | `/api/dashboard/analytics` | `GET /leaderboard`, `GET /insights`, `GET /overview` |
| `dashboard/data.ts` | `/api/dashboard/data` | Data endpoints |
| `dashboard/import.ts` | `/api/dashboard/import` | Import functionality |
| `dashboard/templates.ts` | `/api/dashboard/templates` | Template management |
| `dashboard/insightDetails.ts` | `/api/dashboard/insight-details` | `GET /details/:source` |

#### AI & RAG

| Route File | Base Path | Endpoints |
|------------|-----------|-----------|
| `rag.ts` | `/api/rag` | `GET/PUT /settings`, `GET/POST /sources`, `POST /documents/upload`, `GET /documents`, `GET /voice` |
| `ragKnowledgeBase.ts` | `/api/rag/knowledge-base` | Knowledge base management |
| `dataChat.ts` | `/api/data-chat` | Data chat/AI queries |

#### Integrations

| Route File | Base Path | Endpoints |
|------------|-----------|-----------|
| `los.ts` | `/api/los` | LOS connection management, sync operations |
| `encompass.ts` | `/api/encompass` | Encompass-specific endpoints |
| `synapse.ts` | `/api/synapse` | Synapse integration |
| `fieldMappings.ts` | `/api/field-mappings` | Field mapping management |

#### Platform Management

| Route File | Base Path | Endpoints |
|------------|-----------|-----------|
| `tenants.ts` | `/api/tenants` | Tenant management |
| `tenantConfig.ts` | `/api/tenant-config` | Tenant configuration |
| `subscriptions.ts` | `/api/subscriptions` | Subscription management |
| `metrics.ts` | `/api/metrics` | Metrics endpoints |
| `costs.ts` | `/api/costs` | Cost tracking |
| `deployments.ts` | `/api/deployments` | Deployment management |
| `aws-hosting.ts` | `/api/aws-hosting` | AWS hosting endpoints |
| `userPreferences.ts` | `/api/user` | User preferences |
| `demo.ts` | `/api/demo` | Demo endpoints |

#### Special Endpoints

```
GET /health           # Health check (bypasses rate limiting)
GET /api/health       # Health check (API-prefixed)
GET /                 # API info and version
GET /api/version      # Version info
```

---

### 3. Middleware

**Location:** `server/src/middleware/`

| Middleware | File | Purpose |
|------------|------|---------|
| **Authentication** | `auth.ts` | JWT verification, extracts `userId`, `email`, `role`, `tenantId` from token. Extends Express `Request` as `AuthRequest`. |
| **Tenant Context** | `tenantContext.ts` | Attaches tenant database pool and info to request. Supports admin tenant selection via `tenant_id` query param. Provides `TenantContext` interface. |
| **RBAC** | `rbac.ts` | Role-based access control. `requirePermission()`, `requireRole()`, `enforceTenantIsolation()`. Checks management DB for super admins. |
| **Logger** | `logger.ts` | Request logging with morgan. `devLogger` (detailed), `prodLogger` (concise with user/tenant), `errorLogger` (errors only). |
| **Rate Limiter** | `rateLimiter.ts` | Rate limiting per endpoint type. `apiLimiter` (500 req/15min), `authLimiter` (100 req/15min), `uploadLimiter` (10/hour), `costSyncLimiter` (5/hour). |
| **Cost Tracking** | `costTracking.ts` | Tracks API operation costs (voice AI, LLM, embeddings). Stores in `cost_events` table. |
| **Sentry** | `sentry.ts` | Error tracking initialization and handlers. |

#### Middleware Usage in Routes

```typescript
// Example route with middleware
router.get('/api/loans',
  authenticateToken,        // 1. Verify JWT
  attachTenantContext,      // 2. Attach tenant DB pool
  requireRole(['admin', 'tenant_admin', 'user']),  // 3. Check role
  async (req, res) => {
    const { tenantPool } = req.tenantContext;
    // Query tenant database
  }
);
```

---

### 4. Services Layer

**Location:** `server/src/services/`

#### Core Services

| Service | Purpose |
|---------|---------|
| `logger.ts` | Structured logging (`logError`, `logWarn`, `logInfo`, `logDebug`) |
| `auditLogger.ts` | Audit logging for compliance |
| `encryption.ts` | Field encryption/decryption for sensitive data |
| `versionService.ts` | Version info management |
| `websocket.ts` | WebSocket server for real-time features |

#### AI Services (`services/ai/`)

| Service | Purpose |
|---------|---------|
| `dataChatService.ts` | Natural language data queries |
| `queryBuilderService.ts` | SQL query generation from natural language |
| `prompts/dataChatPrompt.ts` | Prompt templates for AI |

#### Dashboard Services (`services/dashboard/`)

| Service | Purpose |
|---------|---------|
| `analyticsService.ts` | Analytics calculations and aggregations |
| `dataService.ts` | Core data operations |
| `importService.ts` | Data import (CSV, API) |
| `marketRateService.ts` | Market rate management |
| `predictionService.ts` | Loan prediction models |
| `recommendationService.ts` | AI-powered recommendations |
| `loanRag/` | Loan RAG (embeddings, aggregation, canonical loans) |

#### Connector Services (`services/connectors/`)

| Service | Purpose |
|---------|---------|
| `BaseConnector.ts` | Base connector interface |
| `ConnectorFactory.ts` | Connector factory pattern |
| `EncompassConnector.ts` | Encompass LOS integration |
| `MeridianLinkConnector.ts` | MeridianLink LOS integration |

#### ETL Services (`services/etl/`)

| Service | Purpose |
|---------|---------|
| `encompassEtlService.ts` | Encompass data extraction, transformation, loading |

#### Insights Services (`services/insights/`)

| Service | Purpose |
|---------|---------|
| `llmInsightGenerator.ts` | LLM-powered insight generation |
| `insightMetricsCollector.ts` | Metrics collection for insights |

#### Scoring Services (`services/scoring/`)

| Service | Purpose |
|---------|---------|
| `loanComplexityService.ts` | Loan complexity scoring |
| `topTieringService.ts` | Top tiering calculations |

#### Integration Services

| Service | Purpose |
|---------|---------|
| `encompassApiService.ts` | Encompass API client |
| `encompassCredentialsService.ts` | Encompass credentials management |
| `encompassFieldMapper.ts` | Encompass field mapping |
| `encompassLoanExtractor.ts` | Encompass loan extraction |
| `losApiService.ts` | Generic LOS API client |
| `losSyncScheduler.ts` | LOS sync scheduling |
| `vendorConnector.ts` | Vendor connector |
| `vendorSyncScheduler.ts` | Vendor sync scheduling |

#### Utility Services

| Service | Purpose |
|---------|---------|
| `csvProcessor.ts` | CSV parsing and processing |
| `csvTemplateService.ts` | CSV template management |
| `dataTransformer.ts` | Data transformation utilities |
| `documentChunker.ts` | Document chunking for RAG |
| `documentParser.ts` | Document parsing (PDF, DOCX) |
| `emailService.ts` | Email sending |
| `embeddingService.ts` | Vector embedding generation |
| `fieldMapper.ts` | Generic field mapping |
| `vectorDatabase.ts` | Vector database operations (pgvector) |

#### AWS Services

| Service | Purpose |
|---------|---------|
| `awsCostExplorer.ts` | AWS cost analysis |
| `awsProvisioning.ts` | AWS resource provisioning |
| `tenantProvisioningService.ts` | Tenant database provisioning |

---

### 5. Database Configuration

**Location:** `server/src/config/`

#### Main Database (`database.ts`)

```typescript
// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 50,                    // Max connections
  idleTimeoutMillis: 30000,   // 30 seconds
  connectionTimeoutMillis: 5000,
});
```

**Features:**
- Lazy initialization
- SSL auto-detection (enabled for non-localhost)
- Connection retry logic with exponential backoff
- Timezone set to UTC
- Schema creation on startup
- Migration runner

#### Management Database (`managementDatabase.ts`)

Separate pool for `coheus_management` database:

```typescript
// Stores:
// - Tenant metadata (coheus_tenants)
// - Platform users (coheus_users)
// - API keys, subscriptions
// - User-tenant mappings
```

**Features:**
- Health checks and pool recreation
- Retry logic for connection failures
- Migration status checking

#### Tenant Database Manager (`tenantDatabaseManager.ts`)

Manages per-tenant database connection pools:

```typescript
class TenantDatabaseManager {
  private tenantPools: Map<string, CachedPool>;
  private maxPoolCacheSize = 50;
  
  async getTenantPool(tenantId: string): Promise<pg.Pool> {
    // 1. Check cache
    // 2. Validate health
    // 3. Get config from management DB
    // 4. Create pool
    // 5. Cache and return
  }
}
```

**Features:**
- Pool caching (up to 50 tenants)
- Health validation with auto-recovery
- Schema enforcement on first connection
- Idle pool cleanup (every 5 minutes)
- Connection retry logic

#### Tenant Database Schema (`tenantDatabaseSchema.ts`)

Creates tenant-specific tables:
- `users`, `profiles`
- `loans`, `loan_history`, `loan_predictions`
- `employees`, `teams`, `branches`
- `documents`, `embeddings`
- And more...

**Note:** No `tenant_id` columns - complete database isolation per tenant.

---

## Frontend Architecture

### 1. API Layer

**File:** `src/lib/api.ts`

#### ApiClient Class

```typescript
export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private requestCache: Map<string, { data: any; timestamp: number }>;
  private pendingRequests: Map<string, Promise<any>>;
  private readonly CACHE_TTL = 30000; // 30 seconds

  // Core methods
  async request<T>(endpoint: string, options?: RequestInit): Promise<T>;
  setToken(token: string): void;
  clearToken(): void;
  clearCache(): void;
}

export const api = new ApiClient();
```

#### Base URL Detection

```typescript
export const getApiUrl = (): string => {
  // Priority:
  // 1. VITE_API_URL environment variable
  // 2. Development: empty string (Vite proxy)
  // 3. CloudFront: same-origin proxy
  // 4. localStorage.BACKEND_API_URL override
  // 5. Default to same origin
};
```

#### Token Management

```typescript
// Stored in localStorage under 'auth_token'
setToken(token: string) {
  this.token = token;
  localStorage.setItem('auth_token', token);
}

// Auto-attached to requests
headers['Authorization'] = `Bearer ${this.token}`;
```

#### Request Features

| Feature | Implementation |
|---------|---------------|
| **Caching** | 30s TTL for GET requests |
| **Deduplication** | Pending requests map prevents duplicate calls |
| **Retries** | Up to 2 retries for network errors with 2s delay |
| **Timeouts** | File uploads: 10min, Slow endpoints: 60s, Regular: 30s |
| **Error handling** | CORS detection, health checks, structured messages |

#### WebSocket Support

```typescript
createBackendWebSocket(path: string): WebSocket {
  // Bypasses CloudFront (no WebSocket support)
  // Connects directly to backend
  // Adds token as query parameter
}
```

---

### 2. Data Fetching Hooks

**Location:** `src/hooks/`

#### Common Pattern

```typescript
export function useDataHook(filters) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters.tenantId) params.append('tenant_id', filters.tenantId);
      // ... add other filters
      
      const response = await api.request<T>(`/api/endpoint?${params}`);
      setData(response);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
```

#### Admin Hooks (`src/hooks/admin/`)

| Hook | Purpose | Endpoint |
|------|---------|----------|
| `useAdminStats.ts` | Platform statistics | `/api/admin/stats` |
| `useAdminState.ts` | Admin UI state | (local state) |
| `useTenants.ts` | Tenant CRUD | `/api/tenants` |
| `useUsers.ts` | User management | `/api/admin/users` |
| `useSystemInfo.ts` | Infrastructure info | `/api/admin/system` |
| `useSecurityInfo.ts` | Security settings | `/api/admin/security` |
| `useLOSConnections.ts` | LOS integrations | `/api/los/connections` |
| `useSynapseConnections.ts` | Vendor connections | `/api/synapse` |
| `useDeployments.ts` | Deployments | `/api/deployments` |
| `useRAGSettings.ts` | AI/RAG config | `/api/rag/settings` |
| `useStripeData.ts` | Subscriptions | `/api/subscriptions` |

#### Dashboard Hooks

| Hook | Purpose | Endpoint |
|------|---------|----------|
| `useDashboardStats.ts` | Loan statistics | `/api/loans/stats` |
| `useCompanyData.ts` | Company details | `/api/loans/company-data` |
| `useCompanyMetrics.ts` | Metrics calculations | (derived) |
| `useCompanyScorecardData.ts` | Scorecard | `/api/scorecard/company` |
| `useSalesData.ts` | Sales metrics | `/api/scorecard/sales` |
| `useSalesScorecardData.ts` | Sales scorecard | `/api/scorecard/sales` |
| `useSalesTrendsData.ts` | Sales trends | `/api/scorecard/sales-trends` |
| `useOperationsScorecardData.ts` | Operations | `/api/scorecard/operations` |
| `useOperationsScorecardTrendsData.ts` | Operations trends | `/api/scorecard/operations-trends` |
| `useTopTieringData.ts` | Top tiering | `/api/toptiering` |
| `useTopTieringComparisonData.ts` | Comparison | `/api/toptiering/comparison` |
| `useCreditRiskData.ts` | Credit risk | `/api/loans/credit-risk` |
| `useLeaderboardData.ts` | Leaderboard | `/api/dashboard/analytics/leaderboard` |
| `useFunnelData.ts` | Funnel visualization | `/api/loans/funnel` |
| `useAletheiaData.ts` | AI insights | `/api/dashboard/insights` |

---

### 3. Contexts & State Management

**Location:** `src/contexts/`

#### AuthContext (`AuthContext.tsx`)

**Purpose:** Authentication and user state management

```typescript
interface AuthContextType {
  // State
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  tenants: TenantInfo[];
  impersonatingTenant: string | null;
  
  // Actions
  login: (email: string, password: string, tenantSlug?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  loadTenants: () => Promise<void>;
  
  // Role checks
  hasRole: (role: UserRole | UserRole[]) => boolean;
  isSuperAdmin: () => boolean;
  isPlatformStaff: () => boolean;
  isTenantAdmin: () => boolean;
  isAdmin: () => boolean;
  
  // Impersonation (super admin)
  impersonateTenant: (tenantSlug: string) => void;
  stopImpersonating: () => void;
}
```

**Server Interaction:**
- `api.getCurrentUser()` on mount to validate token
- `api.request('/api/auth/signin')` for login
- `api.request('/api/auth/tenants')` to load tenant list

#### DashboardContext (`DashboardContext.tsx`)

**Purpose:** Dashboard filters and view state

```typescript
interface DashboardContextType {
  dateFilter: DateFilterType;  // 'today' | 'mtd' | 'ytd' | 'custom'
  customDateRange: CustomDateRange;
  selectedTenantId: string | null;
  selectedChannel: string | null;
  year: number;
  
  setDateFilter: (filter: DateFilterType) => void;
  setCustomDateRange: (range: CustomDateRange) => void;
  setSelectedTenantId: (id: string | null) => void;
  // ...
}
```

**Note:** Client-side only; filters are passed to hooks/API calls as parameters.

#### AdminTenantContext (`AdminTenantContext.tsx`)

**Purpose:** Tenant selection for admin sections

```typescript
interface AdminTenantContextType {
  selectedTenantId: string | null;
  setSelectedTenantId: (id: string | null) => void;
  tenants: AdminTenant[];
  tenantsLoading: boolean;
  loadTenants: () => Promise<void>;
  isTenantAdmin: boolean;
  isPlatformAdmin: boolean;
  currentTenantName: string | null;
}
```

**Behavior:**
- Tenant admins: Auto-locked to their tenant
- Platform admins: Can select any tenant

---

### 4. Pages & Components Pattern

#### Data Flow Hierarchy

```
Page Component
  │
  ├── Uses Contexts (useAuth, useDashboard, useAdminTenant)
  │
  ├── Uses Data Hooks (useCompanyData, useDashboardStats, etc.)
  │     │
  │     └── Hooks call api.request() → Backend API
  │
  ├── Local state for UI (filters, modals, selections)
  │
  └── Renders child components with { data, loading, error }
```

#### Example: Admin Page Pattern

```typescript
// src/pages/Admin.tsx
export function Admin() {
  // 1. Auth context for user info
  const { user, isSuperAdmin } = useAuth();
  
  // 2. Tenant context for selection
  const { selectedTenantId, tenants } = useAdminTenant();
  
  // 3. Local UI state
  const [activeSection, setActiveSection] = useState('overview');
  
  // 4. Data hooks for each section
  const { stats, loading: statsLoading } = useAdminStats();
  const { systemInfo, loadSystemInfo } = useSystemInfo();
  
  // 5. Lazy load data when section changes
  useEffect(() => {
    if (activeSection === 'system') {
      loadSystemInfo();
    }
  }, [activeSection]);
  
  // 6. Render with loading states
  return (
    <div>
      <Sidebar activeSection={activeSection} onChange={setActiveSection} />
      <main>
        {activeSection === 'overview' && (
          statsLoading ? <Loading /> : <OverviewSection stats={stats} />
        )}
        {/* ... other sections */}
      </main>
    </div>
  );
}
```

#### Example: Dashboard Page Pattern

```typescript
// src/pages/Dashboard.tsx
export function Dashboard() {
  // 1. Dashboard context for filters
  const { dateFilter, selectedTenantId } = useDashboard();
  
  // 2. Data hooks with filters
  const { statsData, statsLoading } = useDashboardStats(dateFilter, selectedTenantId);
  const { funnelData, funnelLoading } = useFunnelData(dateFilter, selectedTenantId);
  
  // 3. Direct API calls for complex data
  const [insights, setInsights] = useState(null);
  useEffect(() => {
    const loadInsights = async () => {
      const data = await api.request(`/api/dashboard/insights?dateFilter=${dateFilter}`);
      setInsights(data);
    };
    loadInsights();
  }, [dateFilter, selectedTenantId]);
  
  // 4. Render dashboard sections
  return (
    <DashboardLayout>
      <StatsSection data={statsData} loading={statsLoading} />
      <FunnelSection data={funnelData} loading={funnelLoading} />
      <InsightsSection data={insights} />
    </DashboardLayout>
  );
}
```

#### Component Hierarchy

```
src/
├── pages/              # Top-level route components
│   ├── Dashboard.tsx
│   ├── Admin.tsx
│   ├── CompanyScorecard.tsx
│   └── ...
│
├── components/
│   ├── layout/         # Navigation, headers, sidebars
│   │   ├── Navigation.tsx
│   │   ├── Header.tsx
│   │   └── Sidebar.tsx
│   │
│   ├── dashboard/      # Dashboard-specific components
│   │   ├── StatsCard.tsx
│   │   ├── FunnelChart.tsx
│   │   └── LeaderboardTable.tsx
│   │
│   ├── admin/          # Admin section components
│   │   ├── TenantsSection.tsx
│   │   ├── UsersSection.tsx
│   │   └── SystemSection.tsx
│   │
│   └── ui/             # Reusable UI primitives (shadcn/ui)
│       ├── Button.tsx
│       ├── Card.tsx
│       └── Dialog.tsx
```

---

### 5. Types & Interfaces

**Location:** `src/types/`

#### Domain Types (`src/types/`)

```typescript
// businessOverview.ts
interface BusinessOverviewData {
  activeLoans: ActiveLoansData;
  closedLoans: ClosedLoansData;
  lockedLoans: LockedLoansData;
  cycleTime: CycleTimeData;
  pullThrough: PullThroughData;
  creditPulls: CreditPullsData;
}

// funnel.ts
interface FunnelDataPoint {
  stage: string;
  count: number;
  value: number;
  conversionRate: number;
}

// savedViews.ts
interface SavedView {
  id: string;
  name: string;
  filters: SavedViewFilters;
  visibility: SavedViewVisibility;
}
```

#### Context Types (in context files)

```typescript
// AuthContext.tsx
interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  is_super_admin: boolean;
  tenant_id?: string | null;
  tenant_name?: string | null;
  tenant_slug?: string | null;
}

type UserRole = 
  | 'super_admin' 
  | 'platform_admin' 
  | 'support'
  | 'tenant_admin' 
  | 'admin' 
  | 'user' 
  | 'viewer';
```

#### Hook Types (in hook files)

```typescript
// useDashboardStats.ts
interface DashboardStatsData {
  totalLoans: number;
  totalVolume: number;
  averageLoanSize: number;
  closingRate: number;
  // ...
}

// useCompanyData.ts
interface Loan {
  loan_number: string;
  borrower_name: string;
  loan_amount: number;
  status: string;
  // ...
}
```

#### Type Safety Pattern

```typescript
// API calls use generics
const response = await api.request<DashboardStatsData>('/api/loans/stats');

// Hooks return typed data
const { data, loading, error } = useDashboardStats();
// data is DashboardStatsData | null
```

---

## Frontend-Backend Interaction Flow

### Complete Request Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                 FRONTEND                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│  1. User action (page load, button click, filter change)                     │
│                              ↓                                               │
│  2. Hook triggered (useEffect dependency change)                             │
│                              ↓                                               │
│  3. Build URL with query params                                              │
│     /api/loans/stats?tenant_id=xxx&dateFilter=mtd                            │
│                              ↓                                               │
│  4. api.request() called                                                     │
│     - Check cache (GET only)                                                 │
│     - Check pending requests (deduplication)                                 │
│     - Add Authorization header with JWT                                      │
│                              ↓                                               │
│  5. fetch() with timeout and retry logic                                     │
└──────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              NETWORK                                         │
├──────────────────────────────────────────────────────────────────────────────┤
│  Dev: Vite proxy (localhost:5173 → localhost:3001)                           │
│  Prod: CloudFront → ALB → EC2/ECS                                            │
└──────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                                 BACKEND                                      │
├──────────────────────────────────────────────────────────────────────────────┤
│  6. Middleware chain executes:                                               │
│     a. Rate limiter checks                                                   │
│     b. authenticateToken → verify JWT, extract user info                     │
│     c. attachTenantContext → resolve tenant, get DB pool                     │
│     d. requireRole (if applicable)                                           │
│                              ↓                                               │
│  7. Route handler executes:                                                  │
│     - Access req.tenantContext.tenantPool                                    │
│     - Query tenant database                                                  │
│     - Call services for business logic                                       │
│     - Return JSON response                                                   │
└──────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                                 FRONTEND                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│  8. Response received:                                                       │
│     - Parse JSON                                                             │
│     - Cache response (GET only)                                              │
│     - Update hook state (setData, setLoading)                                │
│                              ↓                                               │
│  9. React re-renders with new data                                           │
│                              ↓                                               │
│  10. UI updated                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Tenant Selection Flow

```
Platform Admin selects tenant in UI
           ↓
AdminTenantContext.setSelectedTenantId(tenantId)
           ↓
Data hooks receive selectedTenantId via context or prop
           ↓
Hooks include ?tenant_id=xxx in API calls
           ↓
Backend attachTenantContext middleware:
  - Sees tenant_id query param
  - Verifies user is admin
  - Looks up tenant in management DB
  - Gets tenant database pool
  - Attaches to req.tenantContext
           ↓
Route handler queries correct tenant database
```

---

## Security Architecture

### Authentication Flow

```
1. User submits credentials
   POST /api/auth/signin { email, password, tenantSlug? }
           ↓
2. Backend validates credentials
   - Check management DB for super admin
   - Check tenant DBs for tenant user
           ↓
3. JWT generated with claims:
   { userId, email, role, tenantId, tenantSlug, isSuperAdmin }
           ↓
4. Token returned to frontend
   Frontend stores in localStorage
           ↓
5. Subsequent requests include token
   Authorization: Bearer <token>
           ↓
6. Backend validates on each request
   authenticateToken middleware
```

### Authorization Layers

| Layer | Implementation | Purpose |
|-------|---------------|---------|
| **JWT Validation** | `authenticateToken` middleware | Verify token signature and expiry |
| **Role Check** | `requireRole()` middleware | Ensure user has required role |
| **Permission Check** | `requirePermission()` middleware | Fine-grained action permissions |
| **Tenant Isolation** | `attachTenantContext` middleware | Ensure user can only access their tenant's data |
| **Rate Limiting** | `rateLimiter` middleware | Prevent abuse |

### Data Isolation

- Each tenant has a completely separate database
- Tenant ID embedded in JWT prevents cross-tenant access
- Admin override (`tenant_id` query param) validated server-side
- No `tenant_id` columns in tenant databases (complete isolation)

---

## Key Files Reference

### Backend

| Category | File | Purpose |
|----------|------|---------|
| **Entry** | `server/src/index.ts` | Server setup, middleware chain |
| **Routes** | `server/src/routes/index.ts` | Route registration |
| **Auth** | `server/src/routes/auth.ts` | Authentication endpoints |
| **Middleware** | `server/src/middleware/auth.ts` | JWT authentication |
| **Middleware** | `server/src/middleware/tenantContext.ts` | Tenant context |
| **Middleware** | `server/src/middleware/rbac.ts` | Role-based access |
| **Config** | `server/src/config/database.ts` | Main DB connection |
| **Config** | `server/src/config/managementDatabase.ts` | Management DB |
| **Config** | `server/src/config/tenantDatabaseManager.ts` | Tenant DB pools |
| **Services** | `server/src/services/dashboard/` | Dashboard business logic |
| **Services** | `server/src/services/ai/` | AI/RAG services |

### Frontend

| Category | File | Purpose |
|----------|------|---------|
| **API** | `src/lib/api.ts` | API client |
| **Auth** | `src/contexts/AuthContext.tsx` | Authentication state |
| **Tenant** | `src/contexts/AdminTenantContext.tsx` | Tenant selection |
| **Dashboard** | `src/contexts/DashboardContext.tsx` | Dashboard filters |
| **Hooks** | `src/hooks/admin/` | Admin data hooks |
| **Hooks** | `src/hooks/useDashboardStats.ts` | Dashboard stats |
| **Hooks** | `src/hooks/useCompanyData.ts` | Company data |
| **Types** | `src/types/` | Shared type definitions |
| **Pages** | `src/pages/` | Route components |

### Shared Configuration

| File | Purpose |
|------|---------|
| `server/.env` | Backend environment variables |
| `.env` / `.env.local` | Frontend environment variables |
| `vite.config.ts` | Vite configuration (proxy) |
| `server/tsconfig.json` | Backend TypeScript config |
| `tsconfig.json` | Frontend TypeScript config |

---

## Architecture Patterns Summary

### Backend Patterns

| Pattern | Implementation |
|---------|---------------|
| **Multi-tenant** | Database per tenant with management DB registry |
| **Middleware chain** | Express middleware for auth, tenant, RBAC, logging |
| **Service layer** | Business logic separated from routes |
| **Connection pooling** | Cached pools with health checks and eviction |
| **Error handling** | Sentry + global error handler + retries |

### Frontend Patterns

| Pattern | Implementation |
|---------|---------------|
| **API client** | Centralized with caching, retries, token management |
| **Custom hooks** | useState + useEffect for data fetching |
| **Context providers** | Global state (auth, dashboard, tenant) |
| **Type safety** | TypeScript generics for API calls |
| **Component composition** | Pages → Sections → UI components |

### Integration Patterns

| Pattern | Implementation |
|---------|---------------|
| **JWT auth** | Token in localStorage, Authorization header |
| **Tenant selection** | Query param (`tenant_id`) for admin override |
| **Filter propagation** | Context → Hooks → URL params → Backend |
| **Loading states** | `{ data, loading, error }` tuple from hooks |
| **Cache invalidation** | Manual refetch via hook callback |
