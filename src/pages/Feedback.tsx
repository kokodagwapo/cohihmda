import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantStore } from "@/stores/tenantStore";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

type FeedbackArea =
  | "insights"
  | "dashboards"
  | "workbench"
  | "research_lab"
  | "communication_center"
  | "general_feedback";
type FeedbackStatus = "open" | "in_progress" | "resolved";
type FeedbackType = "feature_request" | "bug_issue" | "question";
type FeedbackLocationState = {
  sourcePath?: string;
  sourceSearch?: string;
};

type FeedbackItem = {
  id: string;
  user_id: string;
  submitter_email: string;
  submitter_name?: string | null;
  area: FeedbackArea;
  type: FeedbackType;
  description: string;
  status: FeedbackStatus;
  admin_notes?: string | null;
  created_at: string;
  updated_at: string;
  in_progress_at?: string | null;
  resolved_at?: string | null;
  status_changed_at?: string | null;
};

const AREA_OPTIONS: Array<{ value: FeedbackArea; label: string }> = [
  { value: "insights", label: "Insights" },
  { value: "dashboards", label: "Dashboards" },
  { value: "workbench", label: "Workbench" },
  { value: "research_lab", label: "Research Lab" },
  { value: "communication_center", label: "Communication Center" },
  { value: "general_feedback", label: "General Feedback" },
];
const TYPE_OPTIONS: Array<{ value: FeedbackType; label: string }> = [
  { value: "feature_request", label: "Feature Request" },
  { value: "bug_issue", label: "Bug/Issue" },
  { value: "question", label: "Question" },
];

const DASHBOARD_DESCRIPTION_PREFIXES: Record<string, string> = {
  "/leaderboard": "Leaderboard",
  "/business-overview": "Business Overview",
  "/credit-risk-management": "Credit Risk Management",
  "/company-scorecard": "Company Scorecard",
  "/high-performers": "High Performers",
  "/actors": "Actors",
  "/workflow-conversion": "Workflow Conversion",
  "/pricing-dashboard": "Pricing Dashboard",
  "/lock-stratification": "Lock Stratification",
  "/pipeline-analysis": "Pipeline Analysis",
  "/data-quality": "Data Quality",
  "/loan-complexity": "Loan Complexity",
  "/loan-detail": "Loan Detail",
  "/capture-analysis": "Capture Analysis",
  "/sales-scorecard": "Sales Scorecard",
  "/sales-trends": "Sales Trends",
  "/sales-scorecard-overview": "Sales Scorecard Overview",
  "/performance/toptiering-comparison": "Top Tiering Comparison",
  "/performance/operation-scorecard": "Operation Scorecard",
  "/performance/operation-scorecard-trends": "Operation Scorecard Trends",
  "/performance/estimated-closings-risk": "Estimated Closings Risk",
  "/performance/financial-modeling-sandbox": "Financial Modeling Sandbox",
  "/fallout-forecast": "Fallout Forecast",
};

const DASHBOARD_AREA_ROUTES = new Set(Object.keys(DASHBOARD_DESCRIPTION_PREFIXES));
const DASHBOARD_AREA_PREFIXES = [
  "/workflow-conversion",
  "/loan-detail",
  "/fallout-forecast",
  "/pricing-dashboard",
  "/lock-stratification",
  "/pipeline-analysis",
  "/data-quality",
  "/loan-complexity",
  "/leaderboard",
  "/business-overview",
  "/credit-risk-management",
  "/company-scorecard",
  "/high-performers",
  "/actors",
  "/capture-analysis",
  "/sales-scorecard",
  "/sales-scorecard-overview",
  "/sales-trends",
  "/performance/",
  "/loans",
];
const MAX_FEEDBACK_FILES = 5;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const DATA_DOC_MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_FILE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".csv", ".xlsx", ".xls", ".pdf"];
const ALLOWED_FILE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/pdf",
]);

function getFileExtension(fileName: string): string {
  const normalized = fileName.toLowerCase().trim();
  const dot = normalized.lastIndexOf(".");
  if (dot <= 0 || dot === normalized.length - 1) return "";
  return normalized.slice(dot);
}

