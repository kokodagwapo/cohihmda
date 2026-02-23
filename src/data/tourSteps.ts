import type { Step } from 'react-joyride';

export const welcomeTourSteps: Step[] = [
  {
    target: 'body',
    content: 'Welcome to Cohi! This quick tour will show you the key areas of the platform. You can replay this tour anytime from Settings.',
    placement: 'center',
    disableBeacon: true,
    title: 'Welcome to Cohi',
  },
  {
    target: '[aria-label="Main navigation"]',
    content: 'This is your main navigation bar. From here you can access Insights, TopTiering analytics, your Workbench, and the Research Lab.',
    placement: 'bottom',
    title: 'Navigation',
  },
  {
    target: '[aria-label="Insights menu"]',
    content: 'The Insights page is your home base. It shows AI-generated Daily Briefings, industry news, performance leaderboards, and KPI overviews.',
    placement: 'bottom',
    title: 'Insights Dashboard',
  },
  {
    target: '[aria-label="Dashboard menu"]',
    content: 'The Dashboard menu gives you access to TopTiering analytics: Loan Funnel, Scorecards, Credit Risk, Financial Modeling, and more.',
    placement: 'bottom',
    title: 'TopTiering Analytics',
  },
  {
    target: '[aria-label="My Workbench"]',
    content: 'The Workbench is your custom dashboard builder. Create canvases, add widgets, and use AI to generate charts and reports from natural language.',
    placement: 'bottom',
    title: 'My Workbench',
  },
  {
    target: '[aria-label="Research Lab"]',
    content: 'The Research Lab is your AI-powered analyst. Ask deep questions about your data and get comprehensive research reports.',
    placement: 'bottom',
    title: 'Research Lab',
  },
  {
    target: 'body',
    content: 'That\'s the basics! Explore each section to learn more. Look for the "?" icon on any page for contextual help, or use Cohi Chat to ask questions anytime.',
    placement: 'center',
    title: 'You\'re All Set!',
  },
];

export const workbenchTourSteps: Step[] = [
  {
    target: '[data-tour="workbench-sidebar"]',
    content: 'Your canvases are listed here. Create new ones, organize into folders, and quickly switch between dashboards.',
    placement: 'right',
    disableBeacon: true,
    title: 'Canvas Sidebar',
  },
  {
    target: '[data-tour="workbench-canvas"]',
    content: 'This is your canvas area. Drag and drop widgets to build custom dashboards. Auto-save keeps your work safe.',
    placement: 'center',
    title: 'Canvas Area',
  },
  {
    target: '[data-tour="workbench-add-widget"]',
    content: 'Click here to add widgets from the catalog, or use the AI assistant to create widgets from natural language descriptions.',
    placement: 'bottom',
    title: 'Add Widgets',
  },
  {
    target: '[data-tour="workbench-chat"]',
    content: 'The Workbench AI assistant can create widgets, modify charts, generate SQL queries, and build full reports from your instructions.',
    placement: 'left',
    title: 'AI Assistant',
  },
  {
    target: '[data-tour="workbench-share"]',
    content: 'Share your dashboards with team members, add them to team folders, or generate shareable links.',
    placement: 'bottom',
    title: 'Share & Collaborate',
  },
  {
    target: '[data-tour="workbench-export"]',
    content: 'Export your dashboard as a PowerPoint presentation or PDF report with one click.',
    placement: 'bottom',
    title: 'Export Reports',
  },
];

export const researchLabTourSteps: Step[] = [
  {
    target: '[data-tour="research-input"]',
    content: 'Type your research question here. Be specific — the AI analyst will investigate your loan data and generate a comprehensive report.',
    placement: 'bottom',
    disableBeacon: true,
    title: 'Ask a Question',
  },
  {
    target: '[data-tour="research-suggestions"]',
    content: 'Not sure what to ask? These topic suggestions cover common areas like pipeline health, personnel performance, and risk patterns.',
    placement: 'bottom',
    title: 'Topic Suggestions',
  },
  {
    target: '[data-tour="research-timeline"]',
    content: 'Watch the AI\'s research process in real-time. The timeline shows each step of the investigation as it happens.',
    placement: 'left',
    title: 'Research Timeline',
  },
  {
    target: '[data-tour="research-findings"]',
    content: 'Research findings are presented with severity levels and drill-down details. Click any finding to see the full analysis.',
    placement: 'top',
    title: 'Research Findings',
  },
];

