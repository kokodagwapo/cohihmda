# AI Infrastructure & Implementation Audit (Codebase)

**Scope:** Repository scan as of 2026-04-13.  
**Purpose:** Inform a decision on pivoting to sovereign / self-hosted AI given 2026 compute scarcity.  
**Note on naming:** **GPT-5.3**, **Claude Opus 4.6**, and similar identifiers appear in **Cursor IDE / agent configuration**, not in this application codebase. In-repo LLM usage is **OpenAI** (Chat Completions, Embeddings, Realtime, TTS), **Google Gemini** (Generative Language WS, client SDK), optional **Cohere/AWS** embedding paths in code, and **Whisper** (speech-to-text) in podcast flows.

---

## 1. Model inventory

| Model (as in code) | Role | Temperature / max tokens (or equivalent) | Primary call sites |
| ------------------ | ---- | ------------------------------------------ | ------------------ |
| **gpt-5.2** | Default for shared `callLLM()` when caller omits `model` | Default: **0.4** / **4000** (`max_completion_tokens`) | `server/src/services/research/tools.ts` (`callLLM` defaults) |
| **gpt-5.2** | Dashboard insights pipeline (admin-configurable via DB) | Per `defaultPromptConfigs`: e.g. generator **0.7** / **15000**, judge **0.1** / **4000**, curator **0.2** / **14000**, evidence agent **0.1** / **6000** | `server/src/config/defaultPromptConfigs.ts`; executed in `server/src/services/dashboardInsights/pipeline.ts` via `getPromptConfig` + `callLLM` |
| **gpt-4o** | Cohi Chat (hardcoded API model) | Query generation (defaults): **0.2** / **1500**; SQL fix retry: **0.1** / **1500**; final response uses prompt config: default **0.7** / **1200**; SQL modify: **0.3** / **3000** | `server/src/services/ai/cohiChatService.ts` (`callOpenAI` uses `model: "gpt-4o"` always); defaults in `defaultPromptConfigs.ts` (`cohi_chat.*`) — **see §6 config drift** |
| **gpt-4o** | Podcast / briefing script, Q&A | Briefing: **0.7** / **1500**; Cohi script: **0.6** / **2400**; Q&A: **0.5** / **1000**–**1200** | `server/src/routes/podcast.ts` (`CHAT_MODEL`) |
| **gpt-4o-mini** | Metrics catalog explanations | **0.7** / **1000** (defaults) | `server/src/services/metrics/metricsAiService.ts` |
| **gpt-4o-mini** | News ranking & article insights | Ranking: **0.2** / **600**; insights: **0.7** / **800** | `server/src/services/newsService.ts` |
| **gpt-4o-mini** | Ad hoc loan route helper | **0.7** / **500** | `server/src/routes/loans.ts` |
| **gpt-4o-mini** | OpenAI Realtime (voice) | Session params via Realtime API (not the same as `temperature` on chat) | `server/src/services/websocket.ts` (`gpt-4o-mini-realtime-preview-2024-12-17`) |
| **gpt-4o-mini-tts** | Podcast TTS | N/A (TTS pricing tracked separately in `llmUsageTracker`) | `server/src/routes/podcast.ts` (`TTS_MODEL`) |
| **gpt-5-mini** | Loan prediction + learning (env override) | Learning: **max_completion_tokens 1000**; main prediction: **JSON mode**, temperature omitted (API default) | `server/src/services/dashboard/predictionService.ts` (`PREDICTION_MODEL` default `gpt-5-mini`) |
| **gpt-4o** | Recommendations service | **0.3**, `response_format` JSON; max output not set in body snippet | `server/src/services/dashboard/recommendationService.ts` (`RECOMMENDATION_MODEL` default `gpt-4o`) |
| **gpt-4o** | Predictions route recommendations | **0.4** / **1800** (`max_tokens`) | `server/src/routes/predictions/index.ts` |
| **text-embedding-3-large** (default) | RAG / embeddings | N/A | `server/src/services/embeddingService.ts`; `server/src/services/ai/ragRetrieval.ts`; `server/src/routes/knowledgeCenter.ts` |
| **text-embedding-3-small** | RAG defaults in route | N/A | `server/src/routes/rag.ts` (tenant default seed) |
| **gemini-2.0-flash-exp** | Configured prompt id in defaults | **0.7** / **1000** | `server/src/config/defaultPromptConfigs.ts` (prompt catalog — verify runtime usage via `getPromptConfig`) |
| **gemini-2.5-flash** | Cohi Builder chat (browser) | **0.65** / **maxOutputTokens 2048** | `src/cohibuilder/components/TollAssistant.tsx` |
| **gemini-2.5-flash-native-audio-preview-12-2025** | Live voice (browser + server WS) | Voice config (no classic `temperature` in snippet) | `src/cohibuilder/components/TollAssistant.tsx`; `server/src/services/websocket.ts`; `server/src/routes/podcast.ts` fallbacks |
| **models/gemini-2.5-flash-native-audio-latest** (+ fallbacks) | Executive podcast / Gemini voice | Fallback list in code | `server/src/routes/podcast.ts` |
| **fallout-sequencer-v1** | Internal / placeholder label in pipeline metadata | N/A | `server/src/services/dashboard/predictionPipelineService.ts` |
| **Whisper** | Transcription | API-specific | `server/src/routes/podcast.ts` (audio question flow) |

