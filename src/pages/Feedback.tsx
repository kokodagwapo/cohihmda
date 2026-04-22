import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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

type FeedbackItem = {
  id: string;
  user_id: string;
  submitter_email: string;
  submitter_name?: string | null;
  area: FeedbackArea;
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
  const { toast } = useToast();
  const { isSuperAdmin } = useAuth();
  const { selectedTenantId } = useTenantStore();
  const isSuper = isSuperAdmin();

  const [area, setArea] = useState<FeedbackArea | "">("");
  const [description, setDescription] = useState("");
  const [areaError, setAreaError] = useState(false);
  const [descriptionError, setDescriptionError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([]);
  const [sortBy, setSortBy] = useState<"created_at" | "status" | "area">("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const tenantIdForQuery = isSuper ? selectedTenantId || null : null;

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
    const nextDescriptionError = description.trim().length === 0;
    setAreaError(nextAreaError);
    setDescriptionError(nextDescriptionError);
    if (nextAreaError || nextDescriptionError) return;

    setSubmitting(true);
    try {
      const result = await api.createFeedback(
        { area: area as FeedbackArea, description: description.trim() },
        tenantIdForQuery,
      );
      setArea("");
      setDescription("");
      setAreaError(false);
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
    setDescription("");
    setAreaError(false);
    setDescriptionError(false);
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

              <div className="flex items-center gap-2">
                <Button type="submit" disabled={submitting || (isSuper && !tenantIdForQuery)}>
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
                    <Badge variant="outline" className={getStatusBadgeClass(item.status)}>
                      {formatStatus(item.status)}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
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
