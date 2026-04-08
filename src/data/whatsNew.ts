export interface WhatsNewEntry {
  id: string;
  date: string;
  title: string;
  description: string;
  category: 'feature' | 'improvement' | 'fix';
  link?: string;
  linkLabel?: string;
}

export const whatsNewEntries: WhatsNewEntry[] = [
  {
    id: 'wn-help-center',
    date: '2026-02-22',
    title: 'Help Center & Tutorials',
    description: 'A comprehensive Help Center is now available with searchable articles, interactive tours, and contextual help on every page. Look for the "?" icon to get page-specific guidance.',
    category: 'feature',
    link: '/help',
    linkLabel: 'Visit Help Center',
  },
  {
    id: 'wn-research-lab',
    date: '2026-02-15',
    title: 'Research Lab Enhancements',
    description: 'The AI Research Analyst now supports follow-up conversations, topic suggestions, and improved finding detail with severity-based organization.',
    category: 'improvement',
    link: '/research',
    linkLabel: 'Try Research Lab',
  },
  {
    id: 'wn-workbench-reports',
    date: '2026-02-10',
    title: 'Workbench Report Builder',
    description: 'Generate professional PowerPoint and PDF reports directly from your Workbench canvases. Use the AI assistant or the Export button to create reports.',
    category: 'feature',
    link: '/my-dashboard',
    linkLabel: 'Open Workbench',
  },
  {
    id: 'wn-financial-modeling',
    date: '2026-02-01',
    title: 'Financial Modeling Sandbox',
    description: 'Run what-if scenarios and projections with the new Financial Modeling Sandbox. Adjust parameters like rates, volume, and margins to project business outcomes.',
    category: 'feature',
    link: '/performance/financial-modeling-sandbox',
    linkLabel: 'Try Financial Modeling',
  },
  {
    id: 'wn-voice-ai',
    date: '2026-01-20',
    title: 'Cohi Voice AI',
    description: 'Talk to your data. The new voice AI assistant lets you have real-time conversations about your pipeline metrics and insights.',
    category: 'feature',
  },
  {
    id: 'wn-fallout-v2',
    date: '2026-01-15',
    title: 'Improved Fallout Predictions',
    description: 'The ML fallout prediction engine now includes enhanced risk scoring with reason codes, historical bucket analysis, and executive rollup summaries.',
    category: 'improvement',
  },
];

export function mergeWhatsNewEntries(
  apiEntries: WhatsNewEntry[],
  fallbackEntries: WhatsNewEntry[] = whatsNewEntries,
): WhatsNewEntry[] {
  const merged = new Map<string, WhatsNewEntry>();
  for (const entry of fallbackEntries) merged.set(entry.id, entry);
  for (const entry of apiEntries) merged.set(entry.id, entry);
  return Array.from(merged.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

export function getUnseenEntries(
  lastSeenDate: string | null,
  entries: WhatsNewEntry[] = whatsNewEntries,
): WhatsNewEntry[] {
  if (!lastSeenDate) return entries;
  return entries.filter(e => new Date(e.date) > new Date(lastSeenDate));
}