**Anthropic:** `anthropic_api_key` is stored in platform settings / encryption allowlist (`server/src/services/platformSettingsService.ts`, `server/src/services/encryption.ts`) but **no Anthropic API calls** were found in active `server/**/*.ts` sources.

---

## 2. Workflow patterns

### Simple / mostly stateless chat

- **Cohi Chat** (`cohiChatService.ts`): NL → (optional) SQL → execute → answer; **retry path** for bad SQL (second LLM call).
- **Insight detail chat** (`server/src/routes/dashboard/insightDetails.ts`): Chat completion; if response contains ```sql```, **one** extra round with query results.
- **Metrics / news / loans helpers**: Single completion per request.
- **Podcast**: Script generation + TTS; optional Whisper + chat + streaming TTS.
- **Recommendations / predictions HTTP**: Single completion (or JSON-only prediction with large structured prompts).

### Agentic (loops, tools, multi-step)

- **Research orchestrator** (`server/src/services/research/orchestrator.ts`): **Planner → parallel data analysts → synthesis**; pause/resume; DB-backed sessions; **quick vs deep** modes.
- **Data analyst agent** (`server/src/services/research/agents/dataAnalystAgent.ts`): Up to **8** iterations of **LLM → SQL / inline data → results back into context** (tool-style loop); **maxTokens 8192**, temperature **0.2**.
- **Insight investigator** (`server/src/services/insights/agents/insightInvestigatorAgent.ts`): Same pattern, **8** iterations, **maxTokens 5000**, temperature **0.2**.
- **Insight planner / evaluator** (`insightPlannerAgent.ts`, `insightEvaluatorAgent.ts`): Large single-pass JSON generations (**maxTokens** up to **12000** / **10000**).
- **Dashboard insights pipeline** (`dashboardInsights/pipeline.ts`): **Multi-pass** generator → deterministic fact-check → judge → curator → **per-insight** evidence agent (N LLM calls for N insights).
- **Cohi Workbench** (`server/src/routes/cohiWorkbench.ts`): JSON action planner; **two-pass** flow when `query_data` actions run (second `callLLM` with result rows).
- **Tracked polarity LLM** (`trackedPolarityLlmResolution.ts`): Chunked keys, optional **repair** second call on parse failure.

### Most token-intensive workloads (relative)

1. **Dashboard insights pipeline** — multiple passes with **gpt-5.2** and high `max_tokens` (generator **15000**, curator **14000**, evidence **6000** per insight in defaults).
2. **Research / insight agents** — **8×** iterations × **8192** (data analyst) or **5000** (investigator) budgets; large schema + result tables in thread.
3. **Loan prediction** (`predictionService.ts`) — JSON payloads with many loans + historical slices; **no explicit output cap** in main `callAIModel` body (relies on model defaults).
4. **Insight planner** — **maxTokens 12000** single call.

---

## 3. Infrastructure stack

