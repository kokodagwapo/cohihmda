import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { SEVERITY_COLORS, type DataQualityWarning } from "./types";

const LOANS_PER_PAGE = 100;

interface WarningLoansDialogProps {
  open: boolean;
  onClose: () => void;
  warning: DataQualityWarning | null;
  tenantId: string | null;
}

export function WarningLoansDialog({
  open,
  onClose,
  warning,
  tenantId,
}: WarningLoansDialogProps) {
  const { toast } = useToast();
  const [loans, setLoans] = useState<Record<string, unknown>[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [filtered, setFiltered] = useState(0);

  const loadLoans = useCallback(
    async (targetWarning: DataQualityWarning, searchVal: string, pageNum: number) => {
      setLoading(true);
      if (pageNum === 0) {
        setLoans([]);
        setPage(0);
      }
      try {
        const searchParam = searchVal ? `&search=${encodeURIComponent(searchVal)}` : "";
        const response = await api.request<{
          success: boolean;
          loans: Record<string, unknown>[];
          totalCount: number;
          filteredCount: number;
          fields: string[];
        }>(
          `/api/data-quality/warning-loans/${targetWarning.id}?tenant_id=${tenantId}&limit=${LOANS_PER_PAGE}&offset=${pageNum * LOANS_PER_PAGE}${searchParam}`
        );
        if (response.success) {
          setLoans(response.loans || []);
          setTotal(response.totalCount || 0);
          setFiltered(response.filteredCount || response.totalCount || 0);
          setFields(response.fields || []);
          setPage(pageNum);
        }
      } catch {
        toast({ title: "Error", description: "Failed to load loan details", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    },
    [tenantId, toast]
  );

  // Trigger data load whenever the dialog opens or the warning changes.
  // We use useEffect here because Radix UI's controlled Dialog does NOT call
  // onOpenChange when `open` is set programmatically from a parent component —
  // it only fires for user-initiated close events (Escape, backdrop click).
  useEffect(() => {
    if (open && warning) {
      setSearch("");
      setPage(0);
      setLoans([]);
      loadLoans(warning, "", 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, warning?.id]);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onClose();
      setSearch("");
      setPage(0);
      setLoans([]);
    }
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    if (warning) {
      const timeoutId = setTimeout(() => {
        loadLoans(warning, value, 0);
      }, 300);
      return () => clearTimeout(timeoutId);
    }
  };

  const handleExport = () => {
    if (!loans.length || !fields.length) return;
    const headers = fields.join(",");
    const rows = loans
      .map((loan) =>
        fields
          .map((f) => {
            const val = loan[f];
            if (val === null || val === undefined) return "";
            if (typeof val === "string" && val.includes(",")) return `"${val}"`;
            return val;
          })
          .join(",")
      )
      .join("\n");
    const csv = `${headers}\n${rows}`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${warning?.id || "warning"}-loans.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exported", description: `Exported ${loans.length} loans to CSV` });
  };

  const PERSONNEL_FIELDS = new Set([
    "loan_officer", "processor", "underwriter", "closer", "branch", "account_executive",
  ]);

  const formatCell = (field: string, value: unknown): string => {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") {
      if (field.includes("rate") || field.includes("ltv") || field.includes("dti") || field.includes("cltv"))
        return `${value.toFixed(2)}%`;
      if (field.includes("amount")) return `$${value.toLocaleString()}`;
      return value.toLocaleString();
    }
    return String(value);
  };

  const totalPages = Math.ceil(filtered / LOANS_PER_PAGE);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[85vh] p-0 gap-0 flex flex-col">
        <div className="flex-shrink-0 p-4 pb-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {warning && (
                <>
                  <Badge className={SEVERITY_COLORS[warning.severity]}>{warning.severity}</Badge>
                  {warning.name}
                </>
              )}
            </DialogTitle>
            <DialogDescription>{warning?.description}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex-shrink-0 px-4 py-3 border-b flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search by loan #, officer, processor, branch..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-64"
            />
            {loading && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
            <span><strong>{total.toLocaleString()}</strong> total affected</span>
            {search && <span><strong>{filtered.toLocaleString()}</strong> matching search</span>}
            {loans.length > 0 && (
              <span>
                Showing {page * LOANS_PER_PAGE + 1}–{Math.min((page + 1) * LOANS_PER_PAGE, filtered)}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden px-4 py-2">
          {loading && loans.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              <span className="ml-3 text-slate-500">Loading loan details...</span>
            </div>
          ) : loans.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-500">
              {search ? "No loans match your search" : "No loans found for this warning"}
            </div>
          ) : (
            <div className="border rounded-lg h-full overflow-auto">
              <table className="w-full border-collapse" style={{ minWidth: "2000px" }}>
                <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800">
                  <tr>
                    {fields.map((field) => {
                      const isHighlight = field === warning?.field;
                      const isDate = field.includes("date");
                      const isPersonnel = PERSONNEL_FIELDS.has(field);
                      return (
                        <th
                          key={field}
                          className={`px-3 py-2 text-left text-xs font-semibold whitespace-nowrap border-b ${
                            isHighlight
                              ? "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300"
                              : isPersonnel
                              ? "bg-blue-50 dark:bg-blue-900/20"
                              : isDate
                              ? "bg-amber-50 dark:bg-amber-900/20"
                              : "bg-slate-100 dark:bg-slate-800"
                          }`}
                        >
                          {field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {loans.map((loan, idx) => (
                    <tr
                      key={(loan.loan_id as string) || idx}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800"
                    >
                      {fields.map((field) => {
                        const isHighlight = field === warning?.field;
                        const value = loan[field];
                        const isEmpty = value === null || value === undefined;
                        return (
                          <td
                            key={field}
                            className={`px-3 py-2 text-xs ${
                              isHighlight
                                ? "font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20"
                                : ""
                            }`}
                          >
                            {isEmpty ? (
                              <span className="text-slate-400 italic">—</span>
                            ) : field.includes("date") ? (
                              <span className="font-mono whitespace-nowrap">{String(value)}</span>
                            ) : field === "loan_number" || field === "loan_id" ? (
                              <span className="font-mono">{String(value)}</span>
                            ) : PERSONNEL_FIELDS.has(field) ? (
                              <span className="max-w-[150px] truncate block" title={String(value)}>
                                {String(value)}
                              </span>
                            ) : (
                              <span className="font-mono whitespace-nowrap">
                                {formatCell(field, value)}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {filtered > LOANS_PER_PAGE && (
          <div className="flex-shrink-0 px-4 py-2 border-t flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => warning && loadLoans(warning, search, page - 1)}
              disabled={page === 0 || loading}
            >
              Previous
            </Button>
            <span className="text-sm text-slate-600 dark:text-slate-400 px-3">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => warning && loadLoans(warning, search, page + 1)}
              disabled={(page + 1) * LOANS_PER_PAGE >= filtered || loading}
            >
              Next
            </Button>
          </div>
        )}

        <div className="flex-shrink-0 px-4 py-3 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={handleExport} disabled={!loans.length}>
            <Download className="h-4 w-4 mr-2" />
            Export Page to CSV
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
