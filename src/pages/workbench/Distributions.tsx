// Marko Petrovic
// Distributions page
// This page allows users to create and manage distribution schedules for canvases, reports, and insight digests.
// It also allows users to create and manage recipient lists.
// It also allows users to view the history of sent distributions.
// It also allows users to send distributions now.
// It also allows users to edit and deactivate distributions.
// It also allows users to create and manage recipient lists.
// It also allows users to view the history of sent distributions.
// It also allows users to send distributions now.

import { useState, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  Mail,
  Plus,
  Pencil,
  Trash2,
  Play,
  History,
  ArrowRight,
  Calendar,
  Users,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { FalloutDistribution } from "@/components/workbench/FalloutDistribution";
import { WorkbenchTopBar } from "@/components/workbench/WorkbenchTopBar";
import { IconBadge } from "@/components/workbench/IconBadge";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useDashboardVisibility } from "@/hooks/useDashboardVisibility";
import type { ReportData } from "@/data/reportSimulations";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantStore } from "@/stores/tenantStore";
import { api } from "@/lib/api";

const CONTENT_TYPES = [
  { value: "canvas", label: "Canvas / Workbench" },
] as const;

const FREQUENCIES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "one_time", label: "One time" },
] as const;

const COMMON_TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Anchorage", label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HT)" },
  { value: "America/Phoenix", label: "Arizona (MST)" },
  { value: "UTC", label: "UTC" },
] as const;

