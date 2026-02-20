/**
 * widgetSectionStore – Zustand store for per-section filter state.
 *
 * Each "section" on the workbench canvas (e.g. Company Scorecard, Credit Risk)
 * gets its own filter state so users can have different timeframes per section.
 *
 * Widgets reference a sectionId to inherit their parent section's filters.
 */

import { create } from 'zustand';
import type { PeriodSelection } from '@/components/ui/DatePeriodPicker';

export type SectionType =
  | 'company-scorecard'
  | 'credit-risk'
  | 'sales-scorecard'
  | 'operations-scorecard'
  | 'operations-trends'
  | 'sales-trends'
  | 'funnel'
  | 'top-tiering-comparison'
  | 'leaderboard'
  | 'executive-dashboard'
  | 'loan-detail'
  | 'workflow-conversion';

/**
 * A dynamic (user-added) filter dimension.
 * These are stored per-section and applied to Cohi widgets as SQL WHERE conditions
 * and to registry widgets where the data hook supports them.
 */
export interface DynamicFilterEntry {
  /** DB column name (e.g. 'state', 'channel', 'loan_type') */
  column: string;
  /** Display label (e.g. 'State', 'Channel') */
  label: string;
  /** Selected value — 'all' means no filter applied */
  value: string;
}

export interface SectionFilters {
  /** Which dashboard this section represents – maps to a data source */
  sectionType: SectionType;
  year: number;
  /** Optional explicit date range (overrides year when set by DatePeriodPicker rolling/custom) */
  dateRange?: { start: string; end: string };
  /** Full period selection from DatePeriodPicker (type + preset + computed range) */
  periodSelection?: PeriodSelection;
  branch: string;
  loanOfficer: string;
  application: string;
  dateField: string;
  /** For credit risk: Applications Taken, Funded Production, etc. */
  applicationType: string;
  /** For sales: branch or loan_officer */
  actorType: 'branch' | 'loan_officer';
  /** User-added dynamic filters (column = value conditions) */
  dynamicFilters?: DynamicFilterEntry[];
}

const currentYear = new Date().getFullYear();

export const DEFAULT_SECTION_FILTERS: SectionFilters = {
  sectionType: 'company-scorecard',
  year: currentYear,
  branch: 'all',
  loanOfficer: 'all',
  application: 'applicationsTaken',
  dateField: 'application_date',
  applicationType: 'Applications Taken',
  actorType: 'loan_officer',
};

interface WidgetSectionState {
  /** Map of sectionId -> filters */
  sections: Record<string, SectionFilters>;
  /** Get filters for a section (returns defaults if not yet registered) */
  getFilters: (sectionId: string) => SectionFilters;
  /** Update one or more filter fields for a section */
  updateFilters: (sectionId: string, partial: Partial<SectionFilters>) => void;
  /** Register a new section with its type and default filters */
  registerSection: (sectionId: string, sectionType: SectionType) => void;
  /** Remove a section's filters (when all widgets in that section are removed) */
  removeSection: (sectionId: string) => void;
  /** Find the first section of a given type and return its filters (or null) */
  getFiltersByType: (sectionType: SectionType) => SectionFilters | null;
  /** Add a dynamic filter to a section */
  addDynamicFilter: (sectionId: string, filter: DynamicFilterEntry) => void;
  /** Remove a dynamic filter from a section by column name */
  removeDynamicFilter: (sectionId: string, column: string) => void;
  /** Update a dynamic filter's value */
  updateDynamicFilter: (sectionId: string, column: string, value: string) => void;
}

export const useWidgetSectionStore = create<WidgetSectionState>((set, get) => ({
  sections: {},

  getFilters: (sectionId: string) => {
    return get().sections[sectionId] ?? DEFAULT_SECTION_FILTERS;
  },

  updateFilters: (sectionId: string, partial: Partial<SectionFilters>) => {
    set((state) => {
      const prev = state.sections[sectionId] ?? DEFAULT_SECTION_FILTERS;
      const merged = { ...prev, ...partial };

      // Cascading reset: when branch changes, reset loanOfficer to 'all'
      // (unless loanOfficer is also being explicitly set in the same update)
      if (
        'branch' in partial &&
        partial.branch !== prev.branch &&
        !('loanOfficer' in partial)
      ) {
        merged.loanOfficer = 'all';
      }

      return {
        sections: { ...state.sections, [sectionId]: merged },
      };
    });
  },

  registerSection: (sectionId: string, sectionType: SectionType) => {
    set((state) => {
      if (state.sections[sectionId]) return state; // Already registered
      const base = { ...DEFAULT_SECTION_FILTERS, sectionType };
      // Loan detail defaults to "All" (no date filter) so the table shows all loans
      const filters =
        sectionType === 'loan-detail'
          ? { ...base, periodSelection: undefined, dateRange: undefined }
          : base;
      return {
        sections: {
          ...state.sections,
          [sectionId]: filters,
        },
      };
    });
  },

  removeSection: (sectionId: string) => {
    set((state) => {
      const { [sectionId]: _, ...rest } = state.sections;
      return { sections: rest };
    });
  },

  getFiltersByType: (sectionType: SectionType) => {
    const sections = get().sections;
    for (const filters of Object.values(sections)) {
      if (filters.sectionType === sectionType) return filters;
    }
    return null;
  },

  addDynamicFilter: (sectionId: string, filter: DynamicFilterEntry) => {
    set((state) => {
      const prev = state.sections[sectionId];
      if (!prev) return state;
      const existing = prev.dynamicFilters || [];
      // Don't add if already present
      if (existing.some((f) => f.column === filter.column)) return state;
      return {
        sections: {
          ...state.sections,
          [sectionId]: { ...prev, dynamicFilters: [...existing, filter] },
        },
      };
    });
  },

  removeDynamicFilter: (sectionId: string, column: string) => {
    set((state) => {
      const prev = state.sections[sectionId];
      if (!prev || !prev.dynamicFilters) return state;
      return {
        sections: {
          ...state.sections,
          [sectionId]: {
            ...prev,
            dynamicFilters: prev.dynamicFilters.filter((f) => f.column !== column),
          },
        },
      };
    });
  },

  updateDynamicFilter: (sectionId: string, column: string, value: string) => {
    set((state) => {
      const prev = state.sections[sectionId];
      if (!prev || !prev.dynamicFilters) return state;
      return {
        sections: {
          ...state.sections,
          [sectionId]: {
            ...prev,
            dynamicFilters: prev.dynamicFilters.map((f) =>
              f.column === column ? { ...f, value } : f,
            ),
          },
        },
      };
    });
  },
}));
