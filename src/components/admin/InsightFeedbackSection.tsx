/**
 * InsightFeedbackSection — Admin dashboard for reviewing insight feedback,
 * aggregate stats, and managing training examples for the RLHF loop.
 */

import { useState, useEffect, useCallback } from "react";
import {
  ThumbsUp,
  ThumbsDown,
  BarChart3,
  BookOpen,
  RefreshCw,
  Loader2,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Tag,
  MessageSquare,
  Search,
  Filter,
  FlaskConical,
  Play,
  Square,
  ArrowUpRight,
  Archive,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdminTenant } from "@/contexts/AdminTenantContext";

// ============================================================================
// Types
// ============================================================================

interface FeedbackEntry {
  id: number;
  insight_id: number;
  user_id: string;
  user_email: string;
  user_name: string | null;
  rating: -1 | 1;
  tags: string[];
  comment: string;
  insight_headline: string;
  insight_bucket: string;
  created_at: string;
  tenant_id?: string;
}

interface FeedbackStats {
  totalFeedback: number;
  positiveCount: number;
  negativeCount: number;
  positiveRate: number;
  bucketDistribution: Array<{ bucket: string; rating: number; count: string }>;
  topTags: Array<{ tag: string; count: string }>;
  worstInsights: Array<{ insight_headline: string; insight_bucket: string; neg_count: string }>;
}

interface TrainingExample {
  id: string;
  prompt_id: string;
  example_type: "positive" | "negative";
  headline: string;
  understory: string | null;
  source_insight_id: number | null;
  source_tenant_id: string | null;
  feedback_rating: number | null;
  admin_note: string | null;
  curated_by: string;
  is_active: boolean;
  created_at: string;
}

interface PromptExperiment {
  id: string;
  prompt_id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "completed" | "archived";
  variant_system_prompt: string;
  variant_model: string | null;
  variant_temperature: number | null;
  variant_max_tokens: number | null;
  traffic_pct: number;
  created_by: string;
  created_at: string;
  completed_at: string | null;
}

// ============================================================================
// Tab definitions
// ============================================================================
const TABS = [
  { id: "stream", label: "Feedback Stream", icon: MessageSquare },
  { id: "stats", label: "Aggregate Stats", icon: BarChart3 },
  { id: "training", label: "Training Examples", icon: BookOpen },
  { id: "experiments", label: "Experiments", icon: FlaskConical },
] as const;

type TabId = (typeof TABS)[number]["id"];

const BUCKET_OPTIONS = [
  { value: "all", label: "All Levels" },
  { value: "critical", label: "Immediate Action Required" },
  { value: "attention", label: "Monitor Closely" },
  { value: "working", label: "Strategic Review" },
  { value: "context", label: "Informational" },
];

const PROMPT_OPTIONS = [
  { value: "insights.working", label: "insights.working" },
  { value: "insights.attention", label: "insights.attention" },
  { value: "insights.critical", label: "insights.critical" },
  { value: "insights.context", label: "insights.context" },
];

// ============================================================================
// Component
// ============================================================================

export function InsightFeedbackSection() {
  const [activeTab, setActiveTab] = useState<TabId>("stream");
  const { currentTenantId } = useAdminTenant();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
          Insight Feedback & Training
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Review admin feedback on AI insights, manage training examples, and improve insight quality.
        </p>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/60 w-fit">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                isActive
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "stream" && <FeedbackStreamTab tenantId={currentTenantId} />}
      {activeTab === "stats" && <FeedbackStatsTab tenantId={currentTenantId} />}
      {activeTab === "training" && <TrainingExamplesTab />}
      {activeTab === "experiments" && <ExperimentsTab />}
    </div>
  );
}

// ============================================================================
// Tab 1: Feedback Stream
// ============================================================================

