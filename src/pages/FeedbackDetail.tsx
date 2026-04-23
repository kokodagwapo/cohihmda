import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantStore } from "@/stores/tenantStore";
import { useToast } from "@/hooks/use-toast";

type FeedbackStatus = "open" | "in_progress" | "resolved";
type FeedbackType = "feature_request" | "bug_issue" | "question";
type FeedbackAttachment = {
  id: string;
  feedback_id: string;
  original_file_name: string;
  stored_file_name: string;
  mime_type: string;
  file_size_bytes: number;
  file_kind: "image" | "data" | "document";
  created_at: string;
  download_url: string;
};

type FeedbackDetail = {
  id: string;
  user_id: string;
  submitter_email: string;
  submitter_name?: string | null;
  area: string;
  type: FeedbackType;
  description: string;
  status: FeedbackStatus;
  admin_notes?: string | null;
  created_at: string;
  updated_at: string;
  in_progress_at?: string | null;
  resolved_at?: string | null;
  status_changed_at?: string | null;
  attachments?: FeedbackAttachment[];
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatStatus(value: FeedbackStatus): string {
  if (value === "in_progress") return "In Progress";
  if (value === "resolved") return "Resolved";
  return "Open";
}

function formatFeedbackType(value: FeedbackType): string {
  if (value === "feature_request") return "Feature Request";
  if (value === "bug_issue") return "Bug/Issue";
  return "Question";
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

export default function FeedbackDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isSuperAdmin } = useAuth();
  const { selectedTenantId } = useTenantStore();
  const isSuper = isSuperAdmin();
  const tenantIdForQuery = isSuper ? selectedTenantId || null : null;

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackDetail | null>(null);
  const [status, setStatus] = useState<FeedbackStatus>("open");
  const [notes, setNotes] = useState("");
  const [imagePreviewUrls, setImagePreviewUrls] = useState<Record<string, string>>({});
  const notesTrimmed = notes.trim();
  const hasChanges =
    !!feedback &&
    (status !== feedback.status || notesTrimmed !== (feedback.admin_notes || ""));

  async function loadDetail(): Promise<void> {
    if (!id) return;
    if (isSuper && !tenantIdForQuery) {
      setFeedback(null);
      return;
    }
    setLoading(true);
    try {
      const result = await api.getFeedbackById(id, tenantIdForQuery);
      const item = result.feedback as FeedbackDetail;
      setFeedback(item);
      setStatus(item.status);
      setNotes(item.admin_notes || "");
    } catch (error: any) {
      toast({
        title: "Failed to load feedback",
        description: error?.message || "Unable to load this feedback item.",
        variant: "destructive",
      });
      navigate("/feedback");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [id, tenantIdForQuery]);

  useEffect(() => {
    let isMounted = true;
    const urlsToRevoke: string[] = [];
    const attachments = feedback?.attachments || [];
    const imageAttachments = attachments.filter((attachment) => attachment.file_kind === "image");
    if (imageAttachments.length === 0) {
      setImagePreviewUrls({});
      return () => undefined;
    }

    void (async () => {
      const nextPreviewMap: Record<string, string> = {};
      for (const attachment of imageAttachments) {
        try {
          const blob = await api.downloadFeedbackAttachment(
            feedback!.id,
            attachment.id,
            tenantIdForQuery,
          );
          const objectUrl = URL.createObjectURL(blob);
          urlsToRevoke.push(objectUrl);
          nextPreviewMap[attachment.id] = objectUrl;
        } catch {
          // Keep attachment visible for manual download even if preview fails.
        }
      }
      if (isMounted) {
        setImagePreviewUrls(nextPreviewMap);
      }
    })();

    return () => {
      isMounted = false;
      urlsToRevoke.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [feedback?.id, feedback?.attachments, tenantIdForQuery]);

  async function onSaveAdminUpdates(): Promise<void> {
    if (!id || !feedback) return;
    const nextNotes = notesTrimmed;
    const payload: { status?: FeedbackStatus; admin_notes?: string } = {};
    if (status !== feedback.status) {
      payload.status = status;
    }
    if (nextNotes !== (feedback.admin_notes || "")) {
      payload.admin_notes = nextNotes;
    }
    if (!payload.status && payload.admin_notes === undefined) {
      toast({ title: "No changes to save", description: "Status and notes are unchanged." });
      return;
    }

    setSaving(true);
    try {
      const result = await api.updateFeedback(id, payload, tenantIdForQuery);
      const updated = result.feedback as FeedbackDetail;
      setFeedback(updated);
      setStatus(updated.status);
      setNotes(updated.admin_notes || "");
      toast({ title: "Feedback updated", description: "Status and notes saved." });
    } catch (error: any) {
      toast({
        title: "Update failed",
        description: error?.message || "Unable to update feedback.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  function onCancelChanges(): void {
    if (!feedback) return;
    setStatus(feedback.status);
    setNotes(feedback.admin_notes || "");
  }

  return (
    <TopTieringLayout>
      <div className="w-full max-w-none px-4 sm:px-6 lg:px-10 pt-8 pb-12 space-y-4">
        <Button variant="ghost" onClick={() => navigate("/feedback")} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back to Feedback
        </Button>

        {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}

        {feedback ? (
          <Card>
            <CardHeader className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="capitalize">{feedback.area.replace(/_/g, " ")}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{formatFeedbackType(feedback.type)}</Badge>
                  <Badge variant="outline" className={getStatusBadgeClass(feedback.status)}>
                    {formatStatus(feedback.status)}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="min-w-0">
                <Label className="font-semibold">Description</Label>
                <p className="mt-2 min-w-0 max-w-full whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
                  {feedback.description}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="font-semibold">Submitter Name:</span>{" "}
                  {feedback.submitter_name?.trim() || "-"}
                </div>
                <div>
                  <span className="font-semibold">Submitter Email:</span> {feedback.submitter_email}
                </div>
                <div>
                  <span className="font-semibold">Created:</span> {formatDate(feedback.created_at)}
                </div>
                <div>
                  <span className="font-semibold">Updated:</span> {formatDate(feedback.updated_at)}
                </div>
                <div>
                  <span className="font-semibold">In Progress At:</span> {formatDate(feedback.in_progress_at)}
                </div>
                <div>
                  <span className="font-semibold">Resolved At:</span> {formatDate(feedback.resolved_at)}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="font-semibold">Attachments</Label>
                {(feedback.attachments || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No attachments</p>
                ) : (
                  <div className="space-y-3">
                    {(feedback.attachments || []).map((attachment) => (
                      <div key={attachment.id} className="rounded border p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{attachment.original_file_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {attachment.mime_type} | {formatBytes(attachment.file_size_bytes)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={async () => {
                              try {
                                const blob = await api.downloadFeedbackAttachment(
                                  feedback.id,
                                  attachment.id,
                                  tenantIdForQuery,
                                );
                                const url = URL.createObjectURL(blob);
                                const anchor = document.createElement("a");
                                anchor.href = url;
                                anchor.download = attachment.original_file_name;
                                anchor.click();
                                URL.revokeObjectURL(url);
                              } catch (error: any) {
                                toast({
                                  title: "Download failed",
                                  description: error?.message || "Unable to download attachment.",
                                  variant: "destructive",
                                });
                              }
                            }}
                          >
                            Download
                          </Button>
                        </div>
                        {attachment.file_kind === "image" && imagePreviewUrls[attachment.id] ? (
                          <img
                            src={imagePreviewUrls[attachment.id]}
                            alt={attachment.original_file_name}
                            className="max-h-[320px] w-auto rounded border"
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {isSuper ? (
                <div className="space-y-3 pt-2 border-t">
                  <div className="space-y-2">
                    <Label className="font-semibold">Status</Label>
                    <Select value={status} onValueChange={(value) => setStatus(value as FeedbackStatus)}>
                      <SelectTrigger className="w-[220px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="resolved">Resolved</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-semibold">Admin Notes</Label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value.slice(0, 4000))}
                      className="min-h-[140px]"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onCancelChanges}
                      disabled={saving || !hasChanges}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => void onSaveAdminUpdates()}
                      disabled={saving || !hasChanges}
                      className={
                        hasChanges
                          ? "bg-blue-600 text-white hover:bg-blue-700"
                          : "bg-slate-300 text-slate-600 hover:bg-slate-300 cursor-not-allowed dark:bg-slate-700 dark:text-slate-300"
                      }
                    >
                      {saving ? "Saving..." : "Save Updates"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </TopTieringLayout>
  );
}
