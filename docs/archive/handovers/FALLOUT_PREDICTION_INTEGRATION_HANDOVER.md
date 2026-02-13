# Fallout Prediction Feature Integration Handover

## Overview

This document provides instructions for integrating the **Fallout Prediction** feature from an old branch (`teraverde-cohi-98c5fb70fdbb`) into the current main codebase. The feature adds AI-powered loan outcome prediction using RAG (Retrieval-Augmented Generation) with market rate analysis.

**Source Branch Location**: `C:\Users\MPetrovic\Documents\Cohi\teraverde-cohi-98c5fb70fdbb`
**Target Codebase**: `C:\Users\MPetrovic\Documents\Cohi\cohi`

---

## Feature Summary

The Fallout Prediction feature provides:

1. **Market Rate Integration** - Fetches and stores mortgage rates from FRED API for market delta calculations
2. **Loan Bucketing** - Categorizes loans by signal strength (credit metrics, time in motion, pullthrough rates, etc.)
3. **RAG-based Prediction** - Uses pgvector embeddings and GPT-5-mini to predict loan outcomes (withdraw/deny/originate)
4. **Manual Prediction Trigger** - "Start Prediction" button with polling for completion status
5. **Knowledge Base Admin** - Super-admin UI for managing RAG knowledge entries
6. **Prediction Storage** - Persists predictions to database for display and analytics

---

## Files to Copy (New Files)

These files do not exist in the current codebase and should be copied directly:

### Backend Services

| Source Path | Target Path |
|------------|-------------|
| `server/src/services/dashboard/marketRateService.ts` | `server/src/services/dashboard/marketRateService.ts` |
| `server/src/services/dashboard/predictionService.ts` | `server/src/services/dashboard/predictionService.ts` |
| `server/src/services/dashboard/recommendationService.ts` | `server/src/services/dashboard/recommendationService.ts` |
| `server/src/services/dashboard/loanRag/` (entire folder) | `server/src/services/dashboard/loanRag/` |

**loanRag folder contents:**
- `canonicalLoan.ts` - Builds deterministic text representation of loans for embedding
- `config.ts` - RAG tuning parameters (signal fields, top-K, embedding model, batch size)
- `index.ts` - Re-exports for the prediction service
- `loanAggregation.ts` - Aggregates similar-historical search results for GPT prompt
- `loanEmbeddingStore.ts` - pgvector read/write operations for loan embeddings

### Backend Routes

| Source Path | Target Path |
|------------|-------------|
| `server/src/routes/ragKnowledgeBase.ts` | `server/src/routes/ragKnowledgeBase.ts` |

### Frontend Components

| Source Path | Target Path |
|------------|-------------|
| `src/components/admin/KnowledgeBaseEditor.tsx` | `src/components/admin/KnowledgeBaseEditor.tsx` |
| `src/components/admin/RichTextEditor.tsx` | `src/components/admin/RichTextEditor.tsx` |

### Frontend Hooks

| Source Path | Target Path |
|------------|-------------|
| `src/hooks/useKnowledgeBase.ts` | `src/hooks/useKnowledgeBase.ts` |

### Static Files

| Source Path | Target Path |
|------------|-------------|
| `public/sync-market-rates.html` | `public/sync-market-rates.html` |

### Docker/Infrastructure

| Source Path | Target Path |
|------------|-------------|
| `docker-compose.pgvector.yml` | `docker-compose.pgvector.yml` |

### Documentation

| Source Path | Target Path |
|------------|-------------|
| `docs/PGVECTOR_LOCAL_SETUP.md` | `docs/PGVECTOR_LOCAL_SETUP.md` |

---

## Database Migrations

**Note**: The `supabase/migrations/` folder is just a naming convention for organizing SQL files - you're using plain PostgreSQL (not Supabase). These are standard SQL migrations that run against your PostgreSQL database.

Copy these migration files from `supabase/migrations/` (in order):

1. **`20260121124201_create_market_rates_table.sql`**
   - Creates `public.market_rates` table for FRED API data
   - Stores daily 30-Year Fixed Rate Conforming Mortgage Index (OBMMIC30YF)