function FeedbackStreamTab({ tenantId }: { tenantId?: string | null }) {
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [bucketFilter, setBucketFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState<string>("all");

  const fetchFeedback = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ tenant_id: tenantId, page: String(page), limit: "30" });
      if (bucketFilter !== "all") params.set("bucket", bucketFilter);
      if (ratingFilter !== "all") params.set("rating", ratingFilter);
      const data = await api.request<any>(`/api/admin/insight-feedback?${params}`);
      setFeedback(data.feedback || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error("Failed to fetch feedback:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId, page, bucketFilter, ratingFilter]);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  if (!tenantId) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-slate-500 dark:text-slate-400">
          <p className="text-sm">Select a tenant from the sidebar to view feedback.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <Select value={bucketFilter} onValueChange={(v) => { setBucketFilter(v); setPage(1); }}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BUCKET_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Select value={ratingFilter} onValueChange={(v) => { setRatingFilter(v); setPage(1); }}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Ratings</SelectItem>
            <SelectItem value="1">Positive Only</SelectItem>
            <SelectItem value="-1">Negative Only</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={fetchFeedback} disabled={loading} className="h-8">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <span className="text-xs text-slate-400 ml-auto">
          {total} total entries
        </span>
      </div>

      {/* Feed */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : feedback.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 dark:text-slate-400">
            <p className="text-sm">No feedback found for this tenant.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {feedback.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 px-4 py-3"
            >
              {/* Rating icon */}
              <div className={`mt-0.5 p-1.5 rounded-full ${
                entry.rating === 1
                  ? "bg-green-100 dark:bg-green-900/40"
                  : "bg-red-100 dark:bg-red-900/40"
              }`}>
                {entry.rating === 1 ? (
                  <ThumbsUp className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                ) : (
                  <ThumbsDown className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                  {entry.insight_headline || "No headline"}
                </p>
                {entry.comment && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    &ldquo;{entry.comment}&rdquo;
                  </p>
                )}
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {entry.insight_bucket && (
                    <Badge variant="outline" className="text-[10px] py-0 h-5">
                      {entry.insight_bucket}
                    </Badge>
                  )}
                  {entry.tags?.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px] py-0 h-5">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Meta */}
              <div className="flex-shrink-0 text-right">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {entry.user_name || entry.user_email}
                </p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  {new Date(entry.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > 30 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <span className="flex items-center text-xs text-slate-500">
            Page {page} of {Math.ceil(total / 30)}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= Math.ceil(total / 30)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Tab 2: Aggregate Stats
// ============================================================================

function FeedbackStatsTab({ tenantId }: { tenantId?: string | null }) {
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const data = await api.request<FeedbackStats>(
        `/api/admin/insight-feedback/stats?tenant_id=${tenantId}`
      );
      setStats(data);
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (!tenantId) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-slate-500 dark:text-slate-400">
          <p className="text-sm">Select a tenant from the sidebar to view stats.</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.totalFeedback}</p>
            <p className="text-xs text-slate-500 mt-1">Total Feedback</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.positiveCount}</p>
            <p className="text-xs text-slate-500 mt-1">Positive</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.negativeCount}</p>
            <p className="text-xs text-slate-500 mt-1">Negative</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.positiveRate}%</p>
            <p className="text-xs text-slate-500 mt-1">Positive Rate</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Tags */}
      {stats.topTags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Tag className="w-4 h-4" />
              Top Feedback Tags
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {stats.topTags.map((t) => (
                <div
                  key={t.tag}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-700/50 text-sm"
                >
                  <span className="text-slate-700 dark:text-slate-300">{t.tag}</span>
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Worst Rated Insights */}
      {stats.worstInsights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <ThumbsDown className="w-4 h-4 text-red-500" />
              Worst Rated Insights
            </CardTitle>
            <CardDescription>
              Candidates for negative training examples
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.worstInsights.map((w, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800 dark:text-slate-200 truncate">
                      {w.insight_headline}
                    </p>
                    <Badge variant="outline" className="text-[10px] mt-1">
                      {w.insight_bucket}
                    </Badge>
                  </div>
                  <Badge variant="destructive" className="ml-2">
                    {w.neg_count} negative
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Tab 3: Training Examples
// ============================================================================

function TrainingExamplesTab() {
  const [examples, setExamples] = useState<TrainingExample[]>([]);
  const [loading, setLoading] = useState(false);
  const [promptFilter, setPromptFilter] = useState("all");
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Create form state
  const [newPromptId, setNewPromptId] = useState("insights.working");
  const [newExampleType, setNewExampleType] = useState<"positive" | "negative">("positive");
  const [newHeadline, setNewHeadline] = useState("");
  const [newAdminNote, setNewAdminNote] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchExamples = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (promptFilter !== "all") params.set("prompt_id", promptFilter);
      const data = await api.request<any>(`/api/admin/insight-feedback/training-examples?${params}`);
      setExamples(data.examples || []);
    } catch (err) {
      console.error("Failed to fetch training examples:", err);
    } finally {
      setLoading(false);
    }
  }, [promptFilter]);

  useEffect(() => {
    fetchExamples();
  }, [fetchExamples]);

  const handleCreate = async () => {
    if (!newHeadline.trim()) return;
    setCreating(true);
    try {
      await api.request<any>("/api/admin/insight-feedback/training-examples", {
        method: "POST",
        body: JSON.stringify({
          prompt_id: newPromptId,
          example_type: newExampleType,
          headline: newHeadline.trim(),
          admin_note: newAdminNote.trim() || undefined,
        }),
      });
      setNewHeadline("");
      setNewAdminNote("");
      setShowCreateForm(false);
      fetchExamples();
    } catch (err) {
      console.error("Failed to create training example:", err);
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (example: TrainingExample) => {
    try {
      await api.request<any>(`/api/admin/insight-feedback/training-examples/${example.id}`, {
        method: "PUT",
        body: JSON.stringify({ is_active: !example.is_active }),
      });
      setExamples((prev) =>
        prev.map((e) => (e.id === example.id ? { ...e, is_active: !e.is_active } : e))
      );
    } catch (err) {
      console.error("Failed to toggle training example:", err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.request<any>(`/api/admin/insight-feedback/training-examples/${id}`, {
        method: "DELETE",
      });
      setExamples((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error("Failed to delete training example:", err);
    }
  };

  // Group by prompt_id
  const grouped = examples.reduce<Record<string, TrainingExample[]>>((acc, ex) => {
    if (!acc[ex.prompt_id]) acc[ex.prompt_id] = [];
    acc[ex.prompt_id].push(ex);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Select value={promptFilter} onValueChange={setPromptFilter}>
            <SelectTrigger className="w-48 h-8 text-xs">
              <SelectValue placeholder="Filter by prompt" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Prompts</SelectItem>
              {PROMPT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={fetchExamples} disabled={loading} className="h-8">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <Button
          size="sm"
          onClick={() => setShowCreateForm((v) => !v)}
          className="h-8"
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add Example
        </Button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardContent className="pt-6 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                  Prompt
                </label>
                <Select value={newPromptId} onValueChange={setNewPromptId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROMPT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                  Type
                </label>
                <Select value={newExampleType} onValueChange={(v) => setNewExampleType(v as "positive" | "negative")}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="positive">Positive (Good)</SelectItem>
                    <SelectItem value="negative">Negative (Bad)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                Headline *
              </label>
              <Input
                value={newHeadline}
                onChange={(e) => setNewHeadline(e.target.value)}
                placeholder="e.g. Top officer Jonathan: 11 units, $94K revenue, 52% PT YTD"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                Admin Note (why this is good/bad)
              </label>
              <Input
                value={newAdminNote}
                onChange={(e) => setNewAdminNote(e.target.value)}
                placeholder="Specific, data-rich, actionable"
                className="h-8 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowCreateForm(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCreate} disabled={creating || !newHeadline.trim()}>
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                Create Example
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Examples List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : examples.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 dark:text-slate-400">
            <BookOpen className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No training examples yet.</p>
            <p className="text-xs mt-1">Add examples to improve insight generation quality.</p>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([promptId, exs]) => (
          <Card key={promptId}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono">{promptId}</CardTitle>
              <CardDescription className="text-xs">
                {exs.filter((e) => e.example_type === "positive").length} positive, {exs.filter((e) => e.example_type === "negative").length} negative
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {exs.map((ex) => (
                <div
                  key={ex.id}
                  className={`flex items-start gap-3 rounded-md border px-3 py-2.5 ${
                    !ex.is_active ? "opacity-50" : ""
                  } ${
                    ex.example_type === "positive"
                      ? "border-green-200 dark:border-green-800/50 bg-green-50/50 dark:bg-green-950/20"
                      : "border-red-200 dark:border-red-800/50 bg-red-50/50 dark:bg-red-950/20"
                  }`}
                >
                  <Badge
                    className={`flex-shrink-0 text-[10px] ${
                      ex.example_type === "positive"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                        : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                    }`}
                  >
                    {ex.example_type === "positive" ? "GOOD" : "BAD"}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800 dark:text-slate-200">
                      {ex.headline}
                    </p>
                    {ex.admin_note && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">
                        {ex.admin_note}
                      </p>
                    )}
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-1">
                    <button
                      onClick={() => handleToggleActive(ex)}
                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                      title={ex.is_active ? "Deactivate" : "Activate"}
                    >
                      {ex.is_active ? (
                        <ToggleRight className="w-4 h-4 text-green-500" />
                      ) : (
                        <ToggleLeft className="w-4 h-4 text-slate-400" />
                      )}
                    </button>
                    <button
                      onClick={() => handleDelete(ex.id)}
                      className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                      title="Delete example"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-400 hover:text-red-600" />
                    </button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

// ============================================================================
// Tab 4: Experiments
// ============================================================================

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
  active: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  archived: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500",
};

function ExperimentsTab() {
  const [experiments, setExperiments] = useState<PromptExperiment[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");

  // Create form state
  const [newPromptId, setNewPromptId] = useState("insights.working");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newVariantPrompt, setNewVariantPrompt] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newTemperature, setNewTemperature] = useState("");
  const [newMaxTokens, setNewMaxTokens] = useState("");
  const [newTrafficPct, setNewTrafficPct] = useState("50");
  const [creating, setCreating] = useState(false);

  const fetchExperiments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const data = await api.request<any>(`/api/admin/insight-feedback/experiments?${params}`);
      setExperiments(data.experiments || []);
    } catch (err) {
      console.error("Failed to fetch experiments:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchExperiments();
  }, [fetchExperiments]);

  const handleCreate = async () => {
    if (!newName.trim() || !newVariantPrompt.trim()) return;
    setCreating(true);
    try {
      await api.request<any>("/api/admin/insight-feedback/experiments", {
        method: "POST",
        body: JSON.stringify({
          prompt_id: newPromptId,
          name: newName.trim(),
          description: newDescription.trim() || undefined,
          variant_system_prompt: newVariantPrompt.trim(),
          variant_model: newModel.trim() || undefined,
          variant_temperature: newTemperature ? parseFloat(newTemperature) : undefined,
          variant_max_tokens: newMaxTokens ? parseInt(newMaxTokens, 10) : undefined,
          traffic_pct: parseInt(newTrafficPct, 10),
        }),
      });
      setShowCreateForm(false);
      setNewName("");
      setNewDescription("");
      setNewVariantPrompt("");
      setNewModel("");
      setNewTemperature("");
      setNewMaxTokens("");
      setNewTrafficPct("50");
      fetchExperiments();
    } catch (err) {
      console.error("Failed to create experiment:", err);
    } finally {
      setCreating(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      await api.request<any>(`/api/admin/insight-feedback/experiments/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status: newStatus }),
      });
      fetchExperiments();
    } catch (err) {
      console.error("Failed to update experiment status:", err);
    }
  };

  const handlePromote = async (id: string) => {
    if (!window.confirm("Are you sure? This will replace the production prompt with the experiment variant.")) return;
    try {
      await api.request<any>(`/api/admin/insight-feedback/experiments/${id}/promote`, {
        method: "POST",
      });
      fetchExperiments();
    } catch (err) {
      console.error("Failed to promote experiment:", err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this experiment?")) return;
    try {
      await api.request<any>(`/api/admin/insight-feedback/experiments/${id}`, {
        method: "DELETE",
      });
      setExperiments((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error("Failed to delete experiment:", err);
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={fetchExperiments} disabled={loading} className="h-8">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <Button
          size="sm"
          onClick={() => setShowCreateForm((v) => !v)}
          className="h-8"
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New Experiment
        </Button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">New Prompt Experiment</CardTitle>
            <CardDescription className="text-xs">
              Create an A/B test variant for a prompt. Active experiments will be randomly selected based on the traffic %.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                  Target Prompt *
                </label>
                <Select value={newPromptId} onValueChange={setNewPromptId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROMPT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                  Traffic % (0-100) *
                </label>
                <Input
                  type="number"
                  value={newTrafficPct}
                  onChange={(e) => setNewTrafficPct(e.target.value)}
                  min={0}
                  max={100}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                Experiment Name *
              </label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Concise personnel insights v2"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                Description
              </label>
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What is this experiment testing?"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                Variant System Prompt *
              </label>
              <Textarea
                value={newVariantPrompt}
                onChange={(e) => setNewVariantPrompt(e.target.value)}
                placeholder="The alternative system prompt to test..."
                rows={6}
                className="text-xs font-mono"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                  Model (optional)
                </label>
                <Input
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                  placeholder="gpt-4o-mini"
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                  Temperature
                </label>
                <Input
                  type="number"
                  step="0.1"
                  value={newTemperature}
                  onChange={(e) => setNewTemperature(e.target.value)}
                  placeholder="0.5"
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                  Max Tokens
                </label>
                <Input
                  type="number"
                  value={newMaxTokens}
                  onChange={(e) => setNewMaxTokens(e.target.value)}
                  placeholder="4500"
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setShowCreateForm(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={creating || !newName.trim() || !newVariantPrompt.trim()}
              >
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                Create Experiment
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Experiments List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : experiments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 dark:text-slate-400">
            <FlaskConical className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No experiments yet.</p>
            <p className="text-xs mt-1">Create an experiment to A/B test prompt variants.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {experiments.map((exp) => (
            <Card key={exp.id} className={exp.status === "archived" ? "opacity-60" : ""}>
              <CardContent className="pt-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                        {exp.name}
                      </h4>
                      <Badge className={`text-[10px] ${STATUS_STYLES[exp.status] || ""}`}>
                        {exp.status.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mb-2">
                      <span className="font-mono">{exp.prompt_id}</span>
                      <span>Traffic: {exp.traffic_pct}%</span>
                      {exp.variant_model && <span>Model: {exp.variant_model}</span>}
                      {exp.variant_temperature != null && (
                        <span>Temp: {exp.variant_temperature}</span>
                      )}
                      <span>Created {new Date(exp.created_at).toLocaleDateString()}</span>
                    </div>
                    {exp.description && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                        {exp.description}
                      </p>
                    )}
                    <details className="mt-2">
                      <summary className="text-[11px] font-medium text-slate-500 dark:text-slate-400 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300">
                        View variant prompt
                      </summary>
                      <pre className="mt-1 text-[10px] leading-relaxed text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-md p-2 max-h-40 overflow-y-auto whitespace-pre-wrap">
                        {exp.variant_system_prompt.substring(0, 1000)}
                        {exp.variant_system_prompt.length > 1000 ? "..." : ""}
                      </pre>
                    </details>
                  </div>

                  {/* Actions */}
                  <div className="flex-shrink-0 flex items-center gap-1">
                    {exp.status === "draft" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStatusChange(exp.id, "active")}
                        className="h-7 text-xs gap-1"
                        title="Activate experiment"
                      >
                        <Play className="w-3 h-3 text-green-500" />
                        Start
                      </Button>
                    )}
                    {exp.status === "active" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStatusChange(exp.id, "completed")}
                        className="h-7 text-xs gap-1"
                        title="End experiment"
                      >
                        <Square className="w-3 h-3 text-orange-500" />
                        End
                      </Button>
                    )}
                    {(exp.status === "active" || exp.status === "completed") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handlePromote(exp.id)}
                        className="h-7 text-xs gap-1"
                        title="Promote to production"
                      >
                        <ArrowUpRight className="w-3 h-3 text-blue-500" />
                        Promote
                      </Button>
                    )}
                    {exp.status !== "archived" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStatusChange(exp.id, "archived")}
                        className="h-7 text-xs"
                        title="Archive"
                      >
                        <Archive className="w-3 h-3 text-slate-400" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(exp.id)}
                      className="h-7 text-xs"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
