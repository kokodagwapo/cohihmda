/** Sample Income & Market Fit payload — illustrative (Rocket LEI shape). */
export const DEMO_PREMIUM_LEI = '549300DEMO00PREMIUM1'

export const DEMO_INCOME_INTELLIGENCE_PAYLOAD = {
  lei: DEMO_PREMIUM_LEI,
  year: 2024,
  found: true,
  lenderName: 'Premium Demo Mortgage',
  dataAsOf: new Date().toISOString(),
  methodology:
    'Simulated executive preview — mirrors live ETL output shape. Production data from npm run premium:etl:income-fit + IncomeAggregateSnapshot.',
  sources: ['HMDA lender panel', 'FFIEC income reference'],
  premium: true,
  upgradeRequired: false,
  incomeToAmiBands: [
    { band: '<80%', originatedShare: 0.12, marketShareHint: 0.22, peerShareByIncomeBand: 0.22 },
    { band: '80–100%', originatedShare: 0.28, marketShareHint: 0.31, peerShareByIncomeBand: 0.31 },
    { band: '100–120%', originatedShare: 0.35, marketShareHint: 0.28, peerShareByIncomeBand: 0.28 },
    { band: '120%+', originatedShare: 0.25, marketShareHint: 0.19, peerShareByIncomeBand: 0.19 },
  ],
  tractIncomePenetration: [
    { category: 'Low', share: 0.08 },
    { category: 'Moderate', share: 0.14 },
    { category: 'Middle', share: 0.39 },
    { category: 'Upper', share: 0.39 },
  ],
  denialByIncomeBand: [
    { band: '<80%', denialRate: 0.214, topReasons: ['Debt-to-income ratio', 'Credit history'] },
    { band: '80–100%', denialRate: 0.162, topReasons: ['Collateral', 'Debt-to-income ratio'] },
    { band: '100–120%', denialRate: 0.131, topReasons: ['Insufficient cash to close'] },
    { band: '120%+', denialRate: 0.098, topReasons: ['Credit application incomplete'] },
  ],
  opportunityRankings: [
    {
      rank: 1,
      geographyType: 'county',
      state: 'MI',
      name: 'Oakland County',
      lenderShare: 0.09,
      incomeFitScore: 0.72,
      demandIndex: 0.81,
      opportunityScore: 0.68,
      driver: 'Low share vs estimated county demand',
    },
    {
      rank: 2,
      geographyType: 'county',
      state: 'OH',
      name: 'Cuyahoga County',
      lenderShare: 0.11,
      incomeFitScore: 0.65,
      demandIndex: 0.74,
      opportunityScore: 0.61,
      driver: 'Moderate share — room to grow in middle-income tracts',
    },
  ],
  opportunityHeatmap: [],
  signalCards: [
    {
      severity: 'warning',
      title: 'Middle-income tracts under index vs peers',
      body: 'Purchase units in middle-income census tracts trail a constructed peer set by ~8 pts of share in four counties.',
    },
    {
      severity: 'info',
      title: 'Denial mix below 90% AMI',
      body: 'Denials citing debt-to-income rise below 90% of area median income — validate against your LOS policies.',
    },
  ],
  communityReachDashboard: {
    affordableAmiBandShare: 0.4,
    lowModerateTractShare: 0.22,
    statesActive: 42,
    narrative: 'Origination mix skews toward upper AMI bands vs typical market baselines.',
  },
  peerShareIncomeBand: [
    { band: '<80%', lenderShare: 0.12, marketShare: 0.22 },
    { band: '80–100%', lenderShare: 0.28, marketShare: 0.31 },
  ],
  incomeAdjustedAvgLoanByBand: [
    { band: '<80%', avgLoanAmount: 195000, originatedShare: 0.12 },
    { band: '80–100%', avgLoanAmount: 238000, originatedShare: 0.28 },
  ],
  incomeStressSignal: {
    score: 0.48,
    label: 'Moderate',
    inputs: { overallDenialRate: 0.149, lowAmiBandDenialRate: 0.214, avgLoanAmount: 271000 },
  },
  fhfaOverlay: { available: false, note: 'Phase 2: FHFA HPI overlay.' },
}

DEMO_INCOME_INTELLIGENCE_PAYLOAD.opportunityHeatmap = DEMO_INCOME_INTELLIGENCE_PAYLOAD.opportunityRankings
