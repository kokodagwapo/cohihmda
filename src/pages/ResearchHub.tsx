import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock3 } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useDashboardVisibility } from "@/hooks/useDashboardVisibility";
import { useWorkbenchNav, type SidebarResearchSession } from "@/hooks/useWorkbenchNav";
import { useAuth } from "@/contexts/AuthContext";
import type { ReportData } from "@/data/reportSimulations";
import { Badge } from "@/components/ui/badge";

function formatDate(value?: string) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function SessionTable({
  title,
  rows,
  onOpen,
  className,
}: {
  title: string;
  rows: SidebarResearchSession[];
  onOpen: (id: string) => void;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200/70 dark:border-slate-700/70 bg-white/90 dark:bg-slate-900/70 overflow-hidden flex flex-col min-h-0 ${className ?? ""}`}>
      <div className="px-3 py-3 border-b border-slate-200/70 dark:border-slate-700/70">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      </div>
      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full min-w-[760px]">
          <thead className="sticky top-0 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-sm z-10">
            <tr className="text-left text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200/70 dark:border-slate-700/70">
              <th className="px-3 py-2.5 font-semibold">Session</th>
              <th className="px-3 py-2.5 font-semibold">Ownership</th>
              <th className="px-3 py-2.5 font-semibold">Phase</th>
              <th className="px-3 py-2.5 font-semibold">Last Edited</th>
              <th className="px-3 py-2.5 font-semibold text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-sm text-slate-500 dark:text-slate-400">
                  No sessions available.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800 last:border-b-0 hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="px-3 py-3">
                    <button
                      onClick={() => onOpen(row.id)}
                      className="text-sm font-medium text-slate-900 dark:text-slate-100 hover:text-emerald-600 dark:hover:text-emerald-400 truncate max-w-[340px] text-left"
                    >
                      {row.topic || "Untitled Session"}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant="secondary">{row.isOwner === false ? "Shared" : "Owned"}</Badge>
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-600 dark:text-slate-300 capitalize">{row.phase || "idle"}</td>
                  <td className="px-3 py-3 text-sm text-slate-600 dark:text-slate-300">{formatDate(row.updatedAt)}</td>
                  <td className="px-3 py-3 text-right">
                    <button
                      onClick={() => onOpen(row.id)}
                      className="px-2.5 h-8 rounded-md text-xs font-medium bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:opacity-90"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function ResearchHub() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { dashboardVisibility, handleVisibilityChange } = useDashboardVisibility();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { ownedSessions, sharedSessions } = useWorkbenchNav();
  const sortedOwned = useMemo(
    () => [...ownedSessions].sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()),
    [ownedSessions],
  );
  const sortedShared = useMemo(
    () => [...sharedSessions].sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()),
    [sharedSessions],
  );

  return (
    <DashboardLayout
      isAuthenticated={!!user}
      mobileMenuOpen={mobileMenuOpen}
      onMobileMenuToggle={() => setMobileMenuOpen((prev) => !prev)}
      dashboardVisibility={dashboardVisibility}
      onVisibilityChange={handleVisibilityChange}
      onReportClick={(_report: ReportData) => {}}
    >
      <div className="h-[calc(100vh-4rem)] bg-gradient-to-br from-slate-50/90 via-white to-sky-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/80 px-2 sm:px-3 py-3 sm:py-4 overflow-hidden">
        <div className="w-full h-full flex flex-col gap-3 min-h-0">
          <div className="flex items-center justify-between gap-3 shrink-0">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">
                Research Lab
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Track investigations with status and recency, then jump straight back into analysis.
              </p>
            </div>
            <button
              onClick={() => navigate("/research/session")}
              className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm font-medium hover:bg-emerald-500"
            >
              New Session
            </button>
          </div>

          <div className="grid grid-rows-[minmax(0,1fr)_minmax(180px,0.55fr)] gap-4 flex-1 min-h-0">
            <SessionTable
              title="My Sessions"
              rows={sortedOwned}
              onOpen={(id) => navigate(`/research/session?session=${encodeURIComponent(id)}`)}
            />
            <SessionTable
              title="Shared Sessions"
              rows={sortedShared}
              onOpen={(id) => navigate(`/research/session?session=${encodeURIComponent(id)}`)}
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 shrink-0">
            <Clock3 className="w-3.5 h-3.5" />
            Sorted by most recently edited.
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

