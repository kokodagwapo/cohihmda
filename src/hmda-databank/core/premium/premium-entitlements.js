/**
 * Maps Premium entitlement flags to Income Intelligence UI surfaces.
 * Keep in sync with server/premium/entitlements.mjs
 */
export const PREMIUM_FEATURE_SURFACES = {
  incomeIntelligence: {
    label: 'Income & Market Fit',
    route: '/income-intelligence',
    status: 'live',
  },
  communityReachDashboard: {
    label: 'Community reach',
    route: '/income-intelligence#community-reach',
    status: 'live',
  },
  opportunityHeatmaps: {
    label: 'Opportunity map',
    route: '/income-intelligence#opportunity',
    status: 'live',
  },
  peerShareIncomeBand: {
    label: 'Peer share by AMI band',
    route: '/income-intelligence#peer-share',
    status: 'live',
  },
  fhfaOverlay: {
    label: 'FHFA affordability overlay',
    route: '/income-intelligence',
    status: 'phase2',
  },
  aiExecutiveSummary: {
    label: 'Executive summary',
    route: '/income-intelligence',
    status: 'live',
  },
  smartAlerts: {
    label: 'Smart alerts',
    route: '/income-intelligence#alerts',
    status: 'live',
  },
  voiceBriefing: {
    label: 'Voice briefing',
    route: '/income-intelligence',
    status: 'phase2',
  },
  exportsPdf: { label: 'PDF export', status: 'live' },
  exportsExcel: { label: 'Excel export', status: 'roadmap' },
  exportsPptx: { label: 'PowerPoint export', status: 'roadmap' },
  savedSearches: { label: 'Saved searches', route: '/', status: 'live' },
  watchlists: { label: 'Watchlists', route: '/income-intelligence#watchlists', status: 'live' },
  shareableLinks: { label: 'Shareable links', status: 'roadmap' },
}

export function listLivePremiumFeatures(entitlements = {}) {
  return Object.entries(PREMIUM_FEATURE_SURFACES)
    .filter(([key, meta]) => entitlements[key] && meta.status === 'live')
    .map(([key, meta]) => ({ key, ...meta }))
}
