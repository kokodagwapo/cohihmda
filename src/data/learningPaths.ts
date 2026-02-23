export interface LearningStep {
  id: string;
  title: string;
  description: string;
  type: 'tour' | 'article' | 'action';
  resourceId?: string;
  link?: string;
}

export interface LearningPath {
  id: string;
  role: string;
  title: string;
  description: string;
  weeks: Array<{
    week: number;
    title: string;
    focus: string;
    steps: LearningStep[];
  }>;
}

export interface Mission {
  id: string;
  title: string;
  description: string;
  icon: string;
  action: string;
  verifyRoute?: string;
}

export const missions: Mission[] = [
  {
    id: 'mission-track-insight',
    title: 'Track your first insight',
    description: 'Bookmark an insight from Daily Briefings to add it to your watchlist.',
    icon: 'Bookmark',
    action: 'Go to Insights and click the bookmark icon on any insight card.',
    verifyRoute: '/insights',
  },
  {
    id: 'mission-build-dashboard',
    title: 'Build your first dashboard',
    description: 'Create a canvas and add at least one widget in the Workbench.',
    icon: 'LayoutPanelLeft',
    action: 'Go to My Workbench, create a canvas, and add a widget.',
    verifyRoute: '/my-dashboard',
  },
  {
    id: 'mission-ask-cohi',
    title: 'Ask Cohi a question',
    description: 'Use Cohi Chat to ask a question about your data.',
    icon: 'MessageSquare',
    action: 'Open Cohi Chat and type any data question.',
  },
  {
    id: 'mission-export-report',
    title: 'Export a report',
    description: 'Generate a PowerPoint or PDF from your Workbench.',
    icon: 'FileDown',
    action: 'Open a canvas in the Workbench and click Export.',
    verifyRoute: '/my-dashboard',
  },
  {
    id: 'mission-run-research',
    title: 'Run a research session',
    description: 'Submit a question to the AI Research Analyst.',
    icon: 'FlaskConical',
    action: 'Go to Research Lab and type a research question.',
    verifyRoute: '/research',
  },
];