function getFileSizeLimit(file: File): number {
  return file.type.startsWith("image/") ? IMAGE_MAX_BYTES : DATA_DOC_MAX_BYTES;
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

function normalizePath(pathname?: string): string {
  const base = (pathname || "").trim();
  if (!base) return "";
  if (base === "/") return base;
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function getRouteAutofill(
  sourcePath?: string,
  sourceSearch?: string,
): { area: FeedbackArea; descriptionPrefix?: string } | null {
  const path = normalizePath(sourcePath);
  const query = new URLSearchParams(sourceSearch || "");
  if (!path) return null;

  if (path === "/insights" || path === "/legacy") {
    return { area: "insights" };
  }

  if (path.startsWith("/my-dashboard/")) {
    return { area: "workbench" };
  }

  if (path === "/research/session") {
    return { area: "research_lab" };
  }

  if (path.startsWith("/workbench")) {
    return { area: "workbench" };
  }

  if (path.startsWith("/research")) {
    return { area: "research_lab" };
  }

  if (path.startsWith("/data-chat")) {
    return { area: "communication_center" };
  }

  if (path.startsWith("/fallout-forecast/loan/")) {
    const loanId = decodeURIComponent(path.split("/").filter(Boolean).at(-1) || "").trim();
    return {
      area: "dashboards",
      descriptionPrefix: loanId ? `Fallout Forecast Loan ${loanId} - ` : "Fallout Forecast Loan - ",
    };
  }

  if (path.startsWith("/loan-detail")) {
    const loan = (query.get("loan") || query.get("loanId") || "").trim();
    return {
      area: "dashboards",
      descriptionPrefix: loan ? `Loan Detail ${loan} - ` : "Loan Detail - ",
    };
  }

  if (DASHBOARD_DESCRIPTION_PREFIXES[path]) {
    return {
      area: "dashboards",
      descriptionPrefix: `${DASHBOARD_DESCRIPTION_PREFIXES[path]} - `,
    };
  }

  if (DASHBOARD_AREA_ROUTES.has(path)) {
    return { area: "dashboards" };
  }

  if (DASHBOARD_AREA_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix))) {
    return { area: "dashboards" };
  }

  return null;
}

function formatStatus(value: FeedbackStatus): string {
  if (value === "in_progress") return "In Progress";
  if (value === "resolved") return "Resolved";
  return "Open";
}

