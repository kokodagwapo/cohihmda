/**
 * Widget definitions for Loan Detail (workbench table with section filters).
 */

import type { WidgetDefinition } from './types';
import type { LoanDetailListResponse } from '@/hooks/useLoanDetailData';
import { LoanDetailTableWidget } from '../components/LoanDetailTableWidget';

export const loanDetailTable: WidgetDefinition<LoanDetailListResponse | null> = {
  id: 'loan-detail-table',
  name: 'Loan Detail Table',
  description: 'All loans with section filters (date, branch, loan officer). Virtualized for performance.',
  category: 'table',
  group: 'Loan Detail',
  dataSource: 'loan-detail',
  dataSelector: (raw) => raw as LoanDetailListResponse | null,
  defaultSize: { w: 500, h: 280 },
  minSize: { w: 300, h: 160 },
  component: LoanDetailTableWidget,
};

export const loanDetailWidgets: WidgetDefinition[] = [loanDetailTable];
