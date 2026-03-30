# Dashboard Insights Implementation Status

Quick status snapshot of dashboard-insights coverage based on the current adapter registry and route mapping.

## Implemented Dashboards (Insights Enabled)

These dashboards are currently registered in the insights adapter registry and route map:

- `leaderboard` (route: `/insights`)
- `loan-complexity` (route: `/loan-complexity`)
- `company-scorecard` (route: `/company-scorecard`)
- `credit-risk-management` (route: `/credit-risk-management`)

Primary sources:

- `server/src/services/dashboardInsights/adapters/index.ts`
- `src/lib/dashboardInsightRoutes.ts`

## Dashboards Still Needing Dashboard-Insights Implementation

The following dashboard-like pages exist in `src/pages` but are not currently registered as insights-enabled page IDs:

- `OperationScorecard.tsx`
- `OperationScorecardTrends.tsx`
- `SalesScorecard.tsx`
- `SalesScorecardOverview.tsx`
- `SalesTrends.tsx`
- `PipelineAnalysisDashboard.tsx`
- `LoanFunnel.tsx`
- `FalloutForecast.tsx`
- `PricingDashboard.tsx`
- `WorkflowConversion.tsx`
- `HighPerformers.tsx`
- `LockStratification.tsx`
- `Actors.tsx`
- `Dashboard.tsx` / `DashboardLegacy.tsx`

Note: This list is a practical backlog candidate list. Final prioritization should be based on product roadmap and whether each page should have generated insights.

## Template / Plan Reference

- [Dashboard Insights New Dashboard Template Plan](./DASHBOARD_INSIGHTS_NEW_DASHBOARD_TEMPLATE_PLAN.md)

