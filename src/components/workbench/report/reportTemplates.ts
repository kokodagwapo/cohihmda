/**
 * Mortgage Report Templates
 *
 * Pre-built report templates for common mortgage industry reports.
 * Each template uses DataSource references to METRICS_CATALOG and SQL
 * queries that get resolved at generation time against the tenant DB.
 */

import type {
  ReportTemplate,
  SlideDefinition,
  SlideElement,
  ReportTheme,
  DataSource,
} from '@/types/reportTypes';
import { REPORT_THEMES } from '@/types/reportTypes';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const DEFAULT_THEME = REPORT_THEMES.professional;

function kpiEl(
  id: string,
  label: string,
  metricId: string,
  format: 'number' | 'currency' | 'percent',
  pos: { x: number; y: number; w: number; h: number }
): SlideElement {
  return {
    id,
    type: 'kpi',
    position: pos,
    config: { type: 'kpi', label, value: 0, format },
    dataSource: { type: 'metric', metricIds: [metricId] },
  };
}

function chartEl(
  id: string,
  title: string,
  chartType: string,
  sql: string,
  xKey: string,
  yKey: string,
  pos: { x: number; y: number; w: number; h: number },
  extras?: Record<string, any>
): SlideElement {
  return {
    id,
    type: 'chart',
    position: pos,
    config: {
      type: 'chart',
      chartType,
      title,
      data: [],
      xKey,
      yKey,
      showLegend: true,
      ...extras,
    },
    dataSource: { type: 'sql', sql },
  };
}

function tableEl(
  id: string,
  columns: { key: string; label: string; format?: string }[],
  sql: string,
  pos: { x: number; y: number; w: number; h: number }
): SlideElement {
  return {
    id,
    type: 'table',
    position: pos,
    config: { type: 'table', columns, data: [] },
    dataSource: { type: 'sql', sql },
  };
}

function textEl(
  id: string,
  content: string,
  pos: { x: number; y: number; w: number; h: number },
  extras?: Record<string, any>
): SlideElement {
  return {
    id,
    type: 'text',
    position: pos,
    config: { type: 'text', content, fontSize: 12, color: '#1e293b', ...extras },
  };
}

// ---------------------------------------------------------------------------
// 1. Pipeline Report
// ---------------------------------------------------------------------------

