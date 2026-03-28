import type { CohiPortfolioLoan } from '../data/portfolioFromBuilderImport';

/** Pipeline-stage buckets for Active Loans tab filtering (LOS-style). */
export type LoanPipelineTabId =
  | 'all'
  | 'clearToClose'
  | 'approved'
  | 'conditional'
  | 'locked'
  | 'processing'
  | 'other';

export const LOAN_PIPELINE_TABS: Array<{
  id: LoanPipelineTabId;
  label: string;
  shortLabel?: string;
}> = [
  { id: 'all', label: 'All' },
  { id: 'clearToClose', label: 'Clear to close', shortLabel: 'CTC' },
  { id: 'approved', label: 'Approved' },
  { id: 'conditional', label: 'Conditional approval', shortLabel: 'Conditional' },
  { id: 'locked', label: 'Locked' },
  { id: 'processing', label: 'Processing' },
  { id: 'other', label: 'Other' },
];

/**
 * Maps a loan to a single pipeline tab using import origination text when available,
 * then rate lock, then construction-proxy `loan.status` (demo / legacy).
 */
export function getLoanPipelineCategory(loan: CohiPortfolioLoan): Exclude<LoanPipelineTabId, 'all'> {
  const o = (loan.builderImportRow?.Origination_Status ?? '').trim().toLowerCase();

  if (o) {
    if (
      /\bctc\b/.test(o) ||
      /clear\s*to\s*close|clear-to-close|ready\s*to\s*close|docs?\s*out|signing\s*scheduled|closing\s*disclosure/i.test(
        o,
      )
    ) {
      return 'clearToClose';
    }
    if (/conditional|cond\.?\s*app|suspended|resubmit|aus\s*du|conditional\s*approval/i.test(o)) {
      return 'conditional';
    }
    if (
      /\bfinal approval\b|\bapproved\b|\bcredit approved\b|move to c\/t\/c|move to ctc/i.test(o)
    ) {
      return 'approved';
    }
    if (/underwriting|submitted\s*to\s*uw|\bu\/w\b|in\s*uw/i.test(o)) {
      return 'processing';
    }
    if (/processing|loan\s*setup|disclosure|file\s*setup|initial\s*setup|data\s*entry/i.test(o)) {
      return 'processing';
    }
    if (/funding|at\s*closing|scheduled\s*to\s*close|closed\s*for\s*record/i.test(o)) {
      return 'clearToClose';
    }
  }

  if (loan.rateLock?.status === 'Locked') {
    return 'locked';
  }

  const s = (loan.status || '').trim().toLowerCase();
  if (s === 'finishing') return 'clearToClose';
  if (s === 'drywall') return 'conditional';
  if (s === 'framing' || s === 'foundation') return 'processing';

  if (s.includes('finish')) return 'clearToClose';
  if (s.includes('drywall')) return 'conditional';
  if (s.includes('framing')) return 'processing';
  if (s.includes('foundation') || s.includes('permit')) return 'processing';

  return 'other';
}