| Layer | Finding |
| ----- | ------- |
| **Cloud** | **AWS** — Terraform under `infrastructure/terraform/` (VPC, **ECS Fargate**, Aurora Serverless, CloudFront-oriented layout in prod module). Additional **CloudFormation**: `infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml` (includes `OPENAI_API_KEY` from Secrets Manager). |
| **Compute** | **ECS Fargate** (no GPU instance types identified in scanned Terraform module names). |
| **Containers** | `Dockerfile.backend`, `Dockerfile.backend.prod`, `docker/dev/*`, `docker/prod/*` — application containers; **no ML inference server** or GPU base image called out in filenames. |
| **Kubernetes** | **No** Kubernetes manifests found in-repo (glob `**/*kubernetes*`). |
| **GPU / sovereign inference** | **Not present** in IaC scanned; all generative inference observed is **vendor API** (OpenAI / Google). |

---

## 4. Optimization audit

| Technique | In use? | Evidence |
| --------- | ------- | -------- |
| **Prompt caching (provider)** | **No** | No `prompt_cache` / `cache_control` (or equivalent) in API payloads grep. |
| **Model distillation** | **No** | No fine-tuning or distillation pipeline in codebase. |
| **Tiered inference (formal)** | **Partial / informal** | Different models per workload (`gpt-4o-mini` vs `gpt-4o` vs `gpt-5.2` vs `gpt-5-mini`); dashboard pipeline explicitly multi-pass with different temperatures/token caps. |
| **Cost / reliability helpers** | **Yes** | `callLLM` retries (429/5xx), **truncation handling** (doubles `max_completion_tokens` up to ceiling **16384**); `llmUsageTracker.ts` persists usage to `cost_events`; batching + backoff for embeddings; podcast Gemini **model fallbacks**; tenant vs platform API key resolution with fallback. |
| **Experiments / A-B** | **Yes** | Insight variants (`variant_model`, `variant_temperature`, `variant_max_tokens`, traffic %) in admin routes (`server/src/routes/admin/insightFeedback.ts`) and insight generator. |

---

## 5. Data sensitivity & third-party exposure

**Data sent to third-party LLM / speech APIs**

- **Loan-level attributes** and **portfolio metrics** appear in prompts for: predictions, recommendations, Cohi Chat (schema + query results), research agents (SQL rows), workbench (SQL + canvas), insights pipelines (metric payloads), podcast briefings (insight text), and **client-side Cohi Builder** (portfolio snapshot in Gemini system instruction).

**Likely PII / regulated data:** borrower/employee names, financials, property/loan identifiers, performance by individual LO/branch — depending on tenant data model and prompt construction.

**API keys:** OpenAI and Gemini keys can be **per-tenant** (`rag_settings`) or **platform** (`platform_settings` / env), so data egress uses tenant-chosen credentials in many flows.

**Sovereign VPC gap:** Workloads are **SaaS on AWS**, but **inference is not VPC-contained**; moving inference on-prem / dedicated GPU would require new serving stack (not present today).

---

## 6. Configuration & technical-debt signals (AI-specific)

1. **`callOpenAI` in `cohiChatService.ts` hardcodes `model: "gpt-4o"`** while `defaultPromptConfigs` assigns **gpt-4o-mini** to `cohi_chat.response` — **DB prompt `model` is not passed through** to the API layer; only temperature / max_tokens / json_mode are. Risk: **unexpected cost** and **drift** between admin UI/docs and runtime.
2. **`llmUsageTracker` price table** does not list **gpt-5.2** / **gpt-5-mini**; unknown models fall back to **gpt-4o** pricing — **cost dashboards may be wrong**.
3. **Anthropic key** storage without integration suggests **unfinished multi-provider strategy** or legacy placeholder.

---

## 7. Implications for a sovereign AI pivot

- **Today:** Almost all generative value is **delegated to OpenAI and Google**; AWS footprint is **orchestration + data**, not model serving.
- **To sovereign-host:** You would need **GPU capacity**, **model serving** (vLLM/TGI/etc.), **rewrites** of `callLLM` and all direct `fetch('https://api.openai.com/...')` / Gemini WS clients, plus **redacted or on-prem** embedding if vectors must not leave the perimeter.
- **Highest migration cost:** Agentic paths with **JSON tool loops** and **multi-pass insight** pipelines — they assume OpenAI Chat Completions semantics and token fields (`max_completion_tokens`).

---

*Generated from static codebase analysis; runtime env vars (e.g. overrides for `PREDICTION_MODEL`, `RECOMMENDATION_MODEL`, `Cohi_AI_PROVIDER`) may differ per deployment.*
