/**
 * SectionHeader – A canvas widget that provides a title bar and filter controls
 * for a group of related widgets (e.g. "Company Scorecard" section).
 *
 * Filter state is stored in widgetSectionStore so child widgets
 * can read the current filters for their section.
 */

import React, { useEffect } from 'react';
import { useWidgetSectionStore, type SectionFilters, type SectionType } from '@/stores/widgetSectionStore';
import { ChevronDown } from 'lucide-react';

export type { SectionType } from '@/stores/widgetSectionStore';

export interface SectionHeaderProps {
  /** Unique section identifier – links this header to its child widgets */
  sectionId: string;
  /** Display title for the section */
  title: string;
  /** Which dashboard this section represents (controls which filters appear) */
  sectionType: SectionType;
}

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 4 }, (_, i) => currentYear - i);

const DATE_FIELD_OPTIONS = [
  { value: 'application_date', label: 'Application Date' },
  { value: 'funding_date', label: 'Funding Date' },
  { value: 'started_date', label: 'Started Date' },
  { value: 'closing_date', label: 'Closing Date' },
  { value: 'lock_date', label: 'Lock Date' },
];

const APPLICATION_TYPE_OPTIONS = [
  { value: 'Applications Taken', label: 'Applications Taken' },
  { value: 'Funded Production', label: 'Funded Production' },
  { value: 'Lost Opportunities', label: 'Lost Opportunities' },
  { value: 'All Loans', label: 'All Loans' },
];

const ACTOR_TYPE_OPTIONS = [
  { value: 'loan_officer', label: 'By Loan Officer' },
  { value: 'branch', label: 'By Branch' },
];

const PRICING_ENTITY_OPTIONS = [
  { value: 'branch', label: 'Branch' },
  { value: 'broker_lender_name', label: 'Broker Lender Name' },
  { value: 'channel', label: 'Channel' },
  { value: 'investor', label: 'Investor' },
];

const PRICING_ACTOR_OPTIONS = [
  { value: 'loan_officer', label: 'Loan Officer' },
  { value: 'account_executive', label: 'Account Executive' },
];

const PRICING_DATE_RANGE_OPTIONS = [
  { value: 'all', label: 'All Time' },
  { value: 'mtd', label: 'Month to Date' },
  { value: 'lm', label: 'Last Month' },
  { value: 'qtd', label: 'Quarter to Date' },
  { value: 'ytd', label: 'Year to Date' },
  { value: 'ly', label: 'Last Year' },
];

const PRICING_LOAN_FUNDING_OPTIONS = [
  { value: 'funded', label: 'Funded Loans' },
  { value: 'closed', label: 'Closed Loans' },
];

const PRICING_LOAN_STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'funded', label: 'Funded' },
];

const PRICING_LOCK_STATUS_OPTIONS = [
  { value: 'locked', label: 'Active Locked' },
  { value: 'not_locked', label: 'Active Not Locked' },
  { value: 'total', label: 'Active Total' },
];

export function SectionHeader({ sectionId, title, sectionType }: SectionHeaderProps) {
  const registerSection = useWidgetSectionStore((s) => s.registerSection);
  const updateFilters = useWidgetSectionStore((s) => s.updateFilters);
  const filters = useWidgetSectionStore((s) => s.getFilters(sectionId));

  // Register the section with its type on mount
  useEffect(() => {
    registerSection(sectionId, sectionType);
  }, [sectionId, sectionType, registerSection]);

  const update = (partial: Partial<SectionFilters>) => updateFilters(sectionId, partial);

  const SECTION_COLORS: Partial<Record<SectionType, string>> = {
    'company-scorecard': 'from-indigo-500 to-blue-500',
    'credit-risk': 'from-emerald-500 to-teal-500',
    'sales-scorecard': 'from-violet-500 to-purple-500',
    'operations-scorecard': 'from-indigo-500 to-blue-500',
    'operations-trends': 'from-orange-500 to-amber-500',
    'sales-trends': 'from-emerald-500 to-teal-500',
    'pricing-dashboard': 'from-emerald-500 to-green-600',
  };
  const accentGradient = SECTION_COLORS[sectionType] ?? 'from-slate-500 to-slate-600';

  return (
    <div className="h-full w-full flex flex-col rounded-xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-700/70 shadow-sm overflow-hidden">
      {/* Colored accent bar + title */}
      <div className={`flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r ${accentGradient} text-white`}>
        <h3 className="text-sm font-semibold tracking-tight flex-1">
          {title}
        </h3>
        <span className="text-[10px] font-medium opacity-70 uppercase tracking-wider">
          Section
        </span>
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50/80 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-700/50 flex-wrap">
        {/* Year – all section types */}
        <FilterSelect
          value={String(filters.year)}
          onChange={(v) => update({ year: Number(v) })}
          options={YEARS.map((y) => ({ value: String(y), label: String(y) }))}
          label="Year"
        />

        {/* Company Scorecard-specific filters */}
        {sectionType === 'company-scorecard' && (
          <>
            <FilterSelect
              value={filters.dateField}
              onChange={(v) => update({ dateField: v })}
              options={DATE_FIELD_OPTIONS}
              label="Date Field"
            />
          </>
        )}

        {/* Credit Risk-specific filters */}
        {sectionType === 'credit-risk' && (
          <FilterSelect
            value={filters.applicationType}
            onChange={(v) => update({ applicationType: v })}
            options={APPLICATION_TYPE_OPTIONS}
            label="Type"
          />
        )}

        {/* Sales Scorecard-specific filters */}
        {sectionType === 'sales-scorecard' && (
          <FilterSelect
            value={filters.actorType}
            onChange={(v) => update({ actorType: v as 'branch' | 'loan_officer' })}
            options={ACTOR_TYPE_OPTIONS}
            label="View"
          />
        )}

        {/* Pricing Dashboard-specific filters */}
        {sectionType === 'pricing-dashboard' && (
          <>
            <FilterSelect
              value={filters.pricingEntityType ?? 'branch'}
              onChange={(v) => update({ pricingEntityType: v })}
              options={PRICING_ENTITY_OPTIONS}
              label="Entity"
            />
            <FilterSelect
              value={filters.pricingActorType ?? 'loan_officer'}
              onChange={(v) => update({ pricingActorType: v })}
              options={PRICING_ACTOR_OPTIONS}
              label="Actor"
            />
            <FilterSelect
              value={filters.pricingDateRange ?? 'mtd'}
              onChange={(v) => update({ pricingDateRange: v })}
              options={PRICING_DATE_RANGE_OPTIONS}
              label="Date range"
            />
            <FilterSelect
              value={filters.pricingLoanStatus ?? 'active'}
              onChange={(v) => update({ pricingLoanStatus: v })}
              options={PRICING_LOAN_STATUS_OPTIONS}
              label="Loan status"
            />
            <FilterSelect
              value={filters.pricingLoanFunding ?? 'funded'}
              onChange={(v) => update({ pricingLoanFunding: v })}
              options={PRICING_LOAN_FUNDING_OPTIONS}
              label="Loan funding"
            />
            <FilterSelect
              value={filters.pricingLockStatus ?? 'total'}
              onChange={(v) => update({ pricingLockStatus: v })}
              options={PRICING_LOCK_STATUS_OPTIONS}
              label="Lock status"
            />
          </>
        )}
      </div>
    </div>
  );
}

/** Compact dropdown for filter controls */
function FilterSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
        {label}
      </span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-2 pr-6 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 canvas-interactive"
          title={label}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 pointer-events-none" />
      </div>
    </div>
  );
}
