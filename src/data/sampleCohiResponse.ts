/**
 * Sample COHI response for development – simulates database-connected result
 * so you can preview the UI without a live backend.
 */

import type { CohiQueryResponse } from '@/types/cohiResponsePlan';

export const SAMPLE_COHI_RESPONSE: CohiQueryResponse = {
  responsePlan: {
    layout_type: 'mixed',
    title: 'Loan activity summary',
    subtitle: 'Last 90 days',
    confidence_level: 'high',
    sections: [
      {
        type: 'header_summary',
        props: {
          whatYouAsked: 'What important info do I need to know today?',
          whatIFound: 'Last 90 days: funded $12.45M (+8.2%), pipeline $18.72M (+5.1%), pull-through 42.3% (−1.2 pts). Top 5 LOs by volume below. Data from loan_activity_90d.',
          whyItMatters: 'Pipeline and fundings are up; pull-through is the main lever. Example simulation: if pull-through recovers to 45%, Q2 could add ~$2.1M funded. Moving 3 at-risk pipeline loans to clear this week could lift pull-through ~0.5 pts.',
        },
      },
      {
        type: 'kpi_cards',
        props: {
          cards: [
            { label: 'Funded volume', value: 12450000, delta: 8.2, trend: 'up', format: 'currency' },
            { label: 'Pipeline', value: 18720000, delta: 5.1, trend: 'up', format: 'currency' },
            { label: 'Pull-through rate', value: 42.3, delta: -1.2, trend: 'down', format: 'percent' },
            { label: 'Loans closed', value: 312, delta: 12, trend: 'up', format: 'number' },
          ],
        },
      },
      {
        type: 'ranked_table',
        props: {
          columns: [
            { key: 'name', label: 'Loan officer', format: 'text' },
            { key: 'funded', label: 'Funded', format: 'currency' },
            { key: 'pullThrough', label: 'Pull-through %', format: 'percent' },
          ],
          rows: [
            { name: 'Sarah Chen', funded: 2450000, pullThrough: 48.2 },
            { name: 'Mike Torres', funded: 2180000, pullThrough: 45.1 },
            { name: 'Jamie Lee', funded: 1920000, pullThrough: 41.8 },
            { name: 'Alex Rivera', funded: 1780000, pullThrough: 39.4 },
            { name: 'Jordan Kim', funded: 1650000, pullThrough: 38.1 },
          ],
          highlightRules: [
            { columnKey: 'pullThrough', condition: 'top', className: 'font-medium text-emerald-600 dark:text-emerald-400' },
          ],
        },
      },
    ],
  },
  dataPayloads: {},
  audit: {
    generatedAt: new Date().toISOString(),
    latencyMs: 420,
    datasetsUsed: ['loan_activity_90d'],
  },
};