const pipelineSlides: SlideDefinition[] = [
  {
    id: 'pipeline-title',
    layout: 'title',
    title: 'Pipeline Report',
    subtitle: 'Active Pipeline Analysis',
    elements: [],
    speakerNotes: 'Overview of the current active mortgage pipeline including status breakdown, LO distribution, and aging metrics.',
  },
  {
    id: 'pipeline-kpis',
    layout: 'kpi-grid',
    title: 'Pipeline Overview',
    elements: [
      kpiEl('p-kpi-1', 'Active Loans', 'active_loans', 'number', { x: 0.5, y: 1.2, w: 2.0, h: 1.3 }),
      kpiEl('p-kpi-2', 'Pipeline Volume', 'total_volume', 'currency', { x: 2.7, y: 1.2, w: 2.0, h: 1.3 }),
      kpiEl('p-kpi-3', 'Locked Loans', 'locked_loans', 'number', { x: 4.9, y: 1.2, w: 2.0, h: 1.3 }),
      kpiEl('p-kpi-4', 'Pull-Through Rate', 'pull_through_rate', 'percent', { x: 7.1, y: 1.2, w: 2.0, h: 1.3 }),
    ],
    speakerNotes: 'Key pipeline metrics: total active loans, pipeline dollar volume, locked loans, and historical pull-through rate.',
  },
  {
    id: 'pipeline-by-status',
    layout: 'chart-focus',
    title: 'Pipeline by Loan Status',
    elements: [
      chartEl(
        'p-status-chart',
        'Active Loans by Status',
        'bar',
        `SELECT l.current_loan_status AS status, COUNT(*) AS loan_count, SUM(l.loan_amount) AS total_volume
         FROM public.loans l
         WHERE l.current_loan_status = 'Active Loan'
           AND l.application_date IS NOT NULL
         GROUP BY l.current_loan_status
         ORDER BY loan_count DESC
         LIMIT 10`,
        'status',
        'loan_count',
        { x: 0.5, y: 1.0, w: 9.0, h: 5.0 }
      ),
    ],
    speakerNotes: 'Breakdown of active pipeline by current loan status. Focus on loans in processing vs underwriting stages.',
  },
  {
    id: 'pipeline-by-lo',
    layout: 'chart-focus',
    title: 'Pipeline by Loan Officer',
    elements: [
      chartEl(
        'p-lo-chart',
        'Top 10 Loan Officers by Pipeline Volume',
        'horizontal_bar',
        `SELECT l.loan_officer AS lo_name, COUNT(*) AS loan_count, SUM(l.loan_amount) AS total_volume
         FROM public.loans l
         WHERE l.current_loan_status = 'Active Loan'
           AND l.application_date IS NOT NULL
           AND l.loan_officer IS NOT NULL
         GROUP BY l.loan_officer
         ORDER BY total_volume DESC
         LIMIT 10`,
        'lo_name',
        'total_volume',
        { x: 0.5, y: 1.0, w: 9.0, h: 5.0 }
      ),
    ],
    speakerNotes: 'Top 10 loan officers by active pipeline volume. Identify concentration risk and workload distribution.',
  },
  {
    id: 'pipeline-by-channel',
    layout: 'chart-focus',
    title: 'Pipeline by Channel',
    elements: [
      chartEl(
        'p-channel-chart',
        'Pipeline Distribution by Channel',
        'donut',
        `SELECT COALESCE(l.channel, 'Unknown') AS channel, COUNT(*) AS loan_count, SUM(l.loan_amount) AS total_volume
         FROM public.loans l
         WHERE l.current_loan_status = 'Active Loan'
           AND l.application_date IS NOT NULL
         GROUP BY channel
         ORDER BY total_volume DESC`,
        'channel',
        'total_volume',
        { x: 1.5, y: 1.0, w: 7.0, h: 5.0 },
        { nameKey: 'channel', valueKey: 'total_volume' }
      ),
    ],
    speakerNotes: 'Pipeline breakdown by origination channel (Retail, Wholesale, Correspondent).',
  },
  {
    id: 'pipeline-takeaways',
    layout: 'content',
    title: 'Key Takeaways & Action Items',
    elements: [
      textEl('p-takeaway', '- Review pipeline concentration by top LOs\n- Monitor lock expiration dates for at-risk loans\n- Assess underwriting bottlenecks for aging loans\n- Track channel mix against strategic targets',
        { x: 0.5, y: 1.2, w: 9.0, h: 4.5 },
        { fontSize: 16, bullet: true }
      ),
    ],
    speakerNotes: 'Summary of key pipeline insights and recommended actions.',
  },
];

// ---------------------------------------------------------------------------
// 2. Production Report
// ---------------------------------------------------------------------------

