import React from 'react';
import { DashboardCard } from './DashboardCard';

/**
 * Reusable DataTable Component with Sticky Columns
 * A flexible table component for displaying structured data with optional sticky columns
 * 
 * @param title - Table title
 * @param headers - Array of header definitions with key, label, and optional color
 * @param data - Array of row data with label, optional total, and columns
 * @param showTotal - Whether to show a totals column
 * @param stickyFirstColumn - Whether to make the first column sticky
 */
export const DataTable = ({
  title,
  headers,
  data,
  showTotal = false,
  stickyFirstColumn = true
}: {
  title: string;
  headers: Array<{
    key: string;
    label: string;
    color?: string;
  }>;
  data: Array<{
    label: string;
    total?: string;
    columns: Record<string, string | number>;
  }>;
  showTotal?: boolean;
  stickyFirstColumn?: boolean;
}) => {
  return (
    <DashboardCard>
      <div className="p-6">
        <h3 className="text-base font-extralight text-slate-900 dark:text-white mb-4 tracking-tight">{title}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={`text-left py-3 px-4 font-light text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 ${stickyFirstColumn ? 'sticky left-0 z-20 bg-white dark:bg-slate-800/50 shadow-[2px_0_4px_rgba(0,0,0,0.05)]' : ''}`}>
                  Metric
                </th>
                {showTotal && (
                  <th className="text-right py-3 px-4 font-light text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                    Totals
                  </th>
                )}
                {headers.map(header => (
                  <th key={header.key} className={`text-right py-3 px-4 font-light text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 ${header.color || 'bg-slate-50 dark:bg-slate-800/30'}`}>
                    {header.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => (
                <tr key={idx} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={`py-3 px-4 font-light text-slate-600 dark:text-slate-300 ${stickyFirstColumn ? 'sticky left-0 z-10 bg-white dark:bg-slate-800/50 shadow-[2px_0_4px_rgba(0,0,0,0.05)]' : ''}`}>
                    {row.label}
                  </td>
                  {showTotal && (
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-white font-light">
                      {row.total}
                    </td>
                  )}
                  {headers.map(header => {
                    const colorMap: Record<string, string> = {
                      'bg-rose-500': 'bg-rose-50/50 dark:bg-rose-950/20',
                      'bg-emerald-500': 'bg-emerald-50/50 dark:bg-emerald-950/20',
                      'bg-sky-500': 'bg-sky-50/50 dark:bg-sky-950/20',
                      'bg-green-500': 'bg-green-50/50 dark:bg-green-950/20'
                    };
                    return (
                      <td key={header.key} className={`py-3 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-white font-light ${colorMap[header.color || ''] || ''}`}>
                        {row.columns[header.key]}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardCard>
  );
};

