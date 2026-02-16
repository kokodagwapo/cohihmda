import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface LoanDetailsTableProps {
  tenantId: string | null;
}

interface Loan {
  loan_id: string;
  borrower_name: string | null;
  loan_amount: number | null;
  loan_type: string | null;
  status: string | null;
  current_loan_status: string | null;
  application_date: string | null;
  closing_date: string | null;
  funding_date: string | null;
  lock_date: string | null;
  branch: string | null;
  loan_officer: string | null;
  created_at: string;
}

export const LoanDetailsTable = ({ tenantId }: LoanDetailsTableProps) => {
  const { toast } = useToast();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(50);

  const loadLoans = async () => {
    if (!tenantId) {
      setLoans([]);
      setTotal(0);
      return;
    }

    setLoading(true);
    try {
      const offset = (page - 1) * limit;
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
        tenant_id: tenantId,
      });

      if (searchQuery) {
        // Note: Backend would need to support search, for now just filter client-side
      }

      const response = await api.request<{ loans: Loan[]; total: number }>(
        `/api/loans?${params.toString()}`,
      );

      setLoans(response.loans || []);
      setTotal(response.total || 0);
    } catch (error: any) {
      console.error("Error load  loans:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to load loans",
        variant: "destructive",
      });
      setLoans([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLoans();
  }, [tenantId, page]);

  // Filter loans client-side by search query
  const filteredLoans = searchQuery
    ? loans.filter(
        (loan) =>
          loan.loan_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          loan.borrower_name
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          loan.current_loan_status
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          loan.status?.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : loans;

  const totalPages = Math.ceil(total / limit);

  if (!tenantId) {
    return (
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
            Loan Details
          </CardTitle>
          <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
            Select a tenant to view loan records
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
              Loan Details
            </CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Explore loan records in the tenant database (
              {total.toLocaleString()} total)
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                type="text"
                placeholder="Search loans..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 w-64 font-light"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadLoans}
              disabled={loading}
              className="font-extralight"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && loans.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : filteredLoans.length === 0 ? (
          <div className="text-center py-8 text-slate-500 dark:text-slate-400">
            {searchQuery ? "No loans match your search" : "No loans found"}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="text-left p-2 font-light text-slate-600 dark:text-slate-400">
                      Loan ID
                    </th>
                    <th className="text-left p-2 font-light text-slate-600 dark:text-slate-400">
                      Borrower
                    </th>
                    <th className="text-right p-2 font-light text-slate-600 dark:text-slate-400">
                      Amount
                    </th>
                    <th className="text-left p-2 font-light text-slate-600 dark:text-slate-400">
                      Status
                    </th>
                    <th className="text-left p-2 font-light text-slate-600 dark:text-slate-400">
                      Current Status
                    </th>
                    <th className="text-left p-2 font-light text-slate-600 dark:text-slate-400">
                      App Date
                    </th>
                    <th className="text-left p-2 font-light text-slate-600 dark:text-slate-400">
                      Closing Date
                    </th>
                    <th className="text-left p-2 font-light text-slate-600 dark:text-slate-400">
                      Funding Date
                    </th>
                    <th className="text-left p-2 font-light text-slate-600 dark:text-slate-400">
                      Lock Date
                    </th>
                    <th className="text-left p-2 font-light text-slate-600 dark:text-slate-400">
                      Type
                    </th>
                    <th className="text-left p-2 font-light text-slate-600 dark:text-slate-400">
                      Branch
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLoans.map((loan) => (
                    <tr
                      key={loan.loan_id}
                      className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <td className="p-2 font-mono text-xs text-slate-900 dark:text-white">
                        {loan.loan_id || "-"}
                      </td>
                      <td className="p-2 text-slate-700 dark:text-slate-300">
                        {loan.borrower_name || "-"}
                      </td>
                      <td className="p-2 text-right text-slate-700 dark:text-slate-300">
                        {loan.loan_amount
                          ? new Intl.NumberFormat("en-US", {
                              style: "currency",
                              currency: "USD",
                              minimumFractionDigits: 0,
                            }).format(loan.loan_amount)
                          : "-"}
                      </td>
                      <td className="p-2 text-slate-700 dark:text-slate-300">
                        {loan.status || "-"}
                      </td>
                      <td className="p-2 text-slate-700 dark:text-slate-300">
                        {loan.current_loan_status || "-"}
                      </td>
                      <td className="p-2 text-slate-700 dark:text-slate-300">
                        {loan.application_date
                          ? new Date(loan.application_date).toLocaleDateString()
                          : "-"}
                      </td>
                      <td className="p-2 text-slate-700 dark:text-slate-300">
                        {loan.closing_date
                          ? new Date(loan.closing_date).toLocaleDateString()
                          : "-"}
                      </td>
                      <td className="p-2 text-slate-700 dark:text-slate-300">
                        {loan.funding_date
                          ? new Date(loan.funding_date).toLocaleDateString()
                          : "-"}
                      </td>
                      <td className="p-2 text-slate-700 dark:text-slate-300">
                        {loan.lock_date
                          ? new Date(loan.lock_date).toLocaleDateString()
                          : "-"}
                      </td>
                      <td className="p-2 text-slate-700 dark:text-slate-300">
                        {loan.loan_type || "-"}
                      </td>
                      <td className="p-2 text-slate-700 dark:text-slate-300">
                        {loan.branch || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-700">
                <div className="text-sm text-slate-600 dark:text-slate-400 font-light">
                  Showing {(page - 1) * limit + 1} to{" "}
                  {Math.min(page * limit, total)} of {total} loans
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1 || loading}
                    className="font-extralight"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <div className="text-sm text-slate-600 dark:text-slate-400 font-light px-2">
                    Page {page} of {totalPages}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages || loading}
                    className="font-extralight"
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
