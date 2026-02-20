/**
 * Modal that shows a loan detail table for a workflow segment filter:
 * Initial (all with from milestone), Fallout (from but not to), Pull-Through (both).
 */

import React, { useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, Download, ChevronDown } from "lucide-react";
import {
  useWorkflowConversionSegmentLoans,
  type WorkflowSegmentLoanRow,
  type WorkflowSegmentLoanFilter,
} from "@/hooks/useWorkflowConversionSegmentLoans";

const BASE_COLUMNS: { key: keyof WorkflowSegmentLoanRow; label: string }[] = [
  { key: "loan_number", label: "Loan number" },
  { key: "loan_amount", label: "Volume" },
  { key: "fico_score", label: "FICO" },
  { key: "ltv_ratio", label: "LTV" },
  { key: "be_dti_ratio", label: "BE DTI" },
  { key: "branch", label: "Branch" },
  { key: "loan_officer", label: "Loan Officer" },
  { key: "loan_type", label: "Loan Type" },
  { key: "loan_purpose", label: "Loan Purpose" },
  { key: "occupancy_type", label: "Occupancy Type" },
  { key: "channel", label: "Channel" },
  { key: "current_loan_status", label: "Current Loan Status" },
];

function getColumns(fromLabel: string, toLabel: string): { key: keyof WorkflowSegmentLoanRow; label: string }[] {
  return [
    ...BASE_COLUMNS,
    { key: "from_date", label: `${fromLabel} Date` },
    { key: "to_date", label: `${toLabel} Date` },
  ];
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (typeof value === "string") return value.trim() || "—";
  return String(value);
}

function formatVolume(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getCellValueForExport(row: WorkflowSegmentLoanRow, colKey: keyof WorkflowSegmentLoanRow): string {
  if (colKey === "loan_amount") return formatVolume(row.loan_amount);
  return formatCell(row[colKey]);
}

function escapeCsv(value: string): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toSafeFileName(s: string): string {
  return s.replace(/[\s\\/*?:\[\]]/g, "_").slice(0, 50) || "export";
}

export interface WorkflowSegmentLoansModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filter: WorkflowSegmentLoanFilter | null;
  fromLabel: string;
  toLabel: string;
  startDate: string;
  endDate: string;
  segments: { from: string; to: string }[];
  grouping: "workflow" | "individual";
  segmentIndex: number;
  selectedTenantId?: string | null;
  channelGroup?: string | null;
}

export function WorkflowSegmentLoansModal({
  open,
  onOpenChange,
  filter,
  fromLabel,
  toLabel,
  startDate,
  endDate,
  segments,
  grouping,
  segmentIndex,
  selectedTenantId,
  channelGroup,
}: WorkflowSegmentLoansModalProps) {
  const { loans, loading, error } = useWorkflowConversionSegmentLoans({
    startDate,
    endDate,
    segments,
    grouping,
    segmentIndex,
    filter: open && filter ? filter : null,
    selectedTenantId,
    channelGroup,
  });

  const title =
    filter === "initial"
      ? `Initial – ${fromLabel} → ${toLabel}`
      : filter === "fallout"
        ? `Fallout – ${fromLabel} → ${toLabel}`
        : filter === "pull-through"
          ? `Pull-Through – ${fromLabel} → ${toLabel}`
          : "Loans";

  const columns = getColumns(fromLabel, toLabel);
  const loanCount = loans.length;
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileBase = `workflow-${filter ?? "loans"}-${toSafeFileName(fromLabel)}-${toSafeFileName(toLabel)}-${dateStr}`;

  const exportCsv = useCallback(() => {
    const headerRow = columns.map((col) => escapeCsv(col.label));
    const dataRows = loans.map((row) =>
      columns.map((col) => escapeCsv(getCellValueForExport(row, col.key)))
    );
    const csv = [headerRow, ...dataRows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${fileBase}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [columns, loans, fileBase]);

  const exportExcel = useCallback(async () => {
    const XLSX = await import("xlsx");
    const headerRow = columns.map((col) => col.label);
    const dataRows = loans.map((row) =>
      columns.map((col) => getCellValueForExport(row, col.key))
    );
    const aoa = [headerRow, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Loans");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${fileBase}.xlsx`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [columns, loans, fileBase]);

  const modalBgClass =
    filter === "fallout"
      ? "bg-red-50/95 dark:bg-red-950/40"
      : filter === "pull-through"
        ? "bg-emerald-50/95 dark:bg-emerald-950/40"
        : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-w-[95vw] w-full max-h-[85vh] flex flex-col gap-4 ${modalBgClass}`}>
        <DialogHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <DialogTitle className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                {title}
              </DialogTitle>
              {!loading && !error && (
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                  {loanCount === 0 ? "No loans" : `${loanCount.toLocaleString()} loan${loanCount === 1 ? "" : "s"}`}
                </p>
              )}
            </div>
            {!loading && !error && loans.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
                    <Download className="h-4 w-4" />
                    Download
                    <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={exportExcel}>
                    Excel (.xlsx)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={exportCsv}>
                    CSV (.csv)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </DialogHeader>
        <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : error ? (
            <div className="px-4 py-6 text-sm text-amber-700 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-950/30 rounded-lg">
              {error}
            </div>
          ) : (
            <div className="overflow-auto flex-1 bg-white dark:bg-slate-900">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2 whitespace-nowrap"
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loans.length === 0 ? (
                    <tr>
                      <td
                        colSpan={columns.length}
                        className="px-3 py-6 text-center text-slate-500 dark:text-slate-400"
                      >
                        No loans found
                      </td>
                    </tr>
                  ) : (
                    loans.map((row) => (
                      <tr
                        key={row.loan_id}
                        className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                      >
                        {columns.map((col) => (
                          <td
                            key={col.key}
                            className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap"
                          >
                            {col.key === "loan_amount"
                              ? formatVolume(row.loan_amount)
                              : formatCell(
                                  row[col.key as keyof WorkflowSegmentLoanRow]
                                )}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
