// Dashboard routes have been refactored into modular sub-routers
// See: server/src/routes/dashboard/ for individual route files
// - analytics.ts: funnel, leaderboard, top-tiering, business-overview, insights
// - import.ts: import/loans, import/employees
// - data.ts: sample-data, reset-sample-data, reset-data
// - templates.ts: csv/template

import dashboardRouter from './dashboard/index.js';

// Re-export the aggregated dashboard router
export default dashboardRouter;
