# Route-to-E2E Matrix

Status legend:

- `Covered`: has direct Playwright assertions on route behavior.
- `Partial`: route is indirectly exercised via parent flow; deeper behavior still needed.
- `Gap`: no direct Playwright coverage yet.

| Route | Auth | Status | Primary spec |
| --- | --- | --- | --- |
| `/` | Public | Covered | `e2e/auth.spec.ts` |
| `/landing` | Public | Partial | Indirect via login/logout flows |
| `/login` | Public | Covered | `e2e/auth.spec.ts` |
| `/forgot-password` | Public | Covered | `e2e/auth.spec.ts` |
| `/reset-password` | Public | Covered | `e2e/critical-routes.spec.ts` |
| `/auth/sso/callback` | Public | Covered | `e2e/critical-routes.spec.ts` |
| `/unsubscribe/:token` | Public | Covered | `e2e/critical-routes.spec.ts` |
| `/settings` | Protected | Covered | `e2e/settings.spec.ts` |
| `/insights` | Protected | Covered | `e2e/insights-dashboard.spec.ts` |
| `/legacy` | Protected | Gap | — |
| `/loans` | Protected | Covered | `e2e/critical-routes.spec.ts` |
| `/my-dashboard` | Protected | Covered (redirect) | `e2e/critical-routes.spec.ts` |
| `/my-dashboard/:canvasId?` | Protected | Covered | `e2e/workbench.spec.ts` |
| `/my-dashboard-legacy` | Protected | Gap | — |
| `/workbench` | Protected | Covered | `e2e/workbench.spec.ts` |
| `/workbench/shared` | Protected | Covered | `e2e/workbench.spec.ts` |
| `/workbench/team-folders` | Protected | Covered | `e2e/workbench.spec.ts` |
| `/workbench/favorites` | Protected | Covered | `e2e/workbench.spec.ts` |
| `/workbench/distributions` | Protected | Covered | `e2e/distributions.spec.ts` |
| `/research` | Protected | Covered | `e2e/research-lab.spec.ts` |
| `/data-chat` | Protected | Covered | `e2e/critical-routes.spec.ts` |
| `/loan-funnel` | Protected | Covered (redirect) | `e2e/critical-routes.spec.ts` |
| `/workflow-conversion` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/loan-detail` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/fallout-forecast` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/fallout-forecast/loan/:loanId` | Protected | Covered | `e2e/critical-routes.spec.ts` |
| `/pricing-dashboard` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/lock-stratification` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/pipeline-analysis` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/loan-complexity` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/credit-risk-management` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/company-scorecard` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/high-performers` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/actors` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/performance/toptiering-comparison` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/performance/financial-modeling-sandbox` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/sales-scorecard` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/sales-trends` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/sales-scorecard-overview` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/performance/operation-scorecard` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/performance/operation-scorecard-trends` | Protected | Covered | `e2e/toptiering.spec.ts` |
| `/admin` | Protected/admin | Covered | `e2e/admin.spec.ts` |
| `/admin/knowledge-base` | Protected/admin | Covered | `e2e/admin.spec.ts` |
| `/subscription/success` | Protected | Covered | `e2e/critical-routes.spec.ts` |
| `/subscription/cancel` | Protected | Covered | `e2e/critical-routes.spec.ts` |
| `/help/*` | Protected | Covered | `e2e/help-center.spec.ts` |
| `*` (404) | Public | Gap | — |

## Residual gaps

- Legacy routes (`/legacy`, `/my-dashboard-legacy`) still need explicit coverage.
- 404 fallback route currently has no direct E2E assertion.
- Some route coverage is smoke-level; deeper data assertions can still expand.