export const topTieringTourSteps: Step[] = [
  {
    target: '[data-tour="toptiering-nav"]',
    content: 'Navigate between analytics views using the Dashboard menu. Each view offers a different perspective on your pipeline performance.',
    placement: 'bottom',
    disableBeacon: true,
    title: 'Analytics Navigation',
  },
  {
    target: '[data-tour="toptiering-filters"]',
    content: 'Filter analytics by date range, branch, channel, and other dimensions to focus your analysis.',
    placement: 'bottom',
    title: 'Analytics Filters',
  },
  {
    target: '[data-tour="toptiering-chart"]',
    content: 'Interactive charts let you drill down into the data. Hover for details, click segments to filter, and zoom into time ranges.',
    placement: 'top',
    title: 'Interactive Charts',
  },
  {
    target: '[data-tour="toptiering-table"]',
    content: 'Detailed data tables complement the charts. Sort, filter, and export for deeper analysis.',
    placement: 'top',
    title: 'Detail Tables',
  },
];

export const adminTourSteps: Step[] = [
  {
    target: '[data-tour="admin-users"]',
    content: 'Manage your organization\'s users here. Add new users, assign roles, control access, and monitor login activity.',
    placement: 'right',
    disableBeacon: true,
    title: 'User Management',
  },
  {
    target: '[data-tour="admin-roles"]',
    content: 'Create custom roles with specific section access, field restrictions, and row-level filters for fine-grained permissions.',
    placement: 'right',
    title: 'Role Management',
  },
  {
    target: '[data-tour="admin-los"]',
    content: 'Configure your LOS connection to sync loan data. Set up field mappings, sync schedules, and webhook notifications.',
    placement: 'right',
    title: 'LOS Connection',
  },
  {
    target: '[data-tour="admin-knowledge"]',
    content: 'Add documents to the knowledge base to enhance Cohi Chat\'s responses with your organization\'s specific context.',
    placement: 'right',
    title: 'Knowledge Base',
  },
  {
    target: '[data-tour="admin-settings"]',
    content: 'Configure tenant-wide settings including revenue formulas, data quality rules, and notification preferences.',
    placement: 'right',
    title: 'Tenant Settings',
  },
];

export const financialModelingTourSteps: Step[] = [
  {
    target: '[data-tour="fms-parameters"]',
    content: 'Set your scenario parameters: adjust interest rates, volume projections, margin assumptions, and more.',
    placement: 'right',
    disableBeacon: true,
    title: 'Scenario Parameters',
  },
  {
    target: '[data-tour="fms-run"]',
    content: 'Run the model to see projected outcomes based on your parameters.',
    placement: 'bottom',
    title: 'Run Projection',
  },
  {
    target: '[data-tour="fms-results"]',
    content: 'Compare scenarios side-by-side. See how different assumptions affect revenue, volume, and profitability.',
    placement: 'top',
    title: 'Compare Outcomes',
  },
  {
    target: '[data-tour="fms-export"]',
    content: 'Export your financial model results for presentations and planning sessions.',
    placement: 'bottom',
    title: 'Export Results',
  },
];

export type TourId = 'welcome' | 'workbench' | 'research' | 'toptiering' | 'admin' | 'financial-modeling';

export const tourRegistry: Record<TourId, { steps: Step[]; label: string }> = {
  welcome: { steps: welcomeTourSteps, label: 'Welcome Tour' },
  workbench: { steps: workbenchTourSteps, label: 'Workbench Tour' },
  research: { steps: researchLabTourSteps, label: 'Research Lab Tour' },
  toptiering: { steps: topTieringTourSteps, label: 'TopTiering Tour' },
  admin: { steps: adminTourSteps, label: 'Admin Panel Tour' },
  'financial-modeling': { steps: financialModelingTourSteps, label: 'Financial Modeling Tour' },
};