const productionSlides: SlideDefinition[] = [
  {
    id: 'prod-title',
    layout: 'title',
    title: 'Production Report',
    subtitle: 'Monthly Closings & Funded Volume',
    elements: [],
  },
  {
    id: 'prod-kpis',
    layout: 'kpi-grid',
    title: 'Production Metrics',
    elements: [
      kpiEl('pr-kpi-1', 'Closed Loans', 'closed_loans', 'number', { x: 0.5, y: 1.2, w: 2.0, h: 1.3 }),
      kpiEl('pr-kpi-2', 'Funded Volume', 'funded_volume', 'currency', { x: 2.7, y: 1.2, w: 2.0, h: 1.3 }),
      kpiEl('pr-kpi-3', 'Total Units', 'total_units', 'number', { x: 4.9, y: 1.2, w: 2.0, h: 1.3 }),
      kpiEl('pr-kpi-4', 'Avg Cycle Time', 'avg_cycle_time', 'number', { x: 7.1, y: 1.2, w: 2.0, h: 1.3 }),
    ],
  },
  {
    id: 'prod-monthly-trend',
    layout: 'chart-focus',
    title: 'Monthly Funded Volume Trend',
    elements: [
      chartEl(
        'pr-monthly',
        'Funded Volume by Month',
        'area',
        `SELECT DATE_TRUNC('month', l.funding_date) AS sort_period,
                TO_CHAR(DATE_TRUNC('month', l.funding_date), 'Mon YYYY') AS period,
                SUM(l.loan_amount) AS funded_volume,
                COUNT(*) AS units
         FROM public.loans l
         WHERE l.funding_date IS NOT NULL
           AND l.funding_date >= CURRENT_DATE - INTERVAL '12 months'
         GROUP BY sort_period, period
         ORDER BY sort_period`,
        'period',
        'funded_volume',
        { x: 0.5, y: 1.0, w: 9.0, h: 5.0 }
      ),
    ],
    speakerNotes: '12-month funded volume trend. Note seasonal patterns and month-over-month changes.',
  },
  {
    id: 'prod-lo-rankings',
    layout: 'table',
    title: 'Loan Officer Production Rankings',
    elements: [
      tableEl(
        'pr-lo-table',
        [
          { key: 'lo_name', label: 'Loan Officer' },
          { key: 'units', label: 'Units' },
          { key: 'total_volume', label: 'Volume', format: 'currency' },
          { key: 'avg_size', label: 'Avg Loan Size', format: 'currency' },
        ],
        `SELECT l.loan_officer AS lo_name,
                COUNT(*) AS units,
                SUM(l.loan_amount) AS total_volume,
                AVG(l.loan_amount) AS avg_size
         FROM public.loans l
         WHERE l.funding_date IS NOT NULL
           AND l.funding_date >= CURRENT_DATE - INTERVAL '90 days'
           AND l.loan_officer IS NOT NULL
         GROUP BY l.loan_officer
         ORDER BY total_volume DESC
         LIMIT 15`,
        { x: 0.5, y: 1.0, w: 9.0, h: 5.5 }
      ),
    ],
    speakerNotes: 'Top 15 loan officers by funded volume in the last 90 days.',
  },
  {
    id: 'prod-takeaways',
    layout: 'content',
    title: 'Key Takeaways',
    elements: [
      textEl('pr-takeaway', '- Review monthly volume trends against annual targets\n- Recognize top-producing loan officers\n- Identify underperforming branches for coaching\n- Compare average loan size trends across channels',
        { x: 0.5, y: 1.2, w: 9.0, h: 4.5 },
        { fontSize: 16, bullet: true }
      ),
    ],
  },
];

// ---------------------------------------------------------------------------
// 3. Executive Summary
// ---------------------------------------------------------------------------