export const learningPaths: LearningPath[] = [
  {
    id: 'path-executive',
    role: 'Executive / C-Suite',
    title: 'Executive Learning Path',
    description: 'Focus on insights, KPIs, scorecards, and reports.',
    weeks: [
      {
        week: 1,
        title: 'Getting Oriented',
        focus: 'Insights dashboard — Daily Briefings, Business Overview',
        steps: [
          { id: 'exec-w1-1', title: 'Take the Welcome Tour', type: 'tour', resourceId: 'welcome' },
          { id: 'exec-w1-2', title: 'Read: First Steps After Login', type: 'article', link: '/help/getting-started/first-steps' },
          { id: 'exec-w1-3', title: 'Read: Understanding Your Dashboard', type: 'article', link: '/help/getting-started/understanding-dashboard' },
          { id: 'exec-w1-4', title: 'Track your first insight', type: 'action', resourceId: 'mission-track-insight' },
        ],
      },
      {
        week: 2,
        title: 'Analytics Deep Dive',
        focus: 'TopTiering analytics — Funnels, Scorecards',
        steps: [
          { id: 'exec-w2-1', title: 'Read: Reading Your Daily Briefings', type: 'article', link: '/help/insights/daily-briefings' },
          { id: 'exec-w2-2', title: 'Read: Loan Funnel Analysis', type: 'article', link: '/help/toptiering/loan-funnel' },
          { id: 'exec-w2-3', title: 'Read: Company & Operations Scorecards', type: 'article', link: '/help/toptiering/scorecards' },
          { id: 'exec-w2-4', title: 'Read: Financial Modeling Sandbox', type: 'article', link: '/help/toptiering/financial-modeling' },
        ],
      },
      {
        week: 3,
        title: 'Custom Dashboards',
        focus: 'Workbench — Building executive views',
        steps: [
          { id: 'exec-w3-1', title: 'Read: Creating Your First Canvas', type: 'article', link: '/help/workbench/first-canvas' },
          { id: 'exec-w3-2', title: 'Read: Using the AI Assistant', type: 'article', link: '/help/workbench/workbench-ai' },
          { id: 'exec-w3-3', title: 'Build your first dashboard', type: 'action', resourceId: 'mission-build-dashboard' },
          { id: 'exec-w3-4', title: 'Read: Generating Reports (PPTX/PDF)', type: 'article', link: '/help/workbench/generating-reports' },
        ],
      },
      {
        week: 4,
        title: 'Advanced Features',
        focus: 'Research Lab, Cohi Chat',
        steps: [
          { id: 'exec-w4-1', title: 'Read: Starting a Research Session', type: 'article', link: '/help/research-lab/starting-research' },
          { id: 'exec-w4-2', title: 'Run a research session', type: 'action', resourceId: 'mission-run-research' },
          { id: 'exec-w4-3', title: 'Read: What You Can Ask Cohi', type: 'article', link: '/help/cohi-chat/what-you-can-ask' },
          { id: 'exec-w4-4', title: 'Ask Cohi a question', type: 'action', resourceId: 'mission-ask-cohi' },
        ],
      },
    ],
  },
  {
    id: 'path-manager',
    role: 'Branch Manager / VP of Sales',
    title: 'Branch Manager Learning Path',
    description: 'Focus on leaderboards, sales analytics, funnels, and team management.',
    weeks: [
      {
        week: 1,
        title: 'Getting Oriented',
        focus: 'Insights dashboard — Leaderboard, Daily Briefings',
        steps: [
          { id: 'mgr-w1-1', title: 'Take the Welcome Tour', type: 'tour', resourceId: 'welcome' },
          { id: 'mgr-w1-2', title: 'Read: Understanding Your Dashboard', type: 'article', link: '/help/getting-started/understanding-dashboard' },
          { id: 'mgr-w1-3', title: 'Read: Reading Your Daily Briefings', type: 'article', link: '/help/insights/daily-briefings' },
          { id: 'mgr-w1-4', title: 'Track your first insight', type: 'action', resourceId: 'mission-track-insight' },
        ],
      },
      {
        week: 2,
        title: 'Pipeline Analytics',
        focus: 'Loan Funnel, Sales Scorecard, TopTiering',
        steps: [
          { id: 'mgr-w2-1', title: 'Read: Loan Funnel Analysis', type: 'article', link: '/help/toptiering/loan-funnel' },
          { id: 'mgr-w2-2', title: 'Read: Company & Operations Scorecards', type: 'article', link: '/help/toptiering/scorecards' },
          { id: 'mgr-w2-3', title: 'Read: TopTiering Comparison', type: 'article', link: '/help/toptiering/toptiering-comparison' },
          { id: 'mgr-w2-4', title: 'Read: Sales Trends', type: 'article', link: '/help/toptiering/sales-trends' },
        ],
      },
      {
        week: 3,
        title: 'Custom Dashboards',
        focus: 'Workbench — Building team performance views',
        steps: [
          { id: 'mgr-w3-1', title: 'Read: Creating Your First Canvas', type: 'article', link: '/help/workbench/first-canvas' },
          { id: 'mgr-w3-2', title: 'Read: Using the AI Assistant', type: 'article', link: '/help/workbench/workbench-ai' },
          { id: 'mgr-w3-3', title: 'Read: Sharing Dashboards and Team Folders', type: 'article', link: '/help/workbench/sharing-dashboards' },
          { id: 'mgr-w3-4', title: 'Build your first dashboard', type: 'action', resourceId: 'mission-build-dashboard' },
        ],
      },
      {
        week: 4,
        title: 'Advanced Features',
        focus: 'Research Lab, Cohi Chat, Reports',
        steps: [
          { id: 'mgr-w4-1', title: 'Read: Starting a Research Session', type: 'article', link: '/help/research-lab/starting-research' },
          { id: 'mgr-w4-2', title: 'Ask Cohi a question', type: 'action', resourceId: 'mission-ask-cohi' },
          { id: 'mgr-w4-3', title: 'Read: Generating Reports (PPTX/PDF)', type: 'article', link: '/help/workbench/generating-reports' },
          { id: 'mgr-w4-4', title: 'Export a report', type: 'action', resourceId: 'mission-export-report' },
        ],
      },
    ],
  },
  {
    id: 'path-lo',
    role: 'Loan Officer',
    title: 'Loan Officer Learning Path',
    description: 'Focus on pipeline tracking, personal metrics, and AI insights.',
    weeks: [
      {
        week: 1,
        title: 'Getting Started',
        focus: 'Login, Daily Briefings, Loan Table basics',
        steps: [
          { id: 'lo-w1-1', title: 'Take the Welcome Tour', type: 'tour', resourceId: 'welcome' },
          { id: 'lo-w1-2', title: 'Read: First Steps After Login', type: 'article', link: '/help/getting-started/first-steps' },
          { id: 'lo-w1-3', title: 'Read: Reading Your Daily Briefings', type: 'article', link: '/help/insights/daily-briefings' },
          { id: 'lo-w1-4', title: 'Read: Navigating the Platform', type: 'article', link: '/help/getting-started/navigating-the-platform' },
        ],
      },
      {
        week: 2,
        title: 'Your Pipeline & AI',
        focus: 'Cohi Chat, Insight follow-ups, personal metrics',
        steps: [
          { id: 'lo-w2-1', title: 'Read: What You Can Ask Cohi', type: 'article', link: '/help/cohi-chat/what-you-can-ask' },
          { id: 'lo-w2-2', title: 'Read: Example Queries', type: 'article', link: '/help/cohi-chat/example-queries' },
          { id: 'lo-w2-3', title: 'Ask Cohi a question', type: 'action', resourceId: 'mission-ask-cohi' },
          { id: 'lo-w2-4', title: 'Read: Asking Follow-Up Questions', type: 'article', link: '/help/insights/insight-chat' },
        ],
      },
    ],
  },
  {
    id: 'path-ops',
    role: 'Operations / Processing',
    title: 'Operations Learning Path',
    description: 'Focus on operational metrics, turn times, and loan data.',
    weeks: [
      {
        week: 1,
        title: 'Getting Started',
        focus: 'Login, Insights, Operations Scorecard',
        steps: [
          { id: 'ops-w1-1', title: 'Take the Welcome Tour', type: 'tour', resourceId: 'welcome' },
          { id: 'ops-w1-2', title: 'Read: First Steps After Login', type: 'article', link: '/help/getting-started/first-steps' },
          { id: 'ops-w1-3', title: 'Read: Company & Operations Scorecards', type: 'article', link: '/help/toptiering/scorecards' },
          { id: 'ops-w1-4', title: 'Read: Understanding Your Dashboard', type: 'article', link: '/help/getting-started/understanding-dashboard' },
        ],
      },
      {
        week: 2,
        title: 'Analytics & AI',
        focus: 'TopTiering, Cohi Chat, insights',
        steps: [
          { id: 'ops-w2-1', title: 'Read: Loan Funnel Analysis', type: 'article', link: '/help/toptiering/loan-funnel' },
          { id: 'ops-w2-2', title: 'Read: What You Can Ask Cohi', type: 'article', link: '/help/cohi-chat/what-you-can-ask' },
          { id: 'ops-w2-3', title: 'Track your first insight', type: 'action', resourceId: 'mission-track-insight' },
          { id: 'ops-w2-4', title: 'Ask Cohi a question', type: 'action', resourceId: 'mission-ask-cohi' },
        ],
      },
    ],
  },
  {
    id: 'path-admin',
    role: 'IT Admin / Tenant Admin',
    title: 'Admin Learning Path',
    description: 'Focus on configuration, user management, LOS setup.',
    weeks: [
      {
        week: 1,
        title: 'Getting Started',
        focus: 'Login, platform overview, admin access',
        steps: [
          { id: 'adm-w1-1', title: 'Take the Welcome Tour', type: 'tour', resourceId: 'welcome' },
          { id: 'adm-w1-2', title: 'Read: First Steps After Login', type: 'article', link: '/help/getting-started/first-steps' },
          { id: 'adm-w1-3', title: 'Read: Managing Users and Roles', type: 'article', link: '/help/admin/managing-users' },
          { id: 'adm-w1-4', title: 'Read: Navigating the Platform', type: 'article', link: '/help/getting-started/navigating-the-platform' },
        ],
      },
      {
        week: 2,
        title: 'LOS & Data Setup',
        focus: 'Encompass connection, field mapping, data quality',
        steps: [
          { id: 'adm-w2-1', title: 'Read: Configuring LOS Connections', type: 'article', link: '/help/admin/connecting-los' },
          { id: 'adm-w2-2', title: 'Read: Field Mapping and Data Quality', type: 'article', link: '/help/admin/data-quality' },
          { id: 'adm-w2-3', title: 'Read: Knowledge Base Management', type: 'article', link: '/help/admin/knowledge-base' },
          { id: 'adm-w2-4', title: 'Read: SSO Configuration', type: 'article', link: '/help/admin/sso-configuration' },
        ],
      },
    ],
  },
];

export function getLearningPathForRole(role: string): LearningPath | undefined {
  const roleMap: Record<string, string> = {
    super_admin: 'IT Admin / Tenant Admin',
    platform_admin: 'IT Admin / Tenant Admin',
    tenant_admin: 'IT Admin / Tenant Admin',
    admin: 'IT Admin / Tenant Admin',
    user: 'Branch Manager / VP of Sales',
    viewer: 'Executive / C-Suite',
    loan_officer: 'Loan Officer',
    processor: 'Operations / Processing',
  };
  const targetRole = roleMap[role] || 'Executive / C-Suite';
  return learningPaths.find(p => p.role === targetRole);
}
