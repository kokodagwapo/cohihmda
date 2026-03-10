import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock3, LayoutDashboard, Pin, PinOff, Users } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useDashboardVisibility } from "@/hooks/useDashboardVisibility";
import { useWorkbenchNav, type SidebarCanvas } from "@/hooks/useWorkbenchNav";
import { useAuth } from "@/contexts/AuthContext";
import type { ReportData } from "@/data/reportSimulations";
import { Badge } from "@/components/ui/badge";

function formatDate(value?: string) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function visibilityBadge(visibility?: SidebarCanvas["visibility"]) {
  if (visibility === "global") return "Global";
  if (visibility === "shared") return "Shared";
  return "Private";
}

function CanvasTable({
  title,
  icon,
  rows,
  onOpen,
  onToggleFavorite,
  favoriteUpdatingIds,
  showOwner,
  className,
  separateFavorites = true,
}: {
  title: string;
  icon: React.ReactNode;
  rows: SidebarCanvas[];
  onOpen: (id: string) => void;
  onToggleFavorite: (row: SidebarCanvas) => void;
  favoriteUpdatingIds: Set<string>;
  showOwner: boolean;
  className?: string;
  separateFavorites?: boolean;
}) {
  const favoriteRows = separateFavorites ? rows.filter((r) => !!r.favorited) : [];
  const nonFavoriteRows = separateFavorites ? rows.filter((r) => !r.favorited) : rows;
  const orderedRows = separateFavorites ? [...favoriteRows, ...nonFavoriteRows] : rows;
  const showFavoritesDivider = separateFavorites && favoriteRows.length > 0 && nonFavoriteRows.length > 0;
  const colSpan = showOwner ? 5 : 4;

  return (
    <section className={`rounded-2xl border border-slate-200/70 dark:border-slate-700/70 bg-white/90 dark:bg-slate-900/70 overflow-hidden flex flex-col min-h-0 h-full ${className ?? ""}`}>
      <div className="px-3 py-3 border-b border-slate-200/70 dark:border-slate-700/70 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{rows.length}</span>
      </div>
      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full min-w-[780px]">
          <thead className="sticky top-0 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-sm z-10">
            <tr className="text-left text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200/70 dark:border-slate-700/70">
              <th className="px-3 py-2.5 font-semibold">Canvas</th>
              {showOwner ? <th className="px-3 py-2.5 font-semibold">Owner</th> : null}
              <th className="px-3 py-2.5 font-semibold">Visibility</th>
              <th className="px-3 py-2.5 font-semibold">Last Edited</th>
              <th className="px-3 py-2.5 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orderedRows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-3 py-6 text-sm text-slate-500 dark:text-slate-400">
                  No items found in this section.
                </td>
              </tr>
            ) : (
              orderedRows.map((row, index) => {
                const insertFavoritesHeader = showFavoritesDivider && index === 0;
                const insertDivider = showFavoritesDivider && index === favoriteRows.length;
                return (
                  <Fragment key={row.id}>
                    {insertFavoritesHeader ? (
                      <tr className="bg-amber-50/30 dark:bg-amber-500/5">
                        <td colSpan={colSpan} className="px-3 py-2 border-b border-amber-200/50 dark:border-amber-400/20">
                          <span className="text-[11px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-300">
                            Favorites
                          </span>
                        </td>
                      </tr>
                    ) : null}
                    {insertDivider ? (
                      <tr aria-hidden="true">
                        <td colSpan={colSpan} className="p-0">
                          <div className="px-3 py-2.5">
                            <div className="h-px bg-gradient-to-r from-transparent via-amber-300/80 to-transparent dark:via-amber-300/60" />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    <tr className="border-b border-slate-100 dark:border-slate-800 last:border-b-0 hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-3">
                        <button
                          onClick={() => onOpen(row.id)}
                          className="text-sm font-medium text-slate-900 dark:text-slate-100 hover:text-emerald-600 dark:hover:text-emerald-400 truncate max-w-[320px] text-left"
                        >
                          {row.title}
                        </button>
                      </td>
                      {showOwner ? (
                        <td className="px-3 py-3 text-sm text-slate-600 dark:text-slate-300">
                          {row.owner_name || row.owner_email || "—"}
                        </td>
                      ) : null}
                      <td className="px-3 py-3">
                        <Badge variant="secondary" className="text-xs font-medium">
                          {visibilityBadge(row.visibility)}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-600 dark:text-slate-300">{formatDate(row.updated_at)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => onToggleFavorite(row)}
                            disabled={favoriteUpdatingIds.has(row.id)}
                            className="h-8 w-8 rounded-md inline-flex items-center justify-center text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-700/60 disabled:opacity-50"
                            title={row.favorited ? "Unpin from favorites" : "Pin to favorites"}
                          >
                            {row.favorited ? <PinOff className="w-4 h-4 text-amber-500" /> : <Pin className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => onOpen(row.id)}
                            className="px-2.5 h-8 rounded-md text-xs font-medium bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:opacity-90"
                          >
                            Open
                          </button>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function WorkbenchHub() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { dashboardVisibility, handleVisibilityChange } = useDashboardVisibility();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { ownedCanvases, sharedCanvases, favoriteUpdatingIds, toggleCanvasFavorite } = useWorkbenchNav();
  const sortedOwned = useMemo(
    () => [...ownedCanvases].sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()),
    [ownedCanvases],
  );
  const sortedShared = useMemo(
    () => [...sharedCanvases].sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()),
    [sharedCanvases],
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
        <div className="w-full h-full grid grid-rows-[auto_minmax(0,2fr)_minmax(0,1fr)_auto] gap-3 min-h-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">
                Workbench
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Manage and launch canvases with ownership, favorite status, visibility, and edit recency.
              </p>
            </div>
            <button
              onClick={() => navigate("/my-dashboard/new")}
              className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm font-medium hover:bg-emerald-500"
            >
              New Canvas
            </button>
          </div>

          <CanvasTable
            title="My Canvases"
            icon={<LayoutDashboard className="w-4 h-4 text-slate-600 dark:text-slate-300" />}
            rows={sortedOwned}
            onOpen={(id) => navigate(`/my-dashboard/${id}`)}
            onToggleFavorite={(row) => void toggleCanvasFavorite(row.id, !row.favorited)}
            favoriteUpdatingIds={favoriteUpdatingIds}
            showOwner={false}
          />

          <CanvasTable
            title="Shared With Me"
            icon={<Users className="w-4 h-4 text-slate-600 dark:text-slate-300" />}
            rows={sortedShared}
            onOpen={(id) => navigate(`/my-dashboard/${id}`)}
            onToggleFavorite={(row) => void toggleCanvasFavorite(row.id, !row.favorited)}
            favoriteUpdatingIds={favoriteUpdatingIds}
            showOwner
          />

          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Clock3 className="w-3.5 h-3.5" />
            Sorted by most recently edited.
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