const executiveSlides: SlideDefinition[] = [
  {
    id: 'exec-title',
    layout: 'title',
    title: 'Executive Summary',
    subtitle: 'Mortgage Operations Overview',
    elements: [],
  },
  {
    id: 'exec-kpis',
    layout: 'kpi-grid',
    title: 'Key Performance Indicators',
    elements: [
      kpiEl('ex-kpi-1', 'Active Pipeline', 'active_loans', 'number', { x: 0.5, y: 1.2, w: 2.8, h: 1.3 }),
      kpiEl('ex-kpi-2', 'Funded Volume (90d)', 'funded_volume', 'currency', { x: 3.6, y: 1.2, w: 2.8, h: 1.3 }),
      kpiEl('ex-kpi-3', 'Pull-Through', 'pull_through_rate', 'percent', { x: 6.7, y: 1.2, w: 2.8, h: 1.3 }),
      kpiEl('ex-kpi-4', 'Avg Cycle Time', 'avg_cycle_time', 'number', { x: 0.5, y: 2.8, w: 2.8, h: 1.3 }),
      kpiEl('ex-kpi-5', 'Total Units (90d)', 'total_units', 'number', { x: 3.6, y: 2.8, w: 2.8, h: 1.3 }),
      kpiEl('ex-kpi-6', 'Locked Loans', 'locked_loans', 'number', { x: 6.7, y: 2.8, w: 2.8, h: 1.3 }),
    ],
    speakerNotes: 'High-level view of key mortgage operations metrics. Green/red indicators show period-over-period direction.',
  },
  {
    id: 'exec-volume-trend',
    layout: 'chart-focus',
    title: 'Volume Trend (Last 12 Months)',
    elements: [
      chartEl(
        'ex-trend',
        'Monthly Application & Funded Volume',
        'line',
        `SELECT DATE_TRUNC('month', l.application_date) AS sort_period,
                TO_CHAR(DATE_TRUNC('month', l.application_date), 'Mon YYYY') AS period,
                COUNT(*) AS applications,
                COUNT(CASE WHEN l.funding_date IS NOT NULL THEN 1 END) AS funded
         FROM public.loans l
         WHERE l.application_date >= CURRENT_DATE - INTERVAL '12 months'
           AND l.application_date IS NOT NULL
         GROUP BY sort_period, period
         ORDER BY sort_period`,
        'period',
        'applications',
        { x: 0.5, y: 1.0, w: 9.0, h: 5.0 },
        { yKeys: ['applications', 'funded'] }
      ),
    ],
  },
  {
    id: 'exec-takeaways',
    layout: 'content',
    title: 'Key Insights & Recommendations',
    elements: [
      textEl('ex-takeaway', '- Pipeline health: assess current volume against targets\n- Pull-through optimization: identify fallout drivers\n- Turn time improvement: address processing bottlenecks\n- Market positioning: evaluate rate competitiveness\n- Risk management: monitor credit quality trends',
        { x: 0.5, y: 1.2, w: 9.0, h: 4.5 },
        { fontSize: 16, bullet: true }
      ),
    ],
  },
];

// ---------------------------------------------------------------------------
// 4. Pull-Through Analysis
// ---------------------------------------------------------------------------

