/**
 * DataExplorer Page
 *
 * Standalone page for uploading, previewing, and managing CSV datasets.
 * Users can upload files, explore column schemas, view quick visualizations,
 * and launch full Research Lab analysis from an uploaded dataset.
 *
 * Route: /research/data-explorer
 */

import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantStore } from "@/stores/tenantStore";
import { useResearchUploads } from "@/hooks/useResearchUploads";
import type { ResearchUpload } from "@/hooks/useResearchUploads";
import { UploadDropZone } from "@/components/research/UploadDropZone";
import { UploadPreviewTable } from "@/components/research/UploadPreviewTable";
import { ColumnSchemaEditor } from "@/components/research/ColumnSchemaEditor";
import { QuickInsightsGrid } from "@/components/research/QuickInsightsGrid";
import { DatasetAttachmentBadge } from "@/components/research/DatasetAttachmentBadge";
import { api } from "@/lib/api";
import {
  Database,
  Trash2,
  FlaskConical,
  Zap,
  FileText,
  AlertTriangle,
  ChevronRight,
  Clock,
  Rows,
  Columns,
  HardDrive,
  RefreshCw,
  Plus,
  Search,
  SlidersHorizontal,
  Table2,
  BarChart2,
  X,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// Helpers
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ============================================================================
// Upload sidebar item
// ============================================================================

function UploadListItem({
  upload,
  isActive,
  onClick,
  onDelete,
}: {
  upload: ResearchUpload;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 border",
        isActive
          ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800"
          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-800 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/10"
      )}
      onClick={onClick}
    >
      <div className={cn(
        "p-1.5 rounded-lg flex-shrink-0",
        isActive ? "bg-emerald-100 dark:bg-emerald-900/40" : "bg-slate-100 dark:bg-slate-800"
      )}>
        <FileText className={cn("w-3.5 h-3.5", isActive ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400")} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{upload.originalFileName}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          {upload.rowCount.toLocaleString()} rows · {formatBytes(upload.fileSizeBytes)}
        </p>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete dataset"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {isActive && <ChevronRight className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
    </div>
  );
}

// ============================================================================
// Stats bar
// ============================================================================

function StatsBar({ upload }: { upload: ResearchUpload }) {
  const stats = [
    { icon: Rows, label: "Rows", value: upload.rowCount.toLocaleString() },
    { icon: Columns, label: "Columns", value: String(upload.columnCount) },
    { icon: HardDrive, label: "Size", value: formatBytes(upload.fileSizeBytes) },
    {
      icon: Database,
      label: "Storage",
      value: upload.storageStrategy === "table" ? "SQL Table" : "Context",
      badge: true,
    },
  ];

  return (
    <div className="flex flex-wrap gap-3">
      {stats.map(({ icon: Icon, label, value, badge }) => (
        <div key={label} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
          <Icon className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-500 dark:text-slate-400">{label}:</span>
          <span className={cn(
            "text-xs font-semibold",
            badge
              ? upload.storageStrategy === "table"
                ? "text-blue-600 dark:text-blue-400"
                : "text-violet-600 dark:text-violet-400"
              : "text-slate-700 dark:text-slate-200"
          )}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

type ActiveTab = "preview" | "schema" | "insights";

export default function DataExplorer() {
  const { user } = useAuth();
  const { selectedTenant } = useTenantStore();
  const tenantId = selectedTenant?.id || user?.tenantId;
  const navigate = useNavigate();

  const {
    uploads,
    activeUpload,
    setActiveUpload,
    isLoading,
    isUploading,
    uploadProgress,
    error,
    setError,
    listUploads,
    uploadFile,
    updateColumns,
    deleteUpload,
  } = useResearchUploads(tenantId);

  const [activeTab, setActiveTab] = useState<ActiveTab>("preview");
  const [showUploadZone, setShowUploadZone] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [launchSuccess, setLaunchSuccess] = useState(false);

  useEffect(() => {
    listUploads();
  }, [listUploads]);

  // Auto-open upload zone if no uploads
  useEffect(() => {
    if (!isLoading && uploads.length === 0) {
      setShowUploadZone(true);
    }
  }, [isLoading, uploads.length]);

  const filteredUploads = uploads.filter((u) =>
    u.originalFileName.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const handleFileSelected = useCallback(async (file: File) => {
    const result = await uploadFile(file);
    if (result) {
      setShowUploadZone(false);
      setActiveTab("preview");
    }
  }, [uploadFile]);

  const handleDelete = useCallback(async (id: string) => {
    setDeletingId(id);
    await deleteUpload(id);
    setDeletingId(null);
  }, [deleteUpload]);

  const handleLaunchResearch = useCallback(async (upload: ResearchUpload) => {
    try {
      const tenantParam = tenantId ? `?tenant_id=${tenantId}` : "";
      const res = await api.fetchWithAuth(`/api/research/sessions${tenantParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: `Analyze: ${upload.originalFileName}`,
          uploadIds: [upload.id],
          mode: "deep",
        }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const { sessionId } = await res.json();
      setLaunchSuccess(true);
      setTimeout(() => {
        navigate(`/research/session?session=${encodeURIComponent(sessionId)}`);
      }, 800);
    } catch (err: any) {
      setError(err.message);
    }
  }, [tenantId, navigate, setError]);

  const handleQuickAnalysis = useCallback(async (upload: ResearchUpload) => {
    try {
      const tenantParam = tenantId ? `?tenant_id=${tenantId}` : "";
      const res = await api.fetchWithAuth(`/api/research/sessions${tenantParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: `Quick analysis of ${upload.originalFileName}`,
          uploadIds: [upload.id],
          mode: "quick",
        }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const { sessionId } = await res.json();
      navigate(`/research/session?session=${encodeURIComponent(sessionId)}`);
    } catch (err: any) {
      setError(err.message);
    }
  }, [tenantId, navigate, setError]);

  const piiUpload = activeUpload?.columns.filter((c) => c.isPotentialPii) || [];

  return (
    <DashboardLayout>
      <div className="flex h-full min-h-screen bg-slate-50 dark:bg-slate-950">

        {/* ── Sidebar ── */}
        <div className="w-72 flex-shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
          {/* Header */}
          <div className="px-4 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                  <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h1 className="text-base font-bold text-slate-800 dark:text-slate-100">Data Explorer</h1>
              </div>
              <button
                onClick={() => setShowUploadZone((v) => !v)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                title="Upload new dataset"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* Search */}
            <div className="relative mt-3">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search datasets..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
              />
            </div>
          </div>

          {/* Upload zone (collapsible) */}
          {showUploadZone && (
            <div className="px-3 py-3 border-b border-slate-100 dark:border-slate-800">
              <UploadDropZone
                onFileSelected={handleFileSelected}
                isUploading={isUploading}
                uploadProgress={uploadProgress}
              />
            </div>
          )}

          {/* File list */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="w-5 h-5 text-slate-400 animate-spin" />
              </div>
            ) : filteredUploads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
                <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800">
                  <Database className="w-6 h-6 text-slate-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-400">No datasets yet</p>
                  <p className="text-xs text-slate-400 mt-1">Upload a CSV to get started</p>
                </div>
              </div>
            ) : (
              filteredUploads.map((upload) => (
                <UploadListItem
                  key={upload.id}
                  upload={upload}
                  isActive={activeUpload?.id === upload.id}
                  onClick={() => { setActiveUpload(upload); setActiveTab("preview"); }}
                  onDelete={() => handleDelete(upload.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Main content ── */}
        <div className="flex-1 overflow-y-auto">
          {!activeUpload ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-6 text-center px-8">
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm">
                <Database className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200">No dataset selected</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-sm">
                  Upload a CSV file to explore your data, auto-generate visualizations, and launch AI-powered Research Lab investigations.
                </p>
              </div>
              <div className="w-full max-w-md">
                <UploadDropZone
                  onFileSelected={handleFileSelected}
                  isUploading={isUploading}
                  uploadProgress={uploadProgress}
                />
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-6 max-w-5xl mx-auto">

              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-900/30">
                    <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                      {activeUpload.originalFileName}
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2 mt-0.5">
                      <Clock className="w-3.5 h-3.5" />
                      Uploaded {formatDate(activeUpload.createdAt)}
                      {activeUpload.expiresAt && (
                        <> · expires {formatDate(activeUpload.expiresAt)}</>
                      )}
                    </p>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleQuickAnalysis(activeUpload)}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/10 transition-all"
                    title="Ask a quick question about this data"
                  >
                    <Zap className="w-4 h-4" />
                    Quick Ask
                  </button>
                  <button
                    onClick={() => handleLaunchResearch(activeUpload)}
                    disabled={launchSuccess}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 transition-all disabled:opacity-60 shadow-sm"
                  >
                    {launchSuccess ? (
                      <><Check className="w-4 h-4" /> Launching...</>
                    ) : (
                      <><FlaskConical className="w-4 h-4" /> Analyze in Research Lab</>
                    )}
                  </button>
                </div>
              </div>

              {/* Stats bar */}
              <StatsBar upload={activeUpload} />

              {/* PII warning */}
              {piiUpload.length > 0 && (
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Potential PII detected</p>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                      Columns that may contain sensitive data: {piiUpload.map((c) => c.displayName).join(", ")}. 
                      These columns will be redacted from AI context by default.
                    </p>
                  </div>
                </div>
              )}

              {/* Tab bar */}
              <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700">
                {([
                  { id: "preview" as const, label: "Data Preview", icon: Table2 },
                  { id: "schema" as const, label: "Column Schema", icon: SlidersHorizontal },
                  { id: "insights" as const, label: "Quick Insights", icon: BarChart2 },
                ] as const).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={cn(
                      "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-all",
                      activeTab === id
                        ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                        : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              {activeTab === "preview" && (
                <UploadPreviewTable
                  columns={activeUpload.columns}
                  rows={activeUpload.sampleRows}
                />
              )}

              {activeTab === "schema" && (
                <ColumnSchemaEditor
                  columns={activeUpload.columns}
                  onChange={async (updates) => {
                    await updateColumns(activeUpload.id, updates);
                  }}
                />
              )}

              {activeTab === "insights" && (
                activeUpload.quickInsights.length > 0 ? (
                  <QuickInsightsGrid upload={activeUpload} />
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                    <BarChart2 className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      No quick insights could be generated for this dataset.
                    </p>
                  </div>
                )
              )}

              {/* Error display */}
              {error && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
                  <X className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                  <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
