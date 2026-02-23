/**
 * Widget definitions for High Performers (Branch & Loan Officer rankings, left/right periods).
 * Data source provides { left: HighPerformersData, right: HighPerformersData } from WidgetDataProvider.
 */

import type { WidgetDefinition } from './types';
import type { HighPerformerRow } from '@/hooks/useHighPerformersData';
import { HighPerformersRankingsTableWidget } from '../components/HighPerformersRankingsTableWidget';

interface HighPerformersSource {
  left: { branchRankings: HighPerformerRow[]; loanOfficerRankings: HighPerformerRow[] };
  right: { branchRankings: HighPerformerRow[]; loanOfficerRankings: HighPerformerRow[] };
}

function src(raw: unknown): HighPerformersSource {
  const s = raw as HighPerformersSource;
  return {
    left: s?.left ?? { branchRankings: [], loanOfficerRankings: [] },
    right: s?.right ?? { branchRankings: [], loanOfficerRankings: [] },
  };
}

const branchLeft: WidgetDefinition<HighPerformerRow[] | null> = {
  id: 'high-performers-branch-left',
  name: 'Branch Rankings',
  description: 'Branch rankings for the left column period',
  category: 'table',
  group: 'High Performers',
  dataSource: 'high-performers',
  dataSelector: (raw) => src(raw).left.branchRankings ?? [],
  defaultSize: { w: 500, h: 320 },
  minSize: { w: 280, h: 200 },
  component: HighPerformersRankingsTableWidget,
  config: {
    title: 'Branch Rankings',
    nameLabel: 'Branch',
    exportFileName: 'high-performers-branch-left',
  },
};

const branchRight: WidgetDefinition<HighPerformerRow[] | null> = {
  id: 'high-performers-branch-right',
  name: 'Branch Rankings',
  description: 'Branch rankings for the right column period',
  category: 'table',
  group: 'High Performers',
  dataSource: 'high-performers',
  dataSelector: (raw) => src(raw).right.branchRankings ?? [],
  defaultSize: { w: 500, h: 320 },
  minSize: { w: 280, h: 200 },
  component: HighPerformersRankingsTableWidget,
  config: {
    title: 'Branch Rankings',
    nameLabel: 'Branch',
    exportFileName: 'high-performers-branch-right',
  },
};

const loLeft: WidgetDefinition<HighPerformerRow[] | null> = {
  id: 'high-performers-lo-left',
  name: 'Loan Officer Rankings',
  description: 'Loan officer rankings for the left column period',
  category: 'table',
  group: 'High Performers',
  dataSource: 'high-performers',
  dataSelector: (raw) => src(raw).left.loanOfficerRankings ?? [],
  defaultSize: { w: 500, h: 320 },
  minSize: { w: 280, h: 200 },
  component: HighPerformersRankingsTableWidget,
  config: {
    title: 'Loan Officer Rankings',
    nameLabel: 'Loan Officer',
    exportFileName: 'high-performers-lo-left',
  },
};

const loRight: WidgetDefinition<HighPerformerRow[] | null> = {
  id: 'high-performers-lo-right',
  name: 'Loan Officer Rankings',
  description: 'Loan officer rankings for the right column period',
  category: 'table',
  group: 'High Performers',
  dataSource: 'high-performers',
  dataSelector: (raw) => src(raw).right.loanOfficerRankings ?? [],
  defaultSize: { w: 500, h: 320 },
  minSize: { w: 280, h: 200 },
  component: HighPerformersRankingsTableWidget,
  config: {
    title: 'Loan Officer Rankings',
    nameLabel: 'Loan Officer',
    exportFileName: 'high-performers-lo-right',
  },
};

export const highPerformersWidgets: WidgetDefinition[] = [
  branchLeft,
  branchRight,
  loLeft,
  loRight,
];
