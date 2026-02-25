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
  | 'workflow-conversion'
  | 'high-performers'
  | 'actors'
  | 'pricing-dashboard';

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
  /** High Performers: date field (funding_date, closing_date, application_date) */
  highPerformersDateType?: 'funding_date' | 'closing_date' | 'application_date';
  /** High Performers: left column period (mtd, lm, ytd, ly, rolling_13) */
  highPerformersLeftPeriod?: string;
  /** High Performers: right column period */
  highPerformersRightPeriod?: string;
  /** Actors: calculation (average | median) */
  actorsCalculation?: 'average' | 'median';
  /** Actors: turn time type (app_to_fund_days | app_to_closing_days) */
  actorsTurnTimeType?: 'app_to_fund_days' | 'app_to_closing_days';
  /** Actors: date range type (calendar_days | business_days) */
  actorsDateRangeType?: 'calendar_days' | 'business_days';
  /** Actors: measure (units | volume) */
  actorsMeasure?: 'units' | 'volume';
  /** Actors: selected actor filter */
  actorsSelectedActor?: { type: string; name: string } | null;
  /** Actors: selected status filter (from bar chart) */
  actorsSelectedStatus?: string | null;
  /** Actors: which dimension each of the 4 table slots shows */
  actorsTableDimensions?: [string, string, string, string];
  /** Actors: ordered list of column ids to show in workbench actor tables (empty = all default) */
  actorsTableColumnIds?: string[];
  /** Pricing Dashboard: entity type (branch, broker_lender_name, channel, investor) */
  pricingEntityType?: string;
  /** Pricing Dashboard: actor type (loan_officer, account_executive) */
  pricingActorType?: string;
  /** Pricing Dashboard: date range (all, mtd, lm, qtd, ytd, ly) */
  pricingDateRange?: string;
  /** Pricing Dashboard: loan funding (funded, closed) */
  pricingLoanFunding?: string;
  /** Pricing Dashboard: loan status (all, active, funded) */
  pricingLoanStatus?: string;
  /** Pricing Dashboard: lock status (locked, not_locked, total) */
  pricingLockStatus?: string;
  /** Pricing Dashboard: entity value filter */
  pricingEntityValue?: string;
  /** Pricing Dashboard: actor value filter */
  pricingActorValue?: string;
  /** Workflow Conversion: period selection (MTD, QTD, etc.) */
  workflowPeriodSelection?: PeriodSelection;
  /** Workflow Conversion: conversion % vs turn time */
  workflowCalculationType?: 'conversion' | 'turn_time';
  /** Workflow Conversion: workflow vs individual cards */
  workflowGrouping?: 'workflow' | 'individual';
  /** Workflow Conversion: segment cards (from → to milestone ids) */
  workflowSegments?: { from: string; to: string }[];
  /** User-added dynamic filters (column = value conditions) */
  dynamicFilters?: DynamicFilterEntry[];
}

/** Default column ids for actor tables (workbench). Order determines display order. */
export const ACTORS_TABLE_DEFAULT_COLUMN_IDS = [
  'name',
  'units',
  'volume',
  'avgAppToFund',
  'approvalPct',
  'deniedPct',
  'withdrawnPct',
  'loanComplexity',
] as const;

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
      let filters = base;
      if (sectionType === 'loan-detail') {
        filters = { ...base, periodSelection: undefined, dateRange: undefined };
      } else if (sectionType === 'high-performers') {
        filters = {
          ...base,
          highPerformersDateType: 'funding_date',
          highPerformersLeftPeriod: 'mtd',
          highPerformersRightPeriod: 'ytd',
        };
      } else if (sectionType === 'actors') {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const range = {
          start: start.toISOString().slice(0, 10),
          end: now.toISOString().slice(0, 10),
        };
        filters = {
          ...base,
          periodSelection: { type: 'preset' as const, preset: 'mtd' as const, dateRange: range },
          dateRange: range,
          actorsCalculation: 'average',
          actorsTurnTimeType: 'app_to_fund_days',
          actorsDateRangeType: 'calendar_days',
          actorsMeasure: 'units',
          actorsSelectedActor: null,
          actorsSelectedStatus: null,
          actorsTableDimensions: ['loan_officer', 'processor', 'underwriter', 'closer'],
          actorsTableColumnIds: [...ACTORS_TABLE_DEFAULT_COLUMN_IDS],
        };
      } else if (sectionType === 'pricing-dashboard') {
        filters = {
          ...base,
          pricingEntityType: 'branch',
          pricingActorType: 'loan_officer',
          pricingDateRange: 'mtd',
          pricingLoanFunding: 'funded',
          pricingLoanStatus: 'active',
          pricingLockStatus: 'total',
          pricingEntityValue: '',
          pricingActorValue: '',
        };
      }
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