const pullThroughSlides: SlideDefinition[] = [
  {
    id: 'pt-title',
    layout: 'title',
    title: 'Pull-Through Analysis',
    subtitle: 'Application-to-Funding Conversion Rates',
    elements: [],
  },
  {
    id: 'pt-kpis',
    layout: 'kpi-grid',
    title: 'Pull-Through Overview',
    elements: [
      kpiEl('pt-kpi-1', 'Overall Pull-Through', 'pull_through_rate', 'percent', { x: 0.5, y: 1.2, w: 2.8, h: 1.3 }),
      kpiEl('pt-kpi-2', 'Total Applications', 'total_units', 'number', { x: 3.6, y: 1.2, w: 2.8, h: 1.3 }),
      kpiEl('pt-kpi-3', 'Funded Loans', 'closed_loans', 'number', { x: 6.7, y: 1.2, w: 2.8, h: 1.3 }),
    ],
  },
  {
    id: 'pt-by-lo',
    layout: 'chart-focus',
    title: 'Pull-Through by Loan Officer',
    elements: [
      chartEl(
        'pt-lo-chart',
        'Pull-Through Rate by Loan Officer (Top 10)',
        'horizontal_bar',
        `SELECT l.loan_officer AS lo_name,
                COUNT(*) AS total_apps,
                COUNT(CASE WHEN l.funding_date IS NOT NULL THEN 1 END) AS funded,
                ROUND(COUNT(CASE WHEN l.funding_date IS NOT NULL THEN 1 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS pull_through_pct
         FROM public.loans l
         WHERE l.application_date >= CURRENT_DATE - INTERVAL '6 months'
           AND l.application_date IS NOT NULL
           AND l.loan_officer IS NOT NULL
           AND l.current_loan_status IS DISTINCT FROM 'Active Loan'
         GROUP BY l.loan_officer
         HAVING COUNT(*) >= 5
         ORDER BY pull_through_pct DESC
         LIMIT 10`,
        'lo_name',
        'pull_through_pct',
        { x: 0.5, y: 1.0, w: 9.0, h: 5.0 }
      ),
    ],
  },
  {
    id: 'pt-trend',
    layout: 'chart-focus',
    title: 'Pull-Through Trend',
    elements: [
      chartEl(
        'pt-trend-chart',
        'Monthly Pull-Through Rate (12 Months)',
        'line',
        `SELECT DATE_TRUNC('month', l.application_date) AS sort_period,
                TO_CHAR(DATE_TRUNC('month', l.application_date), 'Mon YYYY') AS period,
                ROUND(COUNT(CASE WHEN l.funding_date IS NOT NULL THEN 1 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS pull_through_pct
         FROM public.loans l
         WHERE l.application_date >= CURRENT_DATE - INTERVAL '12 months'
           AND l.application_date IS NOT NULL
           AND l.current_loan_status IS DISTINCT FROM 'Active Loan'
         GROUP BY sort_period, period
         ORDER BY sort_period`,
        'period',
        'pull_through_pct',
        { x: 0.5, y: 1.0, w: 9.0, h: 5.0 }
      ),
    ],
  },
  {
    id: 'pt-takeaways',
    layout: 'content',
    title: 'Key Takeaways',
    elements: [
      textEl('pt-takeaway', '- Identify LOs with below-average pull-through for coaching\n- Analyze fallout reasons for the most common withdrawal stage\n- Compare pull-through across channels and loan types\n- Set pull-through improvement targets by branch',
        { x: 0.5, y: 1.2, w: 9.0, h: 4.5 },
        { fontSize: 16, bullet: true }
      ),
    ],
  },
];

// ---------------------------------------------------------------------------
// 5. Turn Time Report
// ---------------------------------------------------------------------------

const turnTimeSlides: SlideDefinition[] = [
  {
    id: 'tt-title',
    layout: 'title',
    title: 'Turn Time Report',
    subtitle: 'Processing & Cycle Time Analysis',
    elements: [],
  },
  {
    id: 'tt-kpis',
    layout: 'kpi-grid',
    title: 'Cycle Time Metrics',
    elements: [
      kpiEl('tt-kpi-1', 'Avg App-to-Close', 'avg_app_close_days', 'number', { x: 0.5, y: 1.2, w: 2.8, h: 1.3 }),
      kpiEl('tt-kpi-2', 'Avg App-to-Fund', 'avg_app_fund_days', 'number', { x: 3.6, y: 1.2, w: 2.8, h: 1.3 }),
      kpiEl('tt-kpi-3', 'Avg Cycle Time', 'avg_cycle_time', 'number', { x: 6.7, y: 1.2, w: 2.8, h: 1.3 }),
    ],
    speakerNotes: 'Key turn time metrics in days. Lower is better. Compare against industry benchmarks (30-45 days app-to-close).',
  },
  {
    id: 'tt-trend',
    layout: 'chart-focus',
    title: 'Monthly Cycle Time Trend',
    elements: [
      chartEl(
        'tt-trend-chart',
        'Average Days App-to-Close (12 Months)',
        'line',
        `SELECT DATE_TRUNC('month', l.closing_date) AS sort_period,
                TO_CHAR(DATE_TRUNC('month', l.closing_date), 'Mon YYYY') AS period,
                AVG(DATE(l.closing_date) - DATE(l.application_date)) AS avg_days
         FROM public.loans l
         WHERE l.closing_date IS NOT NULL
           AND l.application_date IS NOT NULL
           AND l.closing_date >= CURRENT_DATE - INTERVAL '12 months'
         GROUP BY sort_period, period
         ORDER BY sort_period`,
        'period',
        'avg_days',
        { x: 0.5, y: 1.0, w: 9.0, h: 5.0 }
      ),
    ],
  },
  {
    id: 'tt-by-branch',
    layout: 'chart-focus',
    title: 'Cycle Time by Branch',
    elements: [
      chartEl(
        'tt-branch-chart',
        'Avg Cycle Time by Branch',
        'horizontal_bar',
        `SELECT COALESCE(l.branch, 'Unknown') AS branch_name,
                AVG(DATE(COALESCE(l.closing_date, l.funding_date)) - DATE(l.application_date)) AS avg_days,
                COUNT(*) AS loan_count
         FROM public.loans l
         WHERE l.closing_date IS NOT NULL
           AND l.application_date IS NOT NULL
           AND l.closing_date >= CURRENT_DATE - INTERVAL '6 months'
         GROUP BY branch_name
         HAVING COUNT(*) >= 3
         ORDER BY avg_days DESC
         LIMIT 10`,
        'branch_name',
        'avg_days',
        { x: 0.5, y: 1.0, w: 9.0, h: 5.0 }
      ),
    ],
  },
  {
    id: 'tt-takeaways',
    layout: 'content',
    title: 'Key Takeaways',
    elements: [
      textEl('tt-takeaway', '- Identify branches with longest cycle times for process review\n- Track month-over-month improvement in turn times\n- Analyze stage-by-stage bottlenecks\n- Set turn time targets by loan type and channel\n- Correlate turn times with pull-through rates',
        { x: 0.5, y: 1.2, w: 9.0, h: 4.5 },
        { fontSize: 16, bullet: true }
      ),
    ],
  },
];

