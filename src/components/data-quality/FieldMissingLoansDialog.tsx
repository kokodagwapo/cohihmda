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
import {
  Loader2,
  Download,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
export interface FieldRef {
  column: string;
  name: string;
  missingCount: number;
  applicableLoanCount: number;
}

const LOANS_PER_PAGE = 100;

const PERSONNEL_FIELDS = new Set([
  "loan_officer",
  "processor",
  "underwriter",
  "closer",
  "branch",
  "account_executive",
]);

interface FieldMissingLoansDialogProps {
  open: boolean;
  onClose: () => void;
  field: FieldRef | null;
  tenantId: string | null;
}

interface SortState {
  column: string;
  dir: "asc" | "desc";
}

function formatCell(fieldKey: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (
      fieldKey.includes("rate") ||
      fieldKey.includes("ltv") ||
      fieldKey.includes("dti") ||
      fieldKey.includes("cltv")
    )
      return `${value.toFixed(2)}%`;
    if (fieldKey.includes("amount")) return `$${value.toLocaleString()}`;
    return value.toLocaleString();
  }
  return String(value);
}

function columnLabel(col: string): string {
  return col
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function FieldMissingLoansDialog({
  open,
  onClose,
  field,
  tenantId,
}: FieldMissingLoansDialogProps) {

  const { toast } = useToast();
  const [loans, setLoans] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [highlightField, setHighlightField] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);
  const [sort, setSort] = useState<SortState>({
    column: "application_date",
    dir: "desc",
  });

  const load = useCallback(
    async (
      targetField: CrucialFieldStatus,
      searchVal: string,
      pageNum: number,
      sortState: SortState
    ) => {
      setLoading(true);
      if (pageNum === 0) setLoans([]);
      try {
        const params = new URLSearchParams({
          field: targetField.column,
          tenant_id: tenantId ?? "",
          limit: String(LOANS_PER_PAGE),
          offset: String(pageNum * LOANS_PER_PAGE),
          sort: sortState.column,
          sortDir: sortState.dir,
          ...(searchVal ? { search: searchVal } : {}),
        });

        const response = await api.request<{
          success: boolean;
          fieldName: string;
          fieldColumn: string;
          totalCount: number;
          filteredCount: number;
          fields: string[];
          highlightField: string;
          loans: Record<string, unknown>[];
        }>(`/api/data-quality/field-missing-loans?${params}`);

        if (response.success) {
          setLoans(response.loans ?? []);
          setColumns(response.fields ?? []);
          setHighlightField(response.highlightField ?? targetField.column);
          setTotalCount(response.totalCount ?? 0);
          setFilteredCount(response.filteredCount ?? response.totalCount ?? 0);
          setPage(pageNum);
        }
      } catch {
        toast({
          title: "Error",
          description: "Failed to load loan details",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    },
    [tenantId, toast]
  );

  useEffect(() => {
    if (open && field) {
      setSearch("");
      setSort({ column: "application_date", dir: "desc" });
      load(field, "", 0, { column: "application_date", dir: "desc" });
    }
  }, [open, field]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = useCallback(
    (value: string) => {
      setSearch(value);
      if (!field) return;
      const id = setTimeout(() => load(field, value, 0, sort), 300);
      return () => clearTimeout(id);
    },
    [field, sort, load]
  );

  const handleSort = (col: string) => {
    if (!field) return;
    const next: SortState =
      sort.column === col
        ? { column: col, dir: sort.dir === "asc" ? "desc" : "asc" }
        : { column: col, dir: "asc" };
    setSort(next);
    load(field, search, 0, next);
  };

  const handleExport = async () => {
    if (!field) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        field: field.column,
        tenant_id: tenantId ?? "",
        limit: "10000",
        offset: "0",
        sort: sort.column,
        sortDir: sort.dir,
        ...(search ? { search } : {}),
      });
      const response = await api.request<{
        success: boolean;
        fields: string[];
        loans: Record<string, unknown>[];
      }>(`/api/data-quality/field-missing-loans?${params}`);

      if (!response.success || !response.loans.length) return;

      const cols = response.fields;
      const headers = cols.map(columnLabel).join(",");
      const rows = response.loans
        .map((loan) =>
          cols
            .map((c) => {
              const val = loan[c];
              if (val === null || val === undefined) return "";
              const s = String(val);
              return s.includes(",") || s.includes('"')
                ? `"${s.replace(/"/g, '""')}"`
                : s;
            })
            .join(",")
        )
        .join("\n");

      const csv = `${headers}\n${rows}`;
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `missing-${field.column}-loans.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({
        title: "Exported",
        description: `Exported ${response.loans.length.toLocaleString()} loans to CSV`,
      });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const totalPages = Math.ceil(filteredCount / LOANS_PER_PAGE);

  const SortIcon = ({ col }: { col: string }) => {
    if (sort.column !== col)
      return <ArrowUpDown className="h-3 w-3 ml-1 text-slate-400 inline" />;
    return sort.dir === "asc" ? (
      <ArrowUp className="h-3 w-3 ml-1 text-blue-500 inline" />
    ) : (
      <ArrowDown className="h-3 w-3 ml-1 text-blue-500 inline" />
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
          setSearch("");
          setLoans([]);
        }
      }}
    >
      <DialogContent className="max-w-[95vw] w-[95vw] h-[85vh] p-0 gap-0 flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 p-4 pb-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <span>Loans missing</span>
              <Badge
                variant="outline"
                className="font-mono text-xs text-rose-600 border-rose-300"
              >
                {field?.column}
              </Badge>
              <span className="text-base font-normal text-slate-500">
                {field?.name}
              </span>
            </DialogTitle>
            <DialogDescription>
              {field?.applicableLoanCount
                ? `${field.missingCount.toLocaleString()} of ${field.applicableLoanCount.toLocaleString()} applicable loans are missing this field`
                : "Loans where this field is NULL or blank"}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Toolbar */}
        <div className="flex-shrink-0 px-4 py-3 border-b flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search loan #, officer, branch..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-64 h-8 text-sm"
            />
            {loading && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-500">
            <span>
              <strong className="text-slate-800 dark:text-slate-200">
                {totalCount.toLocaleString()}
              </strong>{" "}
              total missing
            </span>
            {search && (
              <span>
                <strong>{filteredCount.toLocaleString()}</strong> matching
              </span>
            )}
            {loans.length > 0 && (
              <span>
                {(page * LOANS_PER_PAGE + 1).toLocaleString()}–
                {Math.min(
                  (page + 1) * LOANS_PER_PAGE,
                  filteredCount
                ).toLocaleString()}{" "}
                shown
              </span>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-hidden px-4 py-2">
          {loading && loans.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              <span className="ml-3 text-slate-500">Loading loans...</span>
            </div>
          ) : loans.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
              <span className="text-4xl">✓</span>
              <span className="text-sm">
                {search
                  ? "No loans match your search"
                  : "No loans missing this field"}
              </span>
            </div>
          ) : (
            <div className="border rounded-lg h-full overflow-auto">
              <table
                className="w-full border-collapse text-xs"
                style={{ minWidth: `${columns.length * 130}px` }}
              >
                <thead className="sticky top-0 z-10">
                  <tr>
                    {columns.map((col) => {
                      const isHighlight = col === highlightField;
                      const isPersonnel = PERSONNEL_FIELDS.has(col);
                      const isDate = col.includes("date");
                      const isSortable =
                        !col.includes("id") || col === "loan_id";
                      return (
                        <th
                          key={col}
                          className={`px-3 py-2 text-left font-semibold whitespace-nowrap border-b border-r last:border-r-0 select-none ${
                            isHighlight
                              ? "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300"
                              : isPersonnel
                              ? "bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300"
                              : isDate
                              ? "bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                          } ${isSortable ? "cursor-pointer hover:brightness-95" : ""}`}
                          onClick={isSortable ? () => handleSort(col) : undefined}
                        >
                          {columnLabel(col)}
                          {isSortable && <SortIcon col={col} />}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {loans.map((loan, idx) => (
                    <tr
                      key={(loan.loan_id as string) || idx}
                      className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      {columns.map((col) => {
                        const isHighlight = col === highlightField;
                        const value = loan[col];
                        const isEmpty =
                          value === null ||
                          value === undefined ||
                          String(value).trim() === "";
                        return (
                          <td
                            key={col}
                            className={`px-3 py-1.5 border-r last:border-r-0 whitespace-nowrap ${
                              isHighlight
                                ? "bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 font-semibold"
                                : ""
                            }`}
                          >
                            {isEmpty ? (
                              <span className="text-slate-300 dark:text-slate-600 italic">
                                —
                              </span>
                            ) : col.includes("date") ? (
                              <span className="font-mono">{String(value)}</span>
                            ) : col === "loan_number" || col === "loan_id" ? (
                              <span className="font-mono text-slate-700 dark:text-slate-300">
                                {String(value)}
                              </span>
                            ) : PERSONNEL_FIELDS.has(col) ? (
                              <span
                                className="block max-w-[160px] truncate"
                                title={String(value)}
                              >
                                {String(value)}
                              </span>
                            ) : col.includes("amount") ? (
                              <span className="font-mono">
                                ${Number(value).toLocaleString()}
                              </span>
                            ) : (
                              <span>{formatCell(col, value)}</span>
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

        {/* Pagination */}
        {filteredCount > LOANS_PER_PAGE && (
          <div className="flex-shrink-0 px-4 py-2 border-t flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => field && load(field, search, page - 1, sort)}
              disabled={page === 0 || loading}
            >
              Previous
            </Button>
            <span className="text-sm text-slate-500 px-2">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => field && load(field, search, page + 1, sort)}
              disabled={(page + 1) * LOANS_PER_PAGE >= filteredCount || loading}
            >
              Next
            </Button>
          </div>
        )}

        {/* Footer */}
        <div className="flex-shrink-0 px-4 py-3 border-t flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={!loans.length || loading}
          >
            <Download className="h-4 w-4 mr-2" />
            Export All to CSV
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