2. **`20260122000000_create_rag_knowledge_base.sql`**
   - Creates `public.rag_knowledge_base` for admin-managed RAG entries
   - Fields: title, category, content, keywords, is_active, priority

3. **`20260123000000_create_ai_pattern_learnings.sql`**
   - Creates `public.ai_pattern_learnings` for AI-learned patterns from historical loans
   - Used to cache pattern summaries to avoid re-processing

4. **`20260124000000_create_loan_predictions.sql`**
   - Creates `public.loan_predictions` for storing prediction results
   - Fields: tenant_id, loan_id, outcome, confidence, reasoning, risk_factors

5. **`20260125000000_historical_loan_bucket_cache.sql`**
   - Creates `public.historical_loan_bucket_cache` for precomputed bucket snapshots
   - Speeds up repeated bucketing operations

6. **`20260126000000_loan_outcome_embeddings.sql`**
   - **IMPORTANT**: Requires pgvector extension (`CREATE EXTENSION IF NOT EXISTS vector`)
   - Creates `public.loan_outcome_embeddings` with `vector(1536)` column
   - Stores embeddings for similarity search
   - Your codebase already uses pgvector (see `database.ts` line 1568, 1683)

---

## Files Requiring Merge (Modified in Both Branches)

These files exist in both codebases and need careful merging:

### 1. `server/src/routes/loans.ts`

**Add these new endpoints** (from old branch ~lines 1097-1700):

```typescript
// POST /api/loans/predict
// Triggers AI prediction for active loans

// GET /api/loans/predict/status  
// Returns { inProgress: boolean } for frontend polling

// GET /api/loans/predictions
// Fetches stored predictions from database

// POST /api/loans/sync-market-rates
// Syncs market rates from FRED API

// GET /api/loans/predict/debug
// Debug endpoint showing prompt and learnings status
```

**Key integration points:**
- Uses `predictionService.predictLoanOutcomes()`
- Uses `predictionService.getPredictInProgress()`
- Uses `marketRateService.syncMarketRatesFromFRED()`
- Requires tenant resolution logic for super_admin support

### 2. `server/src/routes/index.ts`

**Add route mount:**
```typescript
import ragKnowledgeBaseRouter from './ragKnowledgeBase.js';
// ...
app.use('/api/rag/knowledge-base', ragKnowledgeBaseRouter);
```

### 3. `server/src/config/database.ts`

**Add schema checks/creation** for these tables on startup:
- `loan_outcome_embeddings`
- `rag_knowledge_base`
- `ai_pattern_learnings`
- `loan_predictions`
- `historical_loan_bucket_cache`

This ensures tables exist even if migrations haven't run.

### 4. `src/App.tsx`

**Add routing for Knowledge Base admin:**
```typescript
import { KnowledgeBaseEditor } from '@/components/admin/KnowledgeBaseEditor';
// ...
<Route path="/admin/knowledge-base" element={<KnowledgeBaseEditor />} />
```

### 5. `src/components/dashboard/ClosingFalloutForecast.tsx`

This is the **most significant merge**. The old branch adds ~682 lines:

**Key additions:**
- `runPrediction` function - POSTs to `/api/loans/predict`
- `fetchStoredPredictions` function - Gets stored predictions
- Polling logic using `pollIntervalRef` 
- `predictionsLoading` state for UI feedback
- "Start Prediction" button with loading state
- Display of AI predictions in loan cards/metrics

**Integration approach:**
1. Add state variables: `predictions`, `predictionsLoading`, `pollIntervalRef`
2. Add `runPrediction` function with POST + polling
3. Add `fetchStoredPredictions` callback
4. Add "Start Prediction" button to the UI
5. Update metrics display to show AI predictions when available

### 6. `src/components/dashboard/LoanCardsContainer.tsx`

**Add prediction display** (~41 lines):
- Show outcome badges (withdraw/deny/originate)
- Display confidence percentages
- Style risk indicators based on prediction

### 7. `src/components/layout/Navigation.tsx`

**Add nav link** (~14 lines):
```typescript
{ name: 'Knowledge Base', href: '/admin/knowledge-base', icon: BookOpenIcon }
```

### 8. `src/lib/api.ts`

**Add API helpers** (~11 lines):
- Helper for `/api/loans/predict`
- Helper for `/api/loans/predict/status`
- Helper for `/api/rag/knowledge-base`