// ---------------------------------------------------------------------------
// 6. Loan Officer Scorecard
// ---------------------------------------------------------------------------

const loScorecardSlides: SlideDefinition[] = [
  {
    id: 'lo-title',
    layout: 'title',
    title: 'Loan Officer Scorecard',
    subtitle: 'Individual Performance Report',
    elements: [],
  },
  {
    id: 'lo-rankings',
    layout: 'table',
    title: 'LO Performance Rankings (Last 90 Days)',
    elements: [
      tableEl(
        'lo-rankings-table',
        [
          { key: 'lo_name', label: 'Loan Officer' },
          { key: 'apps', label: 'Applications' },
          { key: 'funded', label: 'Funded' },
          { key: 'volume', label: 'Volume', format: 'currency' },
          { key: 'pt_rate', label: 'Pull-Through %', format: 'percent' },
          { key: 'avg_days', label: 'Avg Days' },
        ],
        `SELECT l.loan_officer AS lo_name,
                COUNT(*) AS apps,
                COUNT(CASE WHEN l.funding_date IS NOT NULL THEN 1 END) AS funded,
                SUM(CASE WHEN l.funding_date IS NOT NULL THEN l.loan_amount ELSE 0 END) AS volume,
                ROUND(COUNT(CASE WHEN l.funding_date IS NOT NULL THEN 1 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS pt_rate,
                ROUND(AVG(CASE WHEN l.closing_date IS NOT NULL AND l.application_date IS NOT NULL THEN DATE(l.closing_date) - DATE(l.application_date) END)) AS avg_days
         FROM public.loans l
         WHERE l.application_date >= CURRENT_DATE - INTERVAL '90 days'
           AND l.application_date IS NOT NULL
           AND l.loan_officer IS NOT NULL
         GROUP BY l.loan_officer
         HAVING COUNT(*) >= 3
         ORDER BY volume DESC
         LIMIT 20`,
        { x: 0.3, y: 1.0, w: 9.4, h: 5.5 }
      ),
    ],
    speakerNotes: 'Comprehensive LO scorecard with production, pull-through, and turn time metrics for the last 90 days.',
  },
  {
    id: 'lo-volume-chart',
    layout: 'chart-focus',
    title: 'LO Production Comparison',
    elements: [
      chartEl(
        'lo-volume',
        'Top 10 LOs by Funded Volume (90 Days)',
        'bar',
        `SELECT l.loan_officer AS lo_name,
                SUM(CASE WHEN l.funding_date IS NOT NULL THEN l.loan_amount ELSE 0 END) AS funded_volume
         FROM public.loans l
         WHERE l.application_date >= CURRENT_DATE - INTERVAL '90 days'
           AND l.loan_officer IS NOT NULL
         GROUP BY l.loan_officer
         ORDER BY funded_volume DESC
         LIMIT 10`,
        'lo_name',
        'funded_volume',
        { x: 0.5, y: 1.0, w: 9.0, h: 5.0 }
      ),
    ],
  },
  {
    id: 'lo-takeaways',
    layout: 'content',
    title: 'Key Takeaways',
    elements: [
      textEl('lo-takeaway', '- Recognize top performers and share best practices\n- Coach LOs with low pull-through rates\n- Review workload distribution across the team\n- Identify LOs who need pipeline management support\n- Set individual targets aligned with company goals',
        { x: 0.5, y: 1.2, w: 9.0, h: 4.5 },
        { fontSize: 16, bullet: true }
      ),
    ],
  },
];

