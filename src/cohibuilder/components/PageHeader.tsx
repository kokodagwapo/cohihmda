import React from 'react';

interface PageHeaderProps {
  badge?: string;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}

/**
 * Standardized page header matching Dashboard theme.
 * Use for all main views for consistency.
 */
export default function PageHeader({ badge, title, subtitle, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 sm:gap-4">
      <div className="relative z-10">
        {badge && (
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2.5 py-0.5 bg-slate-100/80 text-slate-600 text-xs font-medium rounded-full">
              {badge}
            </span>
          </div>
        )}
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">{title}</h1>
        <p className="text-sm font-medium text-slate-500 mt-1">{subtitle}</p>
      </div>
      {children && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto mt-0">
          {children}
        </div>
      )}
    </div>
  );
}