---

## Environment Variables Required

Add to `.env`:

```bash
# FRED API for market rates
FRED_API_KEY=your_fred_api_key_here

# OpenAI for predictions (may already exist)
OPENAI_API_KEY=your_openai_api_key_here

# Optional: Prediction model (defaults to gpt-5-mini)
PREDICTION_MODEL=gpt-5-mini

# Optional: RAG tuning
LOAN_RAG_TOP_K=30
LOAN_RAG_EMBEDDING_MODEL=openai/text-embedding-3-small
LOAN_RAG_EMBED_BATCH_SIZE=50
```

---

## pgvector Setup

The RAG feature requires PostgreSQL with pgvector extension.

**Current State**: pgvector has been **compiled and installed** in your `coheus-postgres` container. It's already enabled in `coheus_tenant_homestead`.

### Option 1: Compile pgvector in Existing Container (DONE)

If starting fresh or on another machine, run these commands to compile and install pgvector:

```bash
# Install build dependencies and compile pgvector
docker exec coheus-postgres sh -c "apk add --no-cache git build-base && cd /tmp && git clone --branch v0.7.4 https://github.com/pgvector/pgvector.git && cd pgvector && make OPTFLAGS='' USE_PGXS=1"

# Manually copy the compiled files (JIT build may fail but core .so works)
docker exec coheus-postgres sh -c "cp /tmp/pgvector/vector.so /usr/local/lib/postgresql/ && cp /tmp/pgvector/vector.control /usr/local/share/postgresql/extension/ && cp /tmp/pgvector/sql/vector--0.7.4.sql /usr/local/share/postgresql/extension/"

# Enable in tenant database(s)
docker exec coheus-postgres psql -U postgres -d coheus_tenant_homestead -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### Option 2: Use pgvector-enabled Image (Alternative)

Replace the Postgres image in `docker-compose.yml` with a pre-built pgvector image:
```yaml
image: pgvector/pgvector:pg15
```

This requires recreating the container and restoring data.

### Option 3: Docker Override

Use `docker-compose.pgvector.yml` from the old branch which switches to a pgvector-enabled image:
```bash
docker-compose -f docker-compose.yml -f docker-compose.pgvector.yml up -d
```

**Note**: For AWS RDS, pgvector is available via parameter groups in supported regions.

---

## Integration Order

Follow this order to minimize conflicts:

1. **Database first**
   - Copy and run migrations in order
   - Verify tables created with `\dt public.*` in psql

2. **Backend services**
   - Copy `loanRag/` folder
   - Copy `marketRateService.ts`, `predictionService.ts`, `recommendationService.ts`
   - Copy `ragKnowledgeBase.ts` route

3. **Backend routes integration**
   - Add ragKnowledgeBase to `routes/index.ts`
   - Add prediction endpoints to `loans.ts`
   - Add schema checks to `database.ts`

4. **Frontend components**
   - Copy new components (`KnowledgeBaseEditor`, `RichTextEditor`)
   - Copy `useKnowledgeBase` hook

5. **Frontend integration**
   - Update `App.tsx` with routes
   - Update `Navigation.tsx` with links
   - Merge `ClosingFalloutForecast.tsx` changes
   - Update `LoanCardsContainer.tsx`
   - Update `api.ts`

6. **Test**
   - Sync market rates: POST `/api/loans/sync-market-rates`
   - Run prediction: Use "Start Prediction" button
   - Check predictions: GET `/api/loans/predictions`
   - Admin knowledge base: Navigate to `/admin/knowledge-base`

---

## Key Implementation Details

### Prediction Flow

1. User clicks "Start Prediction" in ClosingFalloutForecast
2. Frontend POSTs to `/api/loans/predict`
3. Backend sets `predictInProgressByTenant[tenantId] = true`
4. Backend runs in background:
   - Fetches active loans
   - Calculates signal buckets (FICO, LTV, DTI, etc.)
   - Embeds loans using OpenAI embeddings
   - Searches similar historical loans (pgvector)
   - Calls GPT-5-mini for outcome prediction
   - Stores results in `loan_predictions`
5. Frontend polls `/api/loans/predict/status` every 2-3 seconds
6. When `inProgress: false`, frontend fetches `/api/loans/predictions`
7. UI updates with prediction badges

### RAG Architecture (How Vectorization Works)

**Important**: The `loans` table is NOT modified. Embeddings are stored in a **separate table**.

```
┌─────────────────┐     ┌──────────────────────────┐
│  loans table    │     │  loan_outcome_embeddings │
│  (unchanged)    │     │  (new table)             │
├─────────────────┤     ├──────────────────────────┤
│ id              │────▶│ loan_id (FK)             │
│ fico_score      │     │ canonical_text           │
│ ltv             │     │ embedding vector(1536)   │
│ loan_amount     │     │ outcome                  │
│ ...             │     │ tenant_id                │
└─────────────────┘     └──────────────────────────┘
```

**How it works:**
1. `canonicalLoan.ts` converts loan fields → text string (e.g., "FICO:Strong LTV:Medium DTI:Low...")
2. `loanEmbeddingStore.ts` calls OpenAI API → generates 1536-dimension vector
3. Vector stored in `loan_outcome_embeddings` (linked by loan_id)
4. Similarity search uses `ORDER BY embedding <=> query_embedding` (pgvector operator)

**Key points:**
- Embeddings are created on-demand when predictions run
- Historical loans embedded once, cached in DB
- Active loans embedded at prediction time, compared to historical
- Your existing `loans` table queries work exactly the same

### Signal Strength Buckets

The prediction service calculates these signals:
- `creditMetricsSignalStrength` - FICO, LTV, DTI, CLTV
- `loanCharacteristicsSignalStrength` - Amount, type, purpose, occupancy
- `timeInMotionSignalStrength` - Days active, milestone progress
- `mloAeFalloutProneSignalStrength` - LO/processor pullthrough history
- `interestLockVsMarketSignalStrength` - Lock rate vs market delta
- `uwPullthroughSignalStrength` - Underwriter historical success

### Market Rate Delta

Compares loan's interest lock rate to market rate at lock date:
- Positive delta (above market) = higher fallout risk
- Negative delta (below market) = lower fallout risk

---

## Testing Checklist

- [ ] Database migrations run without errors
- [ ] pgvector extension enabled (`SELECT * FROM pg_extension WHERE extname = 'vector'`)
- [ ] Market rates sync works (check `public.market_rates` has data)
- [ ] Prediction endpoint returns 200 (with active loans in DB)
- [ ] Polling endpoint returns `{ inProgress: boolean }`
- [ ] Predictions are stored in `public.loan_predictions`
- [ ] Frontend "Start Prediction" button works
- [ ] Frontend shows loading state during prediction
- [ ] Frontend displays predictions after completion
- [ ] Knowledge Base admin UI accessible (super_admin only)
- [ ] Knowledge Base CRUD operations work

---

## Known Issues / Gotchas

1. **pgvector not found**: Ensure you're using the pgvector Docker override or have installed the extension manually.

2. **FRED API rate limits**: The FRED API has rate limits. The service includes caching to minimize calls.

3. **Large prediction batches**: Processing many loans can take several minutes. The polling mechanism handles this, but ensure `ACTIVE_LOAN_BATCH_SIZE` (default 100) is appropriate.

4. **Embedding costs**: OpenAI embedding calls cost money. Monitor usage in development.

5. **Tenant resolution**: The prediction endpoints support super_admin users who can specify `tenant_id` via query param. Regular users use their profile's tenant.

6. **Schema conflicts**: The `database.ts` startup checks may conflict with migration-created tables. Test both paths (fresh DB vs migrated DB).

---

## Reference Files in Old Branch

For detailed implementation reference, see:

- `CHANGES_SINCE_CLONE.md` - Full changelog with line numbers
- `predictionService.ts` - 2900+ lines of prediction logic
- `marketRateService.ts` - 473 lines of FRED API integration
- `ClosingFalloutForecast.tsx` - Main UI component

---

## Contact / Questions

If you encounter issues during integration, check:
1. The `CHANGES_SINCE_CLONE.md` document for specific line references
2. The old branch files directly for implementation details
3. The `_debug` endpoint at `/api/loans/predict/debug` for diagnostics