function getStatusBadgeClass(value: FeedbackStatus): string {
  if (value === "open") {
    return "border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400";
  }
  if (value === "in_progress") {
    return "border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400";
  }
  return "border-green-200 bg-green-50 text-green-600 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400";
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatFeedbackType(value: FeedbackType): string {
  if (value === "feature_request") return "Feature Request";
  if (value === "bug_issue") return "Bug/Issue";
  return "Question";
}

function getStatusTimestampText(item: FeedbackItem): string {
  if (item.status === "resolved") {
    return `Created: ${formatDate(item.created_at)} | Resolved: ${formatDate(
      item.resolved_at || item.status_changed_at,
    )}`;
  }
  if (item.status === "in_progress") {
    return `Created: ${formatDate(item.created_at)} | In Progress: ${formatDate(
      item.in_progress_at || item.status_changed_at,
    )}`;
  }
  return `Created: ${formatDate(item.created_at)}`;
}

export default function FeedbackPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { isSuperAdmin } = useAuth();
  const { selectedTenantId } = useTenantStore();
  const isSuper = isSuperAdmin();

  const [area, setArea] = useState<FeedbackArea | "">("");
  const [type, setType] = useState<FeedbackType | "">("");
  const [description, setDescription] = useState("");
  const [areaError, setAreaError] = useState(false);
  const [typeError, setTypeError] = useState(false);
  const [descriptionError, setDescriptionError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([]);
  const [sortBy, setSortBy] = useState<"created_at" | "status" | "area">("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [fileWarning, setFileWarning] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const tenantIdForQuery = isSuper ? selectedTenantId || null : null;
  const draftStorageKey = `feedback:draft:${tenantIdForQuery || "default"}`;

  useEffect(() => {
    let restored = false;
    try {
      const rawDraft = sessionStorage.getItem(draftStorageKey);
      if (rawDraft) {
        const parsed = JSON.parse(rawDraft) as {
          area?: FeedbackArea;
          type?: FeedbackType;
          description?: string;
        };
        if (parsed.area) {
          setArea(parsed.area);
          restored = true;
        }
        if (typeof parsed.description === "string") {
          setDescription(parsed.description.slice(0, 4000));
          restored = true;
        }
        if (parsed.type) {
          setType(parsed.type);
          restored = true;
        }
      }
    } catch {
      // Ignore malformed draft data and continue with normal initialization.
    } finally {
      setDraftLoaded(true);
    }
    if (!restored) return;
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftLoaded) return;
    const state = (location.state || null) as FeedbackLocationState | null;
    const autofill = getRouteAutofill(state?.sourcePath, state?.sourceSearch);
    if (!autofill) return;

    setArea((prev) => (prev ? prev : autofill.area));
    if (autofill.descriptionPrefix) {
      setDescription((prev) => (prev.trim().length > 0 ? prev : autofill.descriptionPrefix || ""));
    }
  }, [draftLoaded, location.state]);

  useEffect(() => {
    if (!draftLoaded) return;
    const shouldClearDraft = !area && !type && description.trim().length === 0;
    if (shouldClearDraft) {
      sessionStorage.removeItem(draftStorageKey);
      return;
    }
    sessionStorage.setItem(
      draftStorageKey,
      JSON.stringify({
        area,
        type,
        description,
      }),
    );
  }, [area, type, description, draftLoaded, draftStorageKey]);

  async function loadFeedback(): Promise<void> {
    if (isSuper && !tenantIdForQuery) {
      setFeedbackItems([]);
      return;
    }
    setLoadingList(true);
    try {
      const result = await api.getFeedbackList({
        sortBy,
        sortDir,
        page: 1,
        limit: 50,
        tenantId: tenantIdForQuery,
      });
      setFeedbackItems(result.feedback as FeedbackItem[]);
    } catch (error: any) {
      toast({
        title: "Failed to load feedback",
        description: error?.message || "Unable to fetch feedback right now.",
        variant: "destructive",
      });
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    void loadFeedback();
  }, [sortBy, sortDir, tenantIdForQuery]);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const nextAreaError = !area;
    const nextTypeError = !type;
    const nextDescriptionError = description.trim().length === 0;
    setAreaError(nextAreaError);
    setTypeError(nextTypeError);
    setDescriptionError(nextDescriptionError);
    if (nextAreaError || nextTypeError || nextDescriptionError || fileErrors.length > 0) return;

    setSubmitting(true);
    try {
      const result = await api.createFeedback(
        { area: area as FeedbackArea, type: type as FeedbackType, description: description.trim(), files },
        tenantIdForQuery,
      );
      setArea("");
      setType("");
      setDescription("");
      setFiles([]);
      setFileErrors([]);
      setFileWarning("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      sessionStorage.removeItem(draftStorageKey);
      setAreaError(false);
      setTypeError(false);
      setDescriptionError(false);
      if (!result.notificationSent) {
        toast({
          title: "Feedback saved",
          description: "Feedback submitted successfully. Email Notification Failed. Will try again shortly.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Feedback submitted",
          description: "Thanks for sharing your feedback.",
        });
      }
      await loadFeedback();
    } catch (error: any) {
      toast({
        title: "Submit failed",
        description: error?.message || "Unable to submit feedback right now.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function onClear(): void {
    setArea("");
    setType("");
    setDescription("");
    setFiles([]);
    setFileErrors([]);
    setFileWarning("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    sessionStorage.removeItem(draftStorageKey);
    setAreaError(false);
    setTypeError(false);
    setDescriptionError(false);
  }

  function removeSelectedFile(index: number): void {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setFileErrors([]);
    setFileWarning("");
  }

  function onFilesSelected(nextFilesList: FileList | null): void {
    if (!nextFilesList) return;
    const nextFiles = Array.from(nextFilesList);
    const nextErrors: string[] = [];

    const mergedFiles = [...files];
    for (const file of nextFiles) {
      const alreadySelected = mergedFiles.some(
        (existing) =>
          existing.name === file.name &&
          existing.size === file.size &&
          existing.lastModified === file.lastModified,
      );
      if (!alreadySelected) {
        mergedFiles.push(file);
      }
    }

    setFileWarning(mergedFiles.length > MAX_FEEDBACK_FILES ? "Maximum 5 files allowed" : "");

    const acceptedFiles: File[] = [];
    for (const file of mergedFiles.slice(0, MAX_FEEDBACK_FILES)) {
      const extension = getFileExtension(file.name);
      const allowedByMime = ALLOWED_FILE_MIME_TYPES.has(file.type);
      const allowedByExtension = ALLOWED_FILE_EXTENSIONS.includes(extension);
      if (!allowedByMime && !allowedByExtension) {
        nextErrors.push(`Unsupported file type: ${file.name}`);
        continue;
      }
      const sizeLimit = getFileSizeLimit(file);
      if (file.size > sizeLimit) {
        nextErrors.push(`File is too large: ${file.name} (max ${formatMegabytes(sizeLimit)})`);
        continue;
      }
      acceptedFiles.push(file);
    }

    setFiles(acceptedFiles);
    setFileErrors(nextErrors);
  }

  return (
    <TopTieringLayout>
      <div className="w-full max-w-none px-4 sm:px-6 lg:px-10 pt-8 pb-12 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Submit Feedback</CardTitle>
            <CardDescription>
              Share product feedback by area. Super admins will be notified automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={onSubmit}>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="feedback-area">Area</Label>
                  {areaError ? (
                    <span className="text-xs px-2 py-1 rounded border border-red-300 bg-red-50 text-red-700">
                      Area is required to submit
                    </span>
                  ) : null}
                </div>
                <Select
                  value={area}
                  onValueChange={(value) => {
                    setArea(value as FeedbackArea);
                    if (value) setAreaError(false);
                  }}
                >
                  <SelectTrigger id="feedback-area">
                    <SelectValue placeholder="Select an area" />
                  </SelectTrigger>
                  <SelectContent>
                    {AREA_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="feedback-type">Type</Label>
                  {typeError ? (
                    <span className="text-xs px-2 py-1 rounded border border-red-300 bg-red-50 text-red-700">
                      Type is required to submit
                    </span>
                  ) : null}
                </div>
                <Select
                  value={type}
                  onValueChange={(value) => {
                    setType(value as FeedbackType);
                    if (value) setTypeError(false);
                  }}
                >
                  <SelectTrigger id="feedback-type">
                    <SelectValue placeholder="Select a type" />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="feedback-description">Description</Label>
                  {descriptionError ? (
                    <span className="text-xs px-2 py-1 rounded border border-red-300 bg-red-50 text-red-700">
                      Description is required to submit
                    </span>
                  ) : null}
                </div>
                <Textarea
                  id="feedback-description"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value.slice(0, 4000));
                    if (e.target.value.trim().length > 0) setDescriptionError(false);
                  }}
                  placeholder="Share details..."
                  className="min-h-[140px]"
                />
                <p className="text-xs text-muted-foreground">{description.length}/4000</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="feedback-files">Attachments (optional)</Label>
                <input
                  ref={fileInputRef}
                  id="feedback-files"
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,.webp,.csv,.xlsx,.xls,.pdf"
                  onChange={(e) => {
                    onFilesSelected(e.target.files);
                  }}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs dark:file:bg-slate-800"
                />
                <p className="text-xs text-muted-foreground">
                  Up to 5 files. Images up to 10MB each; CSV/XLS/XLSX/PDF up to 50MB each.
                </p>
                {fileErrors.length > 0 ? (
                  <div className="space-y-1">
                    {fileErrors.map((message, idx) => (
                      <p key={`${message}-${idx}`} className="text-xs text-red-700">
                        {message}
                      </p>
                    ))}
                  </div>
                ) : null}
                {fileWarning ? <p className="text-xs text-amber-700">{fileWarning}</p> : null}
                {files.length > 0 ? (
                  <div className="space-y-1">
                    {files.map((file, idx) => (
                      <div
                        key={`${file.name}-${idx}`}
                        className="flex items-center justify-between rounded border px-2 py-1 text-xs"
                      >
                        <span className="truncate pr-2">{file.name}</span>
                        <Button type="button" variant="ghost" size="sm" onClick={() => removeSelectedFile(idx)}>
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  disabled={submitting || (isSuper && !tenantIdForQuery) || fileErrors.length > 0}
                >
                  {submitting ? "Submitting..." : "Submit Feedback"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClear}
                  disabled={submitting}
                >
                  Clear
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Submitted Feedback</CardTitle>
            <CardDescription>
              {isSuper
                ? "Showing feedback for the currently selected tenant."
                : "Showing feedback you have submitted."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="feedback-sort">Sort By</Label>
              <Select value={sortBy} onValueChange={(value) => setSortBy(value as any)}>
                <SelectTrigger id="feedback-sort" className="w-[190px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="created_at">Created At</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                  <SelectItem value="area">Area</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortDir} onValueChange={(value) => setSortDir(value as any)}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">Desc</SelectItem>
                  <SelectItem value="asc">Asc</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {loadingList ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
            {!loadingList && feedbackItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No submissions yet.</p>
            ) : null}
            <div className="space-y-2">
              {feedbackItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(`/feedback/${item.id}`)}
                  className="w-full text-left p-3 rounded-lg border hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium capitalize">{item.area.replace(/_/g, " ")}</div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{formatFeedbackType(item.type)}</Badge>
                      <Badge variant="outline" className={getStatusBadgeClass(item.status)}>
                        {formatStatus(item.status)}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
                  {isSuper ? (
                    <div className="text-xs text-muted-foreground mt-2 min-w-0">
                      <span className="font-medium">Submitter:</span>{" "}
                      {item.submitter_name?.trim() || "-"}{" "}
                      <span className="mx-1">|</span>
                      <span className="font-medium">Email:</span>{" "}
                      <span className="break-all">{item.submitter_email}</span>
                    </div>
                  ) : null}
                  <div className="text-xs text-muted-foreground mt-2">
                    {getStatusTimestampText(item)}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </TopTieringLayout>
  );
}