function detectBrowserTimezone(): string {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (COMMON_TIMEZONES.some((tz) => tz.value === detected)) return detected;
    return detected || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

function formatTzLabel(tzValue: string): string {
  const found = COMMON_TIMEZONES.find((tz) => tz.value === tzValue);
  return found ? found.label : tzValue;
}

export default function Distributions() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { dashboardVisibility, handleVisibilityChange } = useDashboardVisibility();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { selectedTenantId } = useTenantStore();
  const tenantId = selectedTenantId || user?.tenant_id || null;
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") === "fallout" ? "fallout" : "content") as "content" | "fallout";
  const setActiveTab = (tab: "content" | "fallout") => {
    setSearchParams(tab === "fallout" ? { tab: "fallout" } : {}, { replace: true });
  };
  const tenantQs = useMemo(
    () => (tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : ""),
    [tenantId],
  );

  const { data: listData, isLoading } = useQuery({
    queryKey: ["distributions", "schedules", tenantId],
    queryFn: () => api.getDistributionSchedules({ limit: 100, tenantId }),
  });

  const { data: recipientLists } = useQuery({
    queryKey: ["distributions", "recipient-lists", tenantId],
    queryFn: () => api.getDistributionRecipientLists(tenantId),
  });

  const { data: canvases } = useQuery({
    queryKey: ["workbench", "canvases", tenantId],
    queryFn: async () => {
      const res = await api.request<{ canvases: any[] }>(
        `/api/workbench/canvases${tenantQs}`,
      );
      return res?.canvases ?? [];
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.createDistributionSchedule(data, tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributions"] });
      setCreateOpen(false);
      toast({ title: "Schedule created" });
    },
    onError: (e: Error) => {
      toast({
        title: "Failed to create schedule",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.updateDistributionSchedule(id, data, tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributions"] });
      setEditingId(null);
      toast({ title: "Schedule updated" });
    },
    onError: (e: Error) => {
      toast({
        title: "Failed to update schedule",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteDistributionSchedule(id, tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributions"] });
      toast({ title: "Schedule deleted" });
    },
    onError: (e: Error) => {
      toast({
        title: "Failed to delete",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const confirmDelete = useCallback(
    (id: string, name: string) => {
      if (window.confirm(`Permanently delete "${name}"? This will also remove all send history and cannot be undone.`)) {
        deleteMutation.mutate(id);
      }
    },
    [deleteMutation],
  );

  const sendNowMutation = useMutation({
    mutationFn: (id: string) => api.sendDistributionNow(id, tenantId),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["distributions"] });
      toast({
        title: "Send completed",
        description: `${data?.successful_count ?? 0}/${data?.recipients_count ?? 0} recipients`,
      });
    },
    onError: (e: Error) => {
      toast({
        title: "Send failed",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const schedules = listData?.schedules ?? [];
  const total = listData?.total ?? 0;

  const handleSaveSchedule = useCallback(
    (data: Record<string, unknown>) => {
      if (editingId) {
        updateMutation.mutate({ id: editingId, data });
      } else {
        createMutation.mutate(data);
      }
    },
    [editingId, updateMutation, createMutation],
  );

  const formatInTz = (isoStr: string | null, tz?: string) => {
    if (!isoStr) return "—";
    try {
      return new Date(isoStr).toLocaleString(undefined, {
        timeZone: tz || undefined,
        dateStyle: "short",
        timeStyle: "short",
      });
    } catch {
      return new Date(isoStr).toLocaleString(undefined, {
        dateStyle: "short",
        timeStyle: "short",
      });
    }
  };

  const getContentLink = (schedule: any) => {
    if (schedule?.content_type === "canvas" && schedule?.content_id)
      return `/my-dashboard/${schedule.content_id}`;
    if (schedule?.content_type === "insight_digest") return "/insights";
    return "/my-dashboard";
  };

  return (
    <DashboardLayout
      isAuthenticated={!!user}
      mobileMenuOpen={mobileMenuOpen}
      onMobileMenuToggle={() => setMobileMenuOpen((prev) => !prev)}
      dashboardVisibility={dashboardVisibility}
      onVisibilityChange={handleVisibilityChange}
      onReportClick={(_report: ReportData) => {}}
    >
      <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-slate-50/90 via-white to-sky-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/80 flex flex-col">
        <WorkbenchTopBar onOpenSidebar={() => setMobileMenuOpen(true)} />
        <main className="flex-1 relative w-full min-h-0 overflow-hidden">
            <div className="h-full overflow-y-auto px-4 sm:px-6 py-4 sm:py-6">
              <div className="max-w-[1600px] mx-auto">
                {/* Page header */}
                <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <IconBadge icon={Mail} variant="violet" size="xl" rounded="2xl" />
                    <div>
                      <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
                        Communications Center
                      </h1>
                      <p className="mt-1.5 text-[15px] text-slate-600 dark:text-slate-400 max-w-xl">
                        Manage canvas distribution schedules and fallout alert distribution.
                      </p>
                    </div>
                  </div>
                  {activeTab === "content" && (
                    <Button onClick={() => setCreateOpen(true)} className="shrink-0">
                      <Plus className="h-4 w-4 mr-2" />
                      New schedule
                    </Button>
                  )}
                </div>

                {/* Top-level tabs */}
                <div className="flex gap-1 mb-6 border-b border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setActiveTab("content")}
                    className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
                      activeTab === "content"
                        ? "border-violet-500 text-violet-700 dark:text-violet-400"
                        : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                    }`}
                  >
                    Content Distribution
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("fallout")}
                    className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                      activeTab === "fallout"
                        ? "border-emerald-500 text-emerald-700 dark:text-emerald-400"
                        : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Fallout Alerts
                  </button>
                </div>

                {/* Content Distribution tab */}
                {activeTab === "content" && (
                  <>
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-3">
                  Canvas Schedules
                </h2>
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/70 overflow-hidden">
                  {isLoading ? (
                    <div className="p-8 text-center text-slate-500">
                      Loading…
                    </div>
                  ) : schedules.length === 0 ? (
                    <div className="p-8 text-center text-slate-500">
                      <p className="font-medium">
                        No distribution schedules yet
                      </p>
                      <p className="mt-1 text-sm">
                        Create one to start sending canvases on a schedule.
                      </p>
                      <Button
                        className="mt-4"
                        onClick={() => setCreateOpen(true)}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Create schedule
                      </Button>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Content</TableHead>
                          <TableHead>Schedule</TableHead>
                          <TableHead>Recipients</TableHead>
                          <TableHead>Next run</TableHead>
                          <TableHead>Last sent</TableHead>
                          <TableHead className="w-[120px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {schedules.map((s: any) => (
                          <TableRow key={s.id}>
                            <TableCell className="font-medium">
                              {s.name}
                            </TableCell>
                            <TableCell>
                              <span className="capitalize">
                                {s.content_type?.replace("_", " ")}
                              </span>
                              {s.content_id && (
                                <span className="text-slate-500 text-xs ml-1">
                                  ({s.content_id.slice(0, 8)}…)
                                </span>
                              )}
                              <div className="mt-1">
                                <Link
                                  to={getContentLink(s)}
                                  className="text-xs text-violet-600 hover:text-violet-700"
                                >
                                  Open content
                                </Link>
                              </div>
                            </TableCell>
                            <TableCell>
                              {FREQUENCIES.find((f) => f.value === s.frequency)
                                ?.label ?? s.frequency}{" "}
                              at {s.schedule_time?.slice(0, 5) ?? "08:00"}
                              <span className="block text-xs text-slate-500">
                                {formatTzLabel(s.timezone || "America/New_York")}
                              </span>
                            </TableCell>
                            <TableCell>
                              {s.recipient_list_name ??
                                (s.recipient_emails?.length
                                  ? `${s.recipient_emails.length} emails`
                                  : "—")}
                            </TableCell>
                            <TableCell>
                              {formatInTz(s.next_run_at, s.timezone)}
                            </TableCell>
                            <TableCell>
                              {formatInTz(s.last_sent_at, s.timezone)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => sendNowMutation.mutate(s.id)}
                                  disabled={sendNowMutation.isPending}
                                  title="Send now"
                                >
                                  <Play className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => setHistoryId(s.id)}
                                  title="History"
                                >
                                  <History className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => setEditingId(s.id)}
                                  title="Edit"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-red-600 hover:text-red-700"
                                  onClick={() => confirmDelete(s.id, s.name)}
                                  disabled={deleteMutation.isPending}
                                  title="Delete"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-10 mb-3">
                  Recipient lists
                </h2>
                <RecipientListSection
                  lists={recipientLists?.lists ?? []}
                  onRefresh={() =>
                    queryClient.invalidateQueries({
                      queryKey: ["distributions", "recipient-lists"],
                    })
                  }
                  tenantId={tenantId}
                />
                  </>
                )}

                {/* Fallout Alerts tab */}
                {activeTab === "fallout" && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/70 p-5">
                    <div className="mb-4">
                      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        Fallout Alert Distribution
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                        Configure LO targeting, manager notifications, and one-click response emails for closing fallout risk alerts.
                      </p>
                      <Link
                        to="/fallout-forecast"
                        className="inline-flex items-center gap-1.5 mt-2 text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700"
                      >
                        View Closing Fallout Forecast
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                    <FalloutDistribution selectedTenantId={tenantId} />
                  </div>
                )}
              </div>
            </div>
        </main>

      {/* Create / Edit dialog: minimal form for Phase 3 */}
      <DistributionScheduleDialog
        open={createOpen || !!editingId}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditingId(null);
          }
        }}
        scheduleId={editingId}
        recipientLists={recipientLists?.lists ?? []}
        canvases={canvases ?? []}
        onSave={handleSaveSchedule}
        saving={createMutation.isPending || updateMutation.isPending}
        tenantId={tenantId}
      />

      {/* History dialog */}
      {historyId && (
        <HistoryDialog
          scheduleId={historyId}
          onClose={() => setHistoryId(null)}
          tenantId={tenantId}
        />
      )}
      </div>
    </DashboardLayout>
  );
}

function DistributionScheduleDialog({
  open,
  onOpenChange,
  scheduleId,
  recipientLists,
  canvases,
  onSave,
  saving,
  tenantId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheduleId: string | null;
  recipientLists: any[];
  canvases: any[];
  onSave: (data: Record<string, unknown>) => void;
  saving: boolean;
  tenantId: string | null;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [contentType, setContentType] = useState<string>("canvas");
  const [contentId, setContentId] = useState("");
  const [frequency, setFrequency] = useState("weekly");
  const [scheduleTime, setScheduleTime] = useState("08:00");
  const [timezone, setTimezone] = useState(detectBrowserTimezone);
  const [recipientListId, setRecipientListId] = useState("");
  const [recipientEmails, setRecipientEmails] = useState("");
  const [autoInviteDirectEmails, setAutoInviteDirectEmails] = useState(true);

  const { data: schedule } = useQuery({
    queryKey: ["distributions", "schedule", scheduleId, tenantId],
    queryFn: () => api.getDistributionSchedule(scheduleId!, tenantId),
    enabled: !!scheduleId && open,
  });

  useEffect(() => {
    if (!open) return;
    if (schedule && scheduleId) {
      setName(schedule.name ?? "");
      setDescription(schedule.description ?? "");
      setContentType(schedule.content_type ?? "canvas");
      setContentId(schedule.content_id ?? "");
      setFrequency(schedule.frequency ?? "weekly");
      setScheduleTime(schedule.schedule_time?.slice(0, 5) ?? "08:00");
      setTimezone(schedule.timezone || detectBrowserTimezone());
      setRecipientListId(schedule.recipient_list_id ?? "");
      setRecipientEmails((schedule.recipient_emails ?? []).join(", "));
      setAutoInviteDirectEmails(
        schedule.content_config?.auto_invite_external !== false,
      );
    } else {
      setName("");
      setDescription("");
      setContentType("canvas");
      setContentId("");
      setFrequency("weekly");
      setScheduleTime("08:00");
      setTimezone(detectBrowserTimezone());
      setRecipientListId("");
      setRecipientEmails("");
      setAutoInviteDirectEmails(true);
    }
  }, [open, scheduleId, schedule]);

  const handleSubmit = () => {
    const emails = recipientEmails
      .split(/[,;\s]+/)
      .map((e) => e.trim())
      .filter((e) => e.includes("@"));
    onSave({
      name: name.trim() || "Untitled schedule",
      description: description.trim() || undefined,
      content_type: contentType,
      content_id: contentId || undefined,
      content_config: { auto_invite_external: autoInviteDirectEmails },
      frequency,
      schedule_time: scheduleTime,
      timezone,
      recipient_list_id: recipientListId || undefined,
      recipient_emails: emails,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {scheduleId ? "Edit schedule" : "New distribution schedule"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weekly executive report"
            />
          </div>
          <div>
            <Label>Email summary (optional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief summary shown in the email"
            />
          </div>
          <div>
            <Label>Content type</Label>
            <Select value={contentType} onValueChange={setContentType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTENT_TYPES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(contentType === "canvas" || contentType === "report") && (
            <div>
              <Label>
                {contentType === "canvas" ? "Canvas" : "Report template"}
              </Label>
              <Select
                value={contentId || undefined}
                onValueChange={setContentId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {canvases
                    .filter((c: any) => c.id)
                    .map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.title || "Untitled"}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Time</Label>
              <Input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
              />
            </div>
            <div>
              <Label>Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Recipient list</Label>
            <Select
              value={recipientListId || "__none__"}
              onValueChange={(v) =>
                setRecipientListId(v === "__none__" ? "" : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {recipientLists.map((l: any) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Or enter emails (comma-separated)</Label>
            <Input
              value={recipientEmails}
              onChange={(e) => setRecipientEmails(e.target.value)}
              placeholder="a@example.com, b@example.com"
            />
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoInviteDirectEmails}
                onChange={(e) => setAutoInviteDirectEmails(e.target.checked)}
              />
              Auto-invite direct emails that are not existing users
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {scheduleId ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({
  scheduleId,
  onClose,
  tenantId,
}: {
  scheduleId: string;
  onClose: () => void;
  tenantId: string | null;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["distributions", "history", scheduleId, tenantId],
    queryFn: () => api.getDistributionHistory(scheduleId, 30, tenantId),
  });
  const history = data?.history ?? [];

  return (
    <Dialog open={!!scheduleId} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send history</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-slate-500 py-4">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-slate-500 py-4">No sends yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sent at</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Recipients</TableHead>
                <TableHead>Invite status</TableHead>
                <TableHead>Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h: any) => (
                <TableRow key={h.id}>
                  <TableCell>{new Date(h.sent_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</TableCell>
                  <TableCell>
                    <span
                      className={
                        h.status === "success"
                          ? "text-green-600"
                          : h.status === "partial_failure"
                            ? "text-amber-600"
                            : "text-red-600"
                      }
                    >
                      {h.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    {h.successful_count ?? 0}/{h.recipients_count ?? 0}
                  </TableCell>
                  <TableCell>
                    {h.content_snapshot?.invite_status
                      ? `${h.content_snapshot.invite_status.invitedCount ?? 0} invited, ${h.content_snapshot.invite_status.inviteFailedCount ?? 0} failed`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {h.duration_ms != null ? `${h.duration_ms}ms` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ROLES = [
  { value: "tenant_admin", label: "Admin" },
  { value: "user", label: "User" },
];

function RecipientListSection({
  lists,
  onRefresh,
  tenantId,
}: {
  lists: any[];
  onRefresh: () => void;
  tenantId: string | null;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const tenantQs = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";

  const { data: tenantUsers } = useQuery({
    queryKey: ["workbench", "tenant-users", tenantId],
    queryFn: async () => {
      const res = await api.request<{ users: any[] }>(
        `/api/workbench/canvases/tenant-users${tenantQs}`,
      );
      return res?.users ?? [];
    },
  });

  const { data: groupsData } = useQuery({
    queryKey: ["groups", tenantId],
    queryFn: () => api.request<{ groups: any[] }>(`/api/groups${tenantQs}`),
  });

  const createListMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.createDistributionRecipientList(data, tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributions"] });
      setDialogOpen(false);
      setEditingListId(null);
      onRefresh();
      toast({ title: "Recipient list created" });
    },
    onError: (e: Error) => {
      toast({
        title: "Failed to create list",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const updateListMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.updateDistributionRecipientList(id, data, tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributions"] });
      setDialogOpen(false);
      setEditingListId(null);
      onRefresh();
      toast({ title: "Recipient list updated" });
    },
    onError: (e: Error) => {
      toast({
        title: "Failed to update list",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const deleteListMutation = useMutation({
    mutationFn: (id: string) =>
      api.deleteDistributionRecipientList(id, tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributions"] });
      onRefresh();
      toast({ title: "Recipient list deleted" });
    },
    onError: (e: Error) => {
      toast({
        title: "Failed to delete list",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  return (
    <>
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/70 overflow-hidden">
        <div className="p-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-700">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Reusable groups of recipients for distribution schedules.
          </p>
          <Button
            size="sm"
            onClick={() => {
              setEditingListId(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            New list
          </Button>
        </div>
        {lists.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-sm">
            No recipient lists yet. Create one to use in schedules.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Users / Roles</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lists.map((l: any) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-400">
                    {l.description || "—"}
                  </TableCell>
                  <TableCell>
                    {l.user_ids?.length ? `${l.user_ids.length} users` : ""}
                    {l.role_filter?.length
                      ? ` ${l.role_filter.length} roles`
                      : ""}
                    {l.external_emails?.length
                      ? ` ${l.external_emails.length} external`
                      : ""}
                    {!l.user_ids?.length &&
                      !l.role_filter?.length &&
                      !l.external_emails?.length &&
                      "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        setEditingListId(l.id);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-600"
                      onClick={() => deleteListMutation.mutate(l.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <RecipientListDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        listId={editingListId}
        initialList={
          editingListId
            ? lists.find((l: any) => l.id === editingListId)
            : undefined
        }
        tenantUsers={tenantUsers ?? []}
        groups={groupsData?.groups ?? []}
        onSave={(data) => {
          if (editingListId)
            updateListMutation.mutate({ id: editingListId, data });
          else createListMutation.mutate(data);
        }}
        saving={createListMutation.isPending || updateListMutation.isPending}
      />
    </>
  );
}

function RecipientListDialog({
  open,
  onOpenChange,
  listId,
  initialList,
  tenantUsers,
  groups,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listId: string | null;
  initialList?: any;
  tenantUsers: any[];
  groups: any[];
  onSave: (data: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [userIds, setUserIds] = useState<string[]>([]);
  const [externalEmails, setExternalEmails] = useState("");
  const [roleFilter, setRoleFilter] = useState<string[]>([]);
  const [autoInvite, setAutoInvite] = useState(false);
  const [autoInviteGroupId, setAutoInviteGroupId] = useState("");

  const list = listId ? initialList : undefined;

  useEffect(() => {
    if (!open) return;
    if (list) {
      setName(list.name ?? "");
      setDescription(list.description ?? "");
      setUserIds(list.user_ids ?? []);
      setExternalEmails((list.external_emails ?? []).join(", "));
      setRoleFilter(list.role_filter ?? []);
      setAutoInvite(!!list.auto_invite);
      setAutoInviteGroupId(list.auto_invite_group_id ?? "");
    } else {
      setName("");
      setDescription("");
      setUserIds([]);
      setExternalEmails("");
      setRoleFilter([]);
      setAutoInvite(false);
      setAutoInviteGroupId("");
    }
  }, [open, listId, list]);

  const handleSubmit = () => {
    const emails = externalEmails
      .split(/[,;\s]+/)
      .map((e) => e.trim())
      .filter((e) => e.includes("@"));
    onSave({
      name: name.trim() || "Unnamed list",
      description: description.trim() || undefined,
      user_ids: userIds,
      external_emails: emails,
      role_filter: roleFilter,
      is_dynamic: roleFilter.length > 0,
      auto_invite: autoInvite,
      auto_invite_group_id:
        autoInvite && autoInviteGroupId ? autoInviteGroupId : null,
    });
  };

  const toggleUser = (id: string) => {
    setUserIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleRole = (role: string) => {
    setRoleFilter((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {listId ? "Edit recipient list" : "New recipient list"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Executive team"
            />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <Label>Include users (select)</Label>
            <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1">
              {tenantUsers.slice(0, 100).map((u: any) => (
                <label
                  key={u.id}
                  className="flex items-center gap-2 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={userIds.includes(u.id)}
                    onChange={() => toggleUser(u.id)}
                  />
                  <span>
                    {u.full_name || u.email}{" "}
                    {u.email && u.full_name ? `(${u.email})` : ""}
                  </span>
                </label>
              ))}
              {tenantUsers.length === 0 && (
                <p className="text-slate-500 text-sm">No users found.</p>
              )}
            </div>
          </div>
          <div>
            <Label>Include by role</Label>
            <p className="text-xs text-slate-500 mb-1.5">
              All active users with the selected roles will be included each time a distribution is sent.
            </p>
            <div className="flex flex-wrap gap-2">
              {ROLES.map((r) => (
                <label
                  key={r.value}
                  className="flex items-center gap-1 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={roleFilter.includes(r.value)}
                    onChange={() => toggleRole(r.value)}
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label>External emails (comma-separated)</Label>
            <Input
              value={externalEmails}
              onChange={(e) => setExternalEmails(e.target.value)}
              placeholder="a@example.com, b@example.com"
            />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoInvite}
                onChange={(e) => setAutoInvite(e.target.checked)}
              />
              Auto-invite external emails as canvas-only users
            </label>
          </div>
          <div>
            <Label>Add auto-invited users to group (optional)</Label>
            <Select
              value={autoInviteGroupId || "__none__"}
              onValueChange={(v) =>
                setAutoInviteGroupId(v === "__none__" ? "" : v)
              }
              disabled={!autoInvite}
            >
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {groups.map((g: any) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {listId ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
