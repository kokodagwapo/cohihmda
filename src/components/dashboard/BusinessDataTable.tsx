/**
 * Business Data Table Component
 * A compact table component for displaying business overview data in modals
 * 
 * @param headers - Array of column header strings
 * @param rows - Array of row data with label and values
 */
export const BusinessDataTable = ({
  headers,
  rows,
}: {
  headers: string[];
  rows: { label: string; values: string[] }[];
}) => (
  <div className="w-full overflow-x-auto overscroll-x-contain -webkit-overflow-scrolling-touch">
    <table className="w-full text-[8px] sm:text-[9px] md:text-xs table-fixed" style={{ minWidth: `${Math.max(280, 50 + headers.length * 55)}px` }}>
      <thead>
        <tr className="border-b border-slate-200 dark:border-slate-700">
          <th className="text-left py-1.5 sm:py-2 pr-1 sm:pr-2 font-medium text-slate-500 dark:text-slate-400 text-[7px] sm:text-[8px] md:text-[10px] w-[60px] sm:w-[80px] md:w-[100px]"></th>
          {headers.map((h, i) => (
            <th key={i} className="text-right py-1.5 sm:py-2 px-1 sm:px-1.5 md:px-2 font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap text-[7px] sm:text-[8px] md:text-[10px]">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className={`border-b border-slate-100 dark:border-slate-700/50 ${row.label === 'Total' ? 'bg-slate-100 dark:bg-slate-800/40 font-medium' : ''}`}>
            <td className="py-1.5 sm:py-2 pr-1 sm:pr-2 text-slate-700 dark:text-slate-300 whitespace-nowrap text-[8px] sm:text-[9px] md:text-xs font-medium">{row.label}</td>
            {row.values.map((v, j) => (
              <td key={j} className="text-right py-1.5 sm:py-2 px-1 sm:px-1.5 md:px-2 text-slate-600 dark:text-slate-400 tabular-nums text-[8px] sm:text-[9px] md:text-xs whitespace-nowrap">{v}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