// ---------------------------------------------------------------------------
// Export all templates
// ---------------------------------------------------------------------------

export const BUILTIN_REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: 'builtin-pipeline',
    name: 'Pipeline Report',
    description: 'Active pipeline analysis with status breakdown, LO distribution, and aging metrics',
    category: 'pipeline',
    icon: 'pipeline',
    source: 'builtin',
    definition: {
      title: 'Pipeline Report',
      subtitle: 'Active Pipeline Analysis',
      theme: DEFAULT_THEME,
      slides: pipelineSlides,
    },
  },
  {
    id: 'builtin-production',
    name: 'Production Report',
    description: 'Monthly closings, funded volume, LO rankings, and branch comparison',
    category: 'production',
    icon: 'production',
    source: 'builtin',
    definition: {
      title: 'Production Report',
      subtitle: 'Monthly Closings & Funded Volume',
      theme: DEFAULT_THEME,
      slides: productionSlides,
    },
  },
  {
    id: 'builtin-executive',
    name: 'Executive Summary',
    description: 'High-level KPI dashboard with trend charts and key takeaways',
    category: 'executive',
    icon: 'executive',
    source: 'builtin',
    definition: {
      title: 'Executive Summary',
      subtitle: 'Mortgage Operations Overview',
      theme: REPORT_THEMES.executiveBlue,
      slides: executiveSlides,
    },
  },
  {
    id: 'builtin-pull-through',
    name: 'Pull-Through Analysis',
    description: 'Pull-through rates by LO, branch, channel, and loan type with trend analysis',
    category: 'pull-through',
    icon: 'pull-through',
    source: 'builtin',
    definition: {
      title: 'Pull-Through Analysis',
      subtitle: 'Application-to-Funding Conversion Rates',
      theme: DEFAULT_THEME,
      slides: pullThroughSlides,
    },
  },
  {
    id: 'builtin-turn-times',
    name: 'Turn Time Report',
    description: 'Average cycle times by stage, bottleneck identification, and branch comparison',
    category: 'turn-times',
    icon: 'turn-times',
    source: 'builtin',
    definition: {
      title: 'Turn Time Report',
      subtitle: 'Processing & Cycle Time Analysis',
      theme: DEFAULT_THEME,
      slides: turnTimeSlides,
    },
  },
  {
    id: 'builtin-lo-scorecard',
    name: 'Loan Officer Scorecard',
    description: 'Individual LO performance metrics, pipeline snapshot, and production trends',
    category: 'scorecard',
    icon: 'scorecard',
    source: 'builtin',
    definition: {
      title: 'Loan Officer Scorecard',
      subtitle: 'Individual Performance Report',
      theme: DEFAULT_THEME,
      slides: loScorecardSlides,
    },
  },
];

export default BUILTIN_REPORT_TEMPLATES;
