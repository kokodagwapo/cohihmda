# Dashboard Insights — Phase 1–2 Rollout

## Scope (Phase 1 and 2 only)

- **Leaderboard** is the only dashboard with insights in this phase.
- Insights are generated **on-demand** via the "Generate Insights" button only. Automatic generation on data sync is **Phase 3**.
- Escalated (critical) dashboard insights appear in the main Aletheia **Critical Issues** bucket with a "Go to [page]" link.

## Rollout steps

1. **Run tenant migration**  
   Ensure `093_dashboard_generated_insights.sql` has been applied to tenant DBs (`npm run migrate` or your deployment migration step).

2. **Prompt config**  
   Default prompts for `dashboard_insights.generator`, `dashboard_insights.judge`, `dashboard_insights.curator`, and `dashboard_insights.evidence_agent` are in `server/src/config/defaultPromptConfigs.ts`. They can be overridden in Admin → AI Prompts (category `dashboard_insights`).

3. **Feature flag (optional)**  
   To gate by tenant or globally, add a check in `POST /api/dashboard-insights/generate` and optionally hide the Leaderboard "Generate Insights" button when disabled.

4. **Validation**  
   - Open Leaderboard, click "Generate Insights", confirm the modal shows loading then insights or an error.
   - Confirm the in-page strip shows stored insights after generation.
   - Confirm "Show on dashboard" scrolls to and highlights `#leaderboard-main-table`.
   - Generate an insight with critical sentiment, set `escalate: true` (curator); confirm it appears in Aletheia Critical bucket with "Go to Leaderboard" and that the link navigates to `/insights#leaderboard`.

## Phase 3 (later)

- Register the `dashboard-insight-generation` post-sync hook in `registerInsightHooks.ts`.
- Add more dashboard page adapters and strips (e.g. Loan Complexity, Operations Scorecard).
