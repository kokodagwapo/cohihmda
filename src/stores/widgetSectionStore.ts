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
  | 'executive-dashboard';

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
      return {
        sections: {
          ...state.sections,
          [sectionId]: { ...DEFAULT_SECTION_FILTERS, sectionType },
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
}));
