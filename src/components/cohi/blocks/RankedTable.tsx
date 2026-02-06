import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { RankedTableProps } from '@/types/cohiResponsePlan';
import { cn } from '@/lib/utils';

function formatCell(value: unknown, format?: string): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    switch (format) {
      case 'currency':
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
      case 'percent':
        return `${value.toFixed(1)}%`;
      default:
        return new Intl.NumberFormat('en-US').format(value);
    }
  }
  return String(value);
}

function getHighlightClass(
  columnKey: string,
  row: Record<string, unknown>,
  rules?: { columnKey: string; condition: string; className?: string }[]
): string | undefined {
  if (!rules?.length) return undefined;
  for (const r of rules) {
    if (r.columnKey !== columnKey) continue;
    const v = row[columnKey] as number | undefined;
    if (r.condition === 'top' && r.className) return r.className;
    if (r.condition === 'bottom' && r.className) return r.className;
  }
  return undefined;
}

export function RankedTable({ props }: { props: RankedTableProps }) {
  const { columns, rows, highlightRules } = props;
  if (!columns?.length || !rows?.length) return null;
  return (
    <div className="rounded-md border border-border/50 overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border/50 bg-muted/30">
              {columns.map((col) => (
                <TableHead key={col.key} className="font-medium text-muted-foreground text-xs py-1.5 px-2">
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={i} className="border-border/40">
                {columns.map((col) => (
                  <TableCell
                    key={col.key}
                    className={cn('text-xs py-1.5 px-2', getHighlightClass(col.key, row, highlightRules))}
                  >
                    {formatCell(row[col.key], col.format)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
