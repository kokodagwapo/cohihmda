import React from 'react';
import type { AlethiaInsights, AlethiaSectionKey } from '@/utils/alethiaInsights';

function sectionStyle(title: AlethiaSectionKey, isDarkMode: boolean) {
  const base = {
    bg: isDarkMode ? 'bg-slate-800/40' : 'bg-white',
    border: isDarkMode ? 'border-slate-700' : 'border-slate-200',
    stripe: 'border-l-slate-300',
    label: isDarkMode ? 'text-slate-300' : 'text-slate-600',
    text: isDarkMode ? 'text-slate-300' : 'text-slate-600',
    display: title,
  };

  switch (title) {
    case 'Success':
      return {
        ...base,
        bg: isDarkMode ? 'bg-sky-900/15' : 'bg-sky-50/80',
        border: 'border-sky-400',
        stripe: '',
        label: isDarkMode ? 'text-sky-300' : 'text-sky-600',
        display: 'SUCCESS',
      };
    case 'Warning':
      return {
        ...base,
        bg: isDarkMode ? 'bg-amber-900/15' : 'bg-amber-50/80',
        border: 'border-amber-400',
        stripe: '',
        label: isDarkMode ? 'text-amber-300' : 'text-amber-600',
        display: 'WARNING',
      };
    case 'Critical':
      return {
        ...base,
        bg: isDarkMode ? 'bg-rose-900/15' : 'bg-rose-50/80',
        border: 'border-rose-400',
        stripe: '',
        label: isDarkMode ? 'text-rose-300' : 'text-rose-600',
        display: 'CRITICAL',
      };
    case 'TopTiering Insights for Loan Officers':
      return {
        ...base,
        bg: isDarkMode ? 'bg-indigo-900/15' : 'bg-indigo-50/80',
        border: 'border-indigo-400',
        stripe: '',
        label: isDarkMode ? 'text-indigo-300' : 'text-indigo-600',
        display: 'TopTiering Insights for Loan Officers',
      };
    case 'Borrower Coaching':
      return {
        ...base,
        bg: isDarkMode ? 'bg-emerald-900/15' : 'bg-emerald-50/80',
        border: 'border-emerald-400',
        stripe: '',
        label: isDarkMode ? 'text-emerald-300' : 'text-emerald-600',
        display: 'Borrower Coaching',
      };
    default:
      return base;
  }
}

export function AlethiaSectionCard(props: {
  section: { title: AlethiaSectionKey; items: string[] };
  isDarkMode: boolean;
}) {
  const { section, isDarkMode } = props;
  const s = sectionStyle(section.title, isDarkMode);
  return (
    <div className={`mb-4 p-5 rounded-xl ${s.bg}`}>
      <p className={`text-[13px] font-medium uppercase tracking-wider mb-3 flex items-center gap-2 ${s.label}`}>
        {s.display}
      </p>
      {section.items.map((item, idx) => {
        const isCritical = item.toUpperCase().includes('CRITICAL');
        return (
          <div key={idx} className={`flex items-start gap-2.5 mb-2 last:mb-0 text-[15px] ${isCritical ? 'text-rose-600 font-normal' : 'text-slate-600'}`}>
            <span className="flex-shrink-0 mt-0.5 text-[14px]">•</span>
            <span className="leading-relaxed font-light">{item}</span>
          </div>
        );
      })}
    </div>
  );
}

export function AlethiaInsightsBlock(props: {
  insights: AlethiaInsights | null;
  isDarkMode: boolean;
  subtitle?: string;
  loading?: boolean;
  emptyText?: string;
  filterSections?: AlethiaSectionKey[];
}) {
  const { insights, isDarkMode, subtitle = 'Portfolio Intelligence', loading = false, emptyText = 'Load loan data to generate Alethia insights.', filterSections } = props;

  const sectionsToShow = insights?.sections.filter((s) => !filterSections || filterSections.includes(s.title)) ?? [];

  return (
    <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'bg-slate-900/30 border-slate-700' : 'bg-white border-slate-200 shadow-sm'}`}>
      <div className={`px-5 py-4 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-700' : 'border-slate-100'}`}>
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
            <span className="text-white text-lg font-light">A</span>
          </div>
          <div className="min-w-0">
            <h3 className={`font-medium text-[13px] sm:text-[14px] uppercase tracking-widest ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>
              Cohi
            </h3>
            <p className={`text-[11px] sm:text-[12px] font-light truncate ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
              {subtitle}
            </p>
          </div>
        </div>
        <div className={`text-[10px] px-2.5 py-1 rounded-md font-medium ${isDarkMode ? 'bg-white/10 text-slate-300' : 'bg-slate-50 text-slate-600 border border-slate-200'}`}>
          {loading ? 'Analyzing…' : 'Insights'}
        </div>
      </div>

      <div className="p-5">
        {loading ? (
          <div className={`text-sm py-6 text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Loading Alethia insights…</div>
        ) : sectionsToShow.length === 0 ? (
          <div className={`text-sm py-6 text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{emptyText}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sectionsToShow.map((section) => (
              <AlethiaSectionCard key={section.title} section={section} isDarkMode={isDarkMode} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

