import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Play,
  Building2,
  Search,
  Filter,
  Database,
  History,
  ChevronDown,
  ChevronUp,
  Plus,
  ArrowUpDown,
  BarChart3,
  Sparkles,
  ScrollText,
  ChevronDown as ChevronDownIcon,
  Pencil,
} from 'lucide-react';
import {
  SyncScheduleDialog,
  type SyncSchedulePatch,
} from '@/components/admin/SyncScheduleDialog';

interface SyncConnection {
  id: string;
  name: string;
  los_type: string;
  connection_method: string;
  sync_enabled: boolean;
  sync_frequency: string;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  last_loan_modified_at: string | null;
  is_active: boolean;
  insights_auto_enabled: boolean;
  podcast_auto_enabled: boolean;
  encompass_users_sync_enabled?: boolean;
  sync_business_days_only?: boolean;
  insights_business_days_only?: boolean;
  scheduler_timezone?: string;
  sync_allowed_weekdays?: number[];
  sync_allowed_hours?: number[];
  last_encompass_users_sync_at?: string | null;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  loan_count: number;
}

interface SyncHistoryEntry {
  id: string;
  los_connection_id: string;
  sync_type: string;
  status: string;
  loans_added: number;
  loans_updated: number;
  loans_unchanged: number;
  loans_failed: number;
  total_loans_after: number;
  modified_from: string | null;
  duration_ms: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

interface HookRun {
  id: number;
  sync_history_id: number | null;
  hook_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface LogEvent {
  timestamp: number;
  message: string;
  logStreamName?: string;
}

interface HookRunLogs {
  loading: boolean;
  events: LogEvent[];
  error: string | null;
}

interface SchedulerInfo {
  interval_minutes: number;
  next_run_estimate: string;
}

interface TenantOption {
  id: string;
  name: string;
  slug: string;
}

interface PodcastSettings {
  nightly_enabled: boolean;
  nightly_last_run_at: string | null;
}

const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour);
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const BUSINESS_WEEKDAYS = [1, 2, 3, 4, 5];
const ALL_HOURS = HOUR_OPTIONS;
const BUSINESS_HOURS = Array.from({ length: 10 }, (_, index) => index + 8);

const SCHEDULER_TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (America/New_York)' },
  { value: 'America/Chicago', label: 'Central (America/Chicago)' },
  { value: 'America/Denver', label: 'Mountain (America/Denver)' },
  { value: 'America/Los_Angeles', label: 'Pacific (America/Los_Angeles)' },
  { value: 'UTC', label: 'UTC' },
];

function schedulerTimezoneSelectOptions(current?: string | null) {
  const cur = (current && current.trim()) || 'America/New_York';
  if (SCHEDULER_TIMEZONE_OPTIONS.some((o) => o.value === cur)) {
    return SCHEDULER_TIMEZONE_OPTIONS;
  }
  return [{ value: cur, label: `${cur} (custom)` }, ...SCHEDULER_TIMEZONE_OPTIONS];
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getStatusBadge(status: string | null, isActive: boolean) {
  if (!isActive) {
    return (
      <Badge variant="outline" className="text-slate-500 border-slate-300 dark:border-slate-600">
        Inactive
      </Badge>
    );
  }
  switch (status) {
    case 'success':
      return (
        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Success
        </Badge>
      );
    case 'in_progress':
      return (
        <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-0">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Syncing
        </Badge>
      );
    case 'failed':
    case 'error':
      return (
        <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-0">
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    case 'partial':
      return (
        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Partial
        </Badge>
      );
    case 'interrupted':
      return (
        <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 border-0">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Interrupted
        </Badge>
      );
    case 'pending':
      return (
        <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400 border-0">
          <Clock className="h-3 w-3 mr-1" />
          Pending
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-slate-500 border-slate-300 dark:border-slate-600">
          {status || 'No sync yet'}
        </Badge>
      );
  }
}

// Composite key to uniquely identify a connection across tenants
// (connection UUIDs can collide when tenants are duplicated)
function connKey(c: { tenant_id: string; id: string }): string {
  return `${c.tenant_id}:${c.id}`;
}

function normalizeScheduleNumbers(values: number[] | null | undefined, fallback: number[]): number[] {
  return Array.isArray(values) && values.length > 0
    ? [...new Set(values.map(Number))].sort((a, b) => a - b)
    : fallback;
}

function formatScheduleSummary(connection: SyncConnection): string {
  const weekdays = normalizeScheduleNumbers(connection.sync_allowed_weekdays, ALL_WEEKDAYS);
  const hours = normalizeScheduleNumbers(connection.sync_allowed_hours, ALL_HOURS);
  const dayLabel = weekdays.length === 7
    ? 'All days'
    : weekdays.length === 5 && BUSINESS_WEEKDAYS.every((day) => weekdays.includes(day))
      ? 'Weekdays'
      : WEEKDAY_OPTIONS.filter((day) => weekdays.includes(day.value)).map((day) => day.label).join(', ');
  const hourLabel = hours.length === 24
    ? 'All hours'
    : hours.length <= 4
      ? hours.map((hour) => `${hour}:00`).join(', ')
      : `${hours[0]}:00-${hours[hours.length - 1]}:00`;

  return `${dayLabel}, ${hourLabel} ${connection.scheduler_timezone || 'America/New_York'}`;
}

export const SyncManagementSection = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<SyncConnection[]>([]);
  const [scheduler, setScheduler] = useState<SchedulerInfo | null>(null);
  const [totalTenants, setTotalTenants] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTenant, setFilterTenant] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [triggeringIds, setTriggeringIds] = useState<Set<string>>(new Set());
  const [runningInsightIds, setRunningInsightIds] = useState<Set<string>>(new Set());
  const [hookRunLogs, setHookRunLogs] = useState<Record<number, HookRunLogs>>({});
  const [expandedLogRunId, setExpandedLogRunId] = useState<number | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [scheduleEditorConnection, setScheduleEditorConnection] = useState<SyncConnection | null>(null);
  const [historyData, setHistoryData] = useState<Record<string, SyncHistoryEntry[]>>({});
  const [historyLoading, setHistoryLoading] = useState<Set<string>>(new Set());
  const [hookRunData, setHookRunData] = useState<Record<string, HookRun[]>>({});
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [podcastSettings, setPodcastSettings] = useState<PodcastSettings>({
    nightly_enabled: false,
    nightly_last_run_at: null,
  });
  const [podcastTenantId, setPodcastTenantId] = useState<string>('');
  const [updatingPodcastSettings, setUpdatingPodcastSettings] = useState(false);
  const [generatingPodcast, setGeneratingPodcast] = useState(false);
  const [podcastJobId, setPodcastJobId] = useState<number | null>(null);
  const [podcastJobTenantId, setPodcastJobTenantId] = useState<string>('');
  const [podcastJobStatus, setPodcastJobStatus] = useState<'idle' | 'pending' | 'processing' | 'complete' | 'failed'>('idle');
  const [podcastJobMessage, setPodcastJobMessage] = useState<string>('');
  const podcastPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async (showSpinner = true) => {
    try {
      if (showSpinner) setLoading(true);
      const response = await api.request<{
        connections: SyncConnection[];
        scheduler: SchedulerInfo;
        total_tenants: number;
        tenants?: TenantOption[];
        podcast?: PodcastSettings;
      }>('/api/admin/sync-management');

      setConnections(response.connections);
      setScheduler(response.scheduler);
      setTotalTenants(response.total_tenants);
      const nextTenants = response.tenants || [];
      setTenants(nextTenants);
      if (!podcastTenantId && nextTenants.length > 0) {
        setPodcastTenantId(nextTenants[0].id);
      }
      if (response.podcast) {
        setPodcastSettings(response.podcast);
      }
    } catch (error: any) {
      console.error('Error loading sync management data:', error);
      if (showSpinner) {
        toast({
          title: 'Error',
          description: 'Failed to load sync management data',
          variant: 'destructive',
        });
      }
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [toast, podcastTenantId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-poll every 5s when any connection is actively syncing
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasSyncingRef = useRef(false);
  const hasSyncInProgress = connections.some(c => c.last_sync_status === 'in_progress');

  // When sync transitions from in_progress -> done, refresh history for the expanded connection
  useEffect(() => {
    if (wasSyncingRef.current && !hasSyncInProgress && expandedKey) {
      const conn = connections.find(c => connKey(c) === expandedKey);
      if (conn) fetchHistory(conn);
    }
    wasSyncingRef.current = hasSyncInProgress;
  }, [hasSyncInProgress, expandedKey, connections]);

  useEffect(() => {
    if (hasSyncInProgress) {
      pollingRef.current = setInterval(() => {
        loadData(false);
      }, 5000);
    } else if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [hasSyncInProgress, loadData]);

  const handleToggleSync = async (connection: SyncConnection) => {
    const newEnabled = !connection.sync_enabled;
    const key = connKey(connection);
    setUpdatingIds(prev => new Set(prev).add(key));

    try {
      await api.request(`/api/admin/sync-management/${connection.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          tenant_id: connection.tenant_id,
          sync_enabled: newEnabled,
        }),
      });

      setConnections(prev =>
        prev.map(c =>
          connKey(c) === key ? { ...c, sync_enabled: newEnabled } : c
        )
      );

      toast({
        title: newEnabled ? 'Auto-sync enabled' : 'Auto-sync disabled',
        description: `${connection.name} (${connection.tenant_name})`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update sync setting',
        variant: 'destructive',
      });
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleToggleInsights = async (connection: SyncConnection) => {
    const newEnabled = !connection.insights_auto_enabled;
    const key = connKey(connection);
    setUpdatingIds(prev => new Set(prev).add(key));

    try {
      await api.request(`/api/admin/sync-management/${connection.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          tenant_id: connection.tenant_id,
          insights_auto_enabled: newEnabled,
        }),
      });

      setConnections(prev =>
        prev.map(c =>
          connKey(c) === key ? { ...c, insights_auto_enabled: newEnabled } : c
        )
      );

      toast({
        title: newEnabled ? 'Auto-insights enabled' : 'Auto-insights disabled',
        description: `${connection.name} (${connection.tenant_name})`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update insights setting',
        variant: 'destructive',
      });
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleTogglePodcast = async (connection: SyncConnection) => {
    const newEnabled = !connection.podcast_auto_enabled;
    const key = connKey(connection);
    setUpdatingIds(prev => new Set(prev).add(key));

    try {
      await api.request(`/api/admin/sync-management/${connection.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          tenant_id: connection.tenant_id,
          podcast_auto_enabled: newEnabled,
        }),
      });

      setConnections(prev =>
        prev.map(c =>
          connKey(c) === key ? { ...c, podcast_auto_enabled: newEnabled } : c
        )
      );

      toast({
        title: newEnabled ? 'Auto-podcast enabled' : 'Auto-podcast disabled',
        description: `${connection.name} (${connection.tenant_name})`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update podcast setting',
        variant: 'destructive',
      });
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleToggleEncompassUsersAfterLoanSync = async (connection: SyncConnection) => {
    if (connection.los_type !== 'encompass') return;
    const newVal = !(connection.encompass_users_sync_enabled ?? true);
    const key = connKey(connection);
    setUpdatingIds(prev => new Set(prev).add(key));
    try {
      await api.request(`/api/admin/sync-management/${connection.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          tenant_id: connection.tenant_id,
          encompass_users_sync_enabled: newVal,
        }),
      });
      setConnections(prev =>
        prev.map(c =>
          connKey(c) === key ? { ...c, encompass_users_sync_enabled: newVal } : c
        )
      );
      toast({
        title: newVal ? 'User cache sync enabled' : 'User cache sync disabled',
        description: connection.name,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update setting',
        variant: 'destructive',
      });
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleToggleBusinessDaysLoanSync = async (connection: SyncConnection) => {
    const newVal = !(connection.sync_business_days_only ?? false);
    const key = connKey(connection);
    setUpdatingIds(prev => new Set(prev).add(key));
    try {
      await api.request(`/api/admin/sync-management/${connection.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          tenant_id: connection.tenant_id,
          sync_business_days_only: newVal,
        }),
      });
      setConnections(prev =>
        prev.map(c =>
          connKey(c) === key ? { ...c, sync_business_days_only: newVal } : c
        )
      );
      toast({
        title: newVal ? 'Business-day loan sync enabled' : 'Business-day loan sync disabled',
        description: 'Applies to automatic scheduler only',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update setting',
        variant: 'destructive',
      });
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleToggleBusinessDaysInsights = async (connection: SyncConnection) => {
    const newVal = !(connection.insights_business_days_only ?? false);
    const key = connKey(connection);
    setUpdatingIds(prev => new Set(prev).add(key));
    try {
      await api.request(`/api/admin/sync-management/${connection.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          tenant_id: connection.tenant_id,
          insights_business_days_only: newVal,
        }),
      });
      setConnections(prev =>
        prev.map(c =>
          connKey(c) === key ? { ...c, insights_business_days_only: newVal } : c
        )
      );
      toast({
        title: newVal ? 'Business-day insights enabled' : 'Business-day insights disabled',
        description: 'Scheduled-trigger post-sync hooks only',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update setting',
        variant: 'destructive',
      });
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleSchedulerTimezoneChange = async (connection: SyncConnection, tz: string) => {
    const key = connKey(connection);
    setUpdatingIds(prev => new Set(prev).add(key));
    try {
      await api.request(`/api/admin/sync-management/${connection.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          tenant_id: connection.tenant_id,
          scheduler_timezone: tz,
        }),
      });
      setConnections(prev =>
        prev.map(c => (connKey(c) === key ? { ...c, scheduler_timezone: tz } : c))
      );
      toast({ title: 'Timezone updated', description: tz });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update timezone',
        variant: 'destructive',
      });
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleScheduleWindowChange = async (
    connection: SyncConnection,
    patch: Partial<Pick<SyncConnection, 'sync_allowed_weekdays' | 'sync_allowed_hours' | 'sync_business_days_only'>>,
  ) => {
    const key = connKey(connection);
    setUpdatingIds(prev => new Set(prev).add(key));
    try {
      await api.request(`/api/admin/sync-management/${connection.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          tenant_id: connection.tenant_id,
          ...patch,
        }),
      });
      setConnections(prev =>
        prev.map(c => (connKey(c) === key ? { ...c, ...patch } : c))
      );
      toast({
        title: 'Schedule window updated',
        description: `${connection.name} (${connection.tenant_name})`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update schedule window',
        variant: 'destructive',
      });
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // Persists every scheduling field in one PUT so the dialog can save
  // frequency + timezone + weekdays + hours atomically.
  const handleScheduleDialogSave = async (
    connection: SyncConnection,
    patch: SyncSchedulePatch,
  ) => {
    const key = connKey(connection);
    setUpdatingIds(prev => new Set(prev).add(key));
    try {
      await api.request(`/api/admin/sync-management/${connection.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          tenant_id: connection.tenant_id,
          sync_frequency: patch.sync_frequency,
          scheduler_timezone: patch.scheduler_timezone,
          sync_allowed_weekdays: patch.sync_allowed_weekdays,
          sync_allowed_hours: patch.sync_allowed_hours,
          sync_business_days_only: patch.sync_business_days_only,
        }),
      });
      setConnections(prev =>
        prev.map(c =>
          connKey(c) === key
            ? {
                ...c,
                sync_frequency: patch.sync_frequency,
                scheduler_timezone: patch.scheduler_timezone,
                sync_allowed_weekdays: patch.sync_allowed_weekdays,
                sync_allowed_hours: patch.sync_allowed_hours,
                sync_business_days_only: patch.sync_business_days_only,
              }
            : c,
        ),
      );
      toast({
        title: 'Schedule updated',
        description: `${connection.name} (${connection.tenant_name})`,
      });
      setScheduleEditorConnection(null);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update schedule',
        variant: 'destructive',
      });
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleTriggerSync = async (connection: SyncConnection, fullSync: boolean = false) => {
    const key = connKey(connection);
    if (fullSync) {
      const confirmed = window.confirm(
        'Full sync will re-fetch all loans from the LOS (no date filter). Use this after adding new field mappings to backfill data. Continue?'
      );
      if (!confirmed) return;
    }
    setTriggeringIds(prev => new Set(prev).add(key));

    try {
      const response = await api.request<{ success: boolean; message: string }>(
        `/api/admin/sync-management/${connection.id}/trigger`,
        {
          method: 'POST',
          body: JSON.stringify({
            tenant_id: connection.tenant_id,
            fullSync,
          }),
        }
      );

      // Update local state to show in_progress — only for the exact connection
      setConnections(prev =>
        prev.map(c =>
          connKey(c) === key ? { ...c, last_sync_status: 'in_progress' } : c
        )
      );

      toast({
        title: fullSync ? 'Full sync triggered' : 'Sync triggered',
        description: response.message || (fullSync ? `Full sync started for ${connection.name} (${connection.tenant_name})` : `Sync started for ${connection.name} (${connection.tenant_name})`),
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to trigger sync',
        variant: 'destructive',
      });
    } finally {
      setTriggeringIds(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleRunInsights = async (connection: SyncConnection) => {
    const key = connKey(connection);
    setRunningInsightIds(prev => new Set(prev).add(key));
    try {
      await api.request<{ success: boolean; message: string }>(
        `/api/admin/sync-management/${connection.id}/run-insights`,
        {
          method: 'POST',
          body: JSON.stringify({ tenant_id: connection.tenant_id }),
        }
      );
      toast({
        title: 'Insight generation started',
        description: `Running agent insights for ${connection.name} (${connection.tenant_name}). Results will appear in the insights section shortly.`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to start insight generation',
        variant: 'destructive',
      });
    } finally {
      setRunningInsightIds(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleViewLogs = async (run: HookRun, connection: SyncConnection) => {
    const runId = run.id;
    // Toggle off if already showing
    if (expandedLogRunId === runId) {
      setExpandedLogRunId(null);
      return;
    }
    setExpandedLogRunId(runId);
    // Don't re-fetch if already loaded
    if (hookRunLogs[runId]?.events.length) return;

    setHookRunLogs(prev => ({ ...prev, [runId]: { loading: true, events: [], error: null } }));
    try {
      const params = new URLSearchParams({
        tenant_id: connection.tenant_id,
        hook_run_id: String(runId),
      });
      const data = await api.request<{ events: LogEvent[]; count: number; error?: string }>(
        `/api/admin/logs/insights?${params}`
      );
      if (data.error) {
        setHookRunLogs(prev => ({ ...prev, [runId]: { loading: false, events: [], error: data.error! } }));
      } else {
        setHookRunLogs(prev => ({ ...prev, [runId]: { loading: false, events: data.events, error: null } }));
      }
    } catch (err: any) {
      setHookRunLogs(prev => ({
        ...prev,
        [runId]: { loading: false, events: [], error: err.message || 'Failed to fetch logs' },
      }));
    }
  };

  const handleToggleNightlyPodcast = async (enabled: boolean) => {
    setUpdatingPodcastSettings(true);
    try {
      await api.request('/api/admin/sync-management/podcast/settings', {
        method: 'PUT',
        body: JSON.stringify({
          nightly_enabled: enabled,
        }),
      });
      setPodcastSettings(prev => ({ ...prev, nightly_enabled: enabled }));
      toast({
        title: enabled ? 'Nightly podcast enabled' : 'Nightly podcast disabled',
        description: enabled
          ? 'Nightly Cohi podcast generation is now ON.'
          : 'Nightly Cohi podcast generation is now OFF.',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update nightly podcast setting',
        variant: 'destructive',
      });
    } finally {
      setUpdatingPodcastSettings(false);
    }
  };

  const stopPodcastPolling = useCallback(() => {
    if (podcastPollRef.current) {
      clearInterval(podcastPollRef.current);
      podcastPollRef.current = null;
    }
  }, []);

  const pollPodcastJob = useCallback(async (tenantId: string, jobId: number) => {
    try {
      const resp = await api.request<{
        jobId: number;
        status: string;
        progress: number;
        message: string;
        error?: string;
        completedAt?: string;
      }>(`/api/admin/sync-management/podcast/job/${tenantId}/${jobId}`);

      setPodcastJobMessage(resp.message || '');

      if (resp.status === 'complete') {
        setPodcastJobStatus('complete');
        stopPodcastPolling();
        setGeneratingPodcast(false);
        const tenant = tenants.find(t => t.id === tenantId);
        toast({ title: 'Podcast generated and stored', description: tenant?.name || 'Tenant' });
        loadData(false);
      } else if (resp.status === 'failed') {
        setPodcastJobStatus('failed');
        stopPodcastPolling();
        setGeneratingPodcast(false);
        toast({ title: 'Podcast generation failed', description: resp.error || resp.message, variant: 'destructive' });
      } else {
        setPodcastJobStatus(resp.status === 'processing' ? 'processing' : 'pending');
      }
    } catch {
      // Transient fetch error, keep polling
    }
  }, [tenants, toast, loadData, stopPodcastPolling]);

  const handleGeneratePodcast = async () => {
    if (!podcastTenantId) {
      toast({ title: 'Select a tenant', description: 'Choose a tenant before generating a podcast.', variant: 'destructive' });
      return;
    }
    setGeneratingPodcast(true);
    setPodcastJobStatus('pending');
    setPodcastJobMessage('Enqueuing job...');
    stopPodcastPolling();

    try {
      const response = await api.request<{ success: boolean; jobId: number; tenant_id: string }>(
        '/api/admin/sync-management/podcast/generate',
        { method: 'POST', body: JSON.stringify({ tenant_id: podcastTenantId }) }
      );

      setPodcastJobId(response.jobId);
      setPodcastJobTenantId(podcastTenantId);
      setPodcastJobMessage('Waiting for worker to pick up job...');

      podcastPollRef.current = setInterval(() => {
        pollPodcastJob(podcastTenantId, response.jobId);
      }, 3000);
      // Immediate first poll after a short delay
      setTimeout(() => pollPodcastJob(podcastTenantId, response.jobId), 1500);
    } catch (error: any) {
      setPodcastJobStatus('failed');
      setPodcastJobMessage(error.message || 'Failed to enqueue');
      setGeneratingPodcast(false);
      toast({ title: 'Error', description: error.message || 'Failed to start podcast generation', variant: 'destructive' });
    }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => stopPodcastPolling();
  }, [stopPodcastPolling]);

  // Helper to fetch history and hook run status for a connection
  const fetchHistory = async (connection: SyncConnection) => {
    const key = connKey(connection);
    setHistoryLoading(prev => new Set(prev).add(key));
    try {
      const [histResponse, hookResponse] = await Promise.all([
        api.request<{ history: SyncHistoryEntry[] }>(
          `/api/admin/sync-management/${connection.id}/history?tenant_id=${connection.tenant_id}&limit=10`
        ),
        api.request<{ hookRuns: HookRun[] }>(
          `/api/admin/sync-management/${connection.id}/hook-status?tenant_id=${connection.tenant_id}&limit=20`
        ).catch((err: any) => {
          console.error('[SyncManagement] hook-status fetch failed:', err?.message ?? err);
          return { hookRuns: [] as HookRun[] };
        }),
      ]);
      setHistoryData(prev => ({ ...prev, [key]: histResponse.history }));
      setHookRunData(prev => ({ ...prev, [key]: hookResponse.hookRuns }));
    } catch {
      setHistoryData(prev => ({ ...prev, [key]: [] }));
    } finally {
      setHistoryLoading(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const toggleHistory = async (connection: SyncConnection) => {
    const key = connKey(connection);
    if (expandedKey === key) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(key);

    await fetchHistory(connection);
  };

  // Derive unique tenant names for the filter dropdown
  const tenantNames = [...new Set(connections.map(c => c.tenant_name))].sort();

  // Filter connections
  const filteredConnections = connections.filter(c => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      if (
        !c.name.toLowerCase().includes(term) &&
        !c.tenant_name.toLowerCase().includes(term) &&
        !c.los_type.toLowerCase().includes(term)
      ) {
        return false;
      }
    }
    if (filterTenant !== 'all' && c.tenant_name !== filterTenant) return false;
    if (filterStatus === 'enabled' && !c.sync_enabled) return false;
    if (filterStatus === 'disabled' && c.sync_enabled) return false;
    if (filterStatus === 'error' && c.last_sync_status !== 'failed' && c.last_sync_status !== 'error') return false;
    return true;
  });

  // Summary stats
  const stats = {
    total: connections.length,
    autoSyncEnabled: connections.filter(c => c.sync_enabled).length,
    activeConnections: connections.filter(c => c.is_active).length,
    failedSyncs: connections.filter(c => c.last_sync_status === 'failed' || c.last_sync_status === 'error').length,
    totalLoans: connections.reduce((sum, c) => sum + (c.loan_count || 0), 0),
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Section Header */}
      <div className="flex items-center justify-between p-6 rounded-2xl bg-gradient-to-br from-cyan-50 via-white to-blue-50 dark:from-slate-800/50 dark:to-slate-900/50 border border-cyan-200/40 dark:border-slate-700/50 shadow-lg shadow-cyan-500/10">
        <div>
          <h2 className="text-4xl font-thin text-slate-900 dark:text-white tracking-tight mb-2">
            Sync Management
          </h2>
          <p className="text-base text-slate-600 dark:text-slate-400 font-extralight tracking-wide">
            Manage LOS connection sync schedules across all tenants
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadData}
          disabled={loading}
          className="font-light"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
          <CardContent className="p-4">
            <div className="text-sm text-slate-500 dark:text-slate-400 font-light">Tenants</div>
            <div className="text-2xl font-thin text-slate-900 dark:text-white mt-1">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : totalTenants}
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
          <CardContent className="p-4">
            <div className="text-sm text-slate-500 dark:text-slate-400 font-light">Connections</div>
            <div className="text-2xl font-thin text-slate-900 dark:text-white mt-1">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : `${stats.activeConnections} / ${stats.total}`}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">active / total</div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
          <CardContent className="p-4">
            <div className="text-sm text-slate-500 dark:text-slate-400 font-light">Auto-Sync On</div>
            <div className="text-2xl font-thin text-emerald-600 dark:text-emerald-400 mt-1">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : stats.autoSyncEnabled}
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
          <CardContent className="p-4">
            <div className="text-sm text-slate-500 dark:text-slate-400 font-light">Failed Syncs</div>
            <div className={`text-2xl font-thin mt-1 ${stats.failedSyncs > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : stats.failedSyncs}
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
          <CardContent className="p-4">
            <div className="text-sm text-slate-500 dark:text-slate-400 font-light">Total Loans</div>
            <div className="text-2xl font-thin text-slate-900 dark:text-white mt-1">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : stats.totalLoans.toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Scheduler Info */}
      {scheduler && (
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
          <CardContent className="p-4 flex items-center gap-4">
            <Clock className="h-5 w-5 text-slate-400" />
            <div className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Scheduler runs every <span className="font-medium text-slate-900 dark:text-white">{scheduler.interval_minutes} minutes</span>.
              {' '}Connections are synced when overdue based on their configured frequency.
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
        <CardHeader>
          <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
            Cohi Podcast Generation
          </CardTitle>
          <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
            Platform-admin controls for manual generation and nightly auto-generation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                checked={podcastSettings.nightly_enabled}
                onCheckedChange={handleToggleNightlyPodcast}
                disabled={updatingPodcastSettings}
                className="data-[state=checked]:bg-violet-500"
              />
              <span className="text-sm font-light text-slate-700 dark:text-slate-300">
                Nightly generation
              </span>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-light">
              Last nightly run: {formatRelativeTime(podcastSettings.nightly_last_run_at)}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={podcastTenantId} onValueChange={setPodcastTenantId}>
              <SelectTrigger className="w-[260px] h-9 text-sm font-light">
                <SelectValue placeholder="Select tenant" />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((tenant) => (
                  <SelectItem key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="default"
              size="sm"
              onClick={handleGeneratePodcast}
              disabled={generatingPodcast || !podcastTenantId}
              className="font-light"
            >
              {generatingPodcast ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Generate and Store Podcast
            </Button>
          </div>
          {podcastJobStatus !== 'idle' && (
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-700/50">
              {(podcastJobStatus === 'pending' || podcastJobStatus === 'processing') && (
                <Loader2 className="h-4 w-4 animate-spin text-blue-500 flex-shrink-0" />
              )}
              {podcastJobStatus === 'complete' && (
                <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
              )}
              {podcastJobStatus === 'failed' && (
                <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
              )}
              <span className={`text-sm font-light ${
                podcastJobStatus === 'complete' ? 'text-emerald-700 dark:text-emerald-400'
                  : podcastJobStatus === 'failed' ? 'text-red-700 dark:text-red-400'
                  : 'text-slate-600 dark:text-slate-400'
              }`}>
                {podcastJobMessage}
              </span>
              {podcastJobStatus === 'failed' && (
                <Button variant="ghost" size="sm" onClick={handleGeneratePodcast} className="ml-auto h-7 text-xs font-light">
                  Retry
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connections Table */}
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
        <CardHeader>
          <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Database className="h-5 w-5" />
            All Connections
          </CardTitle>
          <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
            {filteredConnections.length} connection{filteredConnections.length !== 1 ? 's' : ''} shown
          </CardDescription>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search connections..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9 text-sm font-light"
              />
            </div>
            <Select value={filterTenant} onValueChange={setFilterTenant}>
              <SelectTrigger className="w-[180px] h-9 text-sm font-light">
                <Building2 className="h-3.5 w-3.5 mr-1.5 text-slate-400" />
                <SelectValue placeholder="All tenants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tenants</SelectItem>
                {tenantNames.map(name => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[160px] h-9 text-sm font-light">
                <Filter className="h-3.5 w-3.5 mr-1.5 text-slate-400" />
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="enabled">Auto-Sync On</SelectItem>
                <SelectItem value="disabled">Auto-Sync Off</SelectItem>
                <SelectItem value="error">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : filteredConnections.length === 0 ? (
            <div className="text-center py-12">
              <Database className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" strokeWidth={1.5} />
              <p className="text-sm text-slate-500 dark:text-slate-400 font-light">
                {connections.length === 0
                  ? 'No LOS connections found across any tenant'
                  : 'No connections match your filters'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-light text-xs">Tenant</TableHead>
                    <TableHead className="font-light text-xs">Connection</TableHead>
                    <TableHead className="font-light text-xs">Type</TableHead>
                    <TableHead className="font-light text-xs">Loans</TableHead>
                    <TableHead className="font-light text-xs">Last Sync</TableHead>
                    <TableHead className="font-light text-xs">Status</TableHead>
                    <TableHead className="font-light text-xs">Schedule</TableHead>
                    <TableHead className="font-light text-xs text-center">Auto-Sync</TableHead>
                    <TableHead className="font-light text-xs text-center">Auto-Insights</TableHead>
                    <TableHead className="font-light text-xs text-center">Auto-Podcast</TableHead>
                    <TableHead className="font-light text-xs text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredConnections.map((connection) => {
                    const key = connKey(connection);
                    const isExpanded = expandedKey === key;
                    const history = historyData[key] || [];
                    const hookRuns = hookRunData[key] || [];
                    const isLoadingHistory = historyLoading.has(key);
                    const selectedWeekdays = normalizeScheduleNumbers(connection.sync_allowed_weekdays, ALL_WEEKDAYS);
                    const selectedHours = normalizeScheduleNumbers(connection.sync_allowed_hours, ALL_HOURS);
                    return (
                    <Fragment key={key}><TableRow className="group">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                          <span className="text-sm font-light text-slate-700 dark:text-slate-300 truncate max-w-[140px]">
                            {connection.tenant_name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm font-light text-slate-900 dark:text-white">
                          {connection.name}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-light capitalize">
                          {connection.los_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm font-light text-slate-600 dark:text-slate-400">
                          {(connection.loan_count || 0).toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-light text-slate-600 dark:text-slate-400" title={connection.last_synced_at || 'Never'}>
                          {formatRelativeTime(connection.last_synced_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(connection.last_sync_status, connection.is_active)}
                        {connection.last_sync_error && (connection.last_sync_status === 'failed' || connection.last_sync_status === 'error' || connection.last_sync_status === 'interrupted') && (
                          <div className="text-xs text-red-500 dark:text-red-400 mt-1 max-w-[200px] truncate" title={connection.last_sync_error}>
                            {connection.last_sync_error}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          className="h-auto min-h-8 w-[200px] justify-start gap-2 px-2.5 py-1.5 text-left text-xs font-light"
                          onClick={() => setScheduleEditorConnection(connection)}
                          disabled={updatingIds.has(connKey(connection))}
                          title="Edit schedule (frequency, days, hours, timezone)"
                        >
                          <Pencil className="h-3 w-3 shrink-0 text-slate-400" />
                          <div className="flex min-w-0 flex-col leading-tight">
                            <span className="text-xs font-medium capitalize text-slate-700 dark:text-slate-200">
                              {connection.sync_frequency || 'daily'}
                            </span>
                            <span className="truncate text-[10px] text-slate-400">
                              {formatScheduleSummary(connection)}
                            </span>
                          </div>
                        </Button>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={connection.sync_enabled}
                          onCheckedChange={() => handleToggleSync(connection)}
                          disabled={updatingIds.has(connKey(connection)) || !connection.is_active}
                          className="data-[state=checked]:bg-emerald-500"
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={connection.insights_auto_enabled ?? true}
                          onCheckedChange={() => handleToggleInsights(connection)}
                          disabled={updatingIds.has(connKey(connection)) || !connection.is_active}
                          className="data-[state=checked]:bg-violet-500"
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={connection.podcast_auto_enabled ?? true}
                          onCheckedChange={() => handleTogglePodcast(connection)}
                          disabled={updatingIds.has(connKey(connection)) || !connection.is_active}
                          className="data-[state=checked]:bg-violet-500"
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => handleTriggerSync(connection)}
                            disabled={
                              triggeringIds.has(key) ||
                              connection.last_sync_status === 'in_progress' ||
                              !connection.is_active
                            }
                            title="Sync now (incremental)"
                          >
                            {triggeringIds.has(key) || connection.last_sync_status === 'in_progress' ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </Button>
                          {connection.los_type === 'encompass' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                              onClick={() => handleTriggerSync(connection, true)}
                              disabled={
                                triggeringIds.has(key) ||
                                connection.last_sync_status === 'in_progress' ||
                                !connection.is_active
                              }
                              title="Full sync (re-fetch all loans; use after adding new fields)"
                            >
                              <BarChart3 className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
                            onClick={() => handleRunInsights(connection)}
                            disabled={
                              runningInsightIds.has(key) ||
                              !connection.is_active
                            }
                            title="Run insights now (without sync)"
                          >
                            {runningInsightIds.has(key) ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Sparkles className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => toggleHistory(connection)}
                            title="Sync history"
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <History className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${key}-history`}>
                        <TableCell colSpan={11} className="p-0 bg-slate-50/50 dark:bg-slate-900/30">
                          <div className="px-6 py-4 space-y-5">
                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 p-4 space-y-4">
                              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Scheduler &amp; policies
                              </div>
                              <p className="text-xs text-slate-500 dark:text-slate-400 font-light leading-relaxed">
                                Business-day options affect the automatic 15-minute scheduler and scheduled-trigger
                                post-sync insight hooks only. Manual sync and manual triggers still run any day.
                              </p>
                              {connection.los_type === 'encompass' && (
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                  <div className="space-y-0.5">
                                    <Label className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                      Sync Encompass users after loan sync
                                    </Label>
                                    <p className="text-xs text-slate-500 font-light">
                                      Keeps actor status and last-login data current for reporting.
                                    </p>
                                  </div>
                                  <Switch
                                    checked={connection.encompass_users_sync_enabled ?? true}
                                    onCheckedChange={() =>
                                      handleToggleEncompassUsersAfterLoanSync(connection)
                                    }
                                    disabled={updatingIds.has(key) || !connection.is_active}
                                    className="data-[state=checked]:bg-sky-500 shrink-0"
                                  />
                                </div>
                              )}
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <div className="space-y-0.5">
                                  <Label className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                    Run automatic loan sync on business days only
                                  </Label>
                                  <p className="text-xs text-slate-500 font-light">
                                    Scheduler skips Saturday/Sunday in the timezone below.
                                  </p>
                                </div>
                                <Switch
                                  checked={connection.sync_business_days_only ?? false}
                                  onCheckedChange={() => handleToggleBusinessDaysLoanSync(connection)}
                                  disabled={updatingIds.has(key) || !connection.is_active}
                                  className="data-[state=checked]:bg-amber-500 shrink-0"
                                />
                              </div>
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <div className="space-y-0.5">
                                  <Label className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                    Generate automatic insights on business days only
                                  </Label>
                                  <p className="text-xs text-slate-500 font-light">
                                    Applies to post-sync prediction/agent/tracked hooks from scheduled syncs only.
                                  </p>
                                </div>
                                <Switch
                                  checked={connection.insights_business_days_only ?? false}
                                  onCheckedChange={() => handleToggleBusinessDaysInsights(connection)}
                                  disabled={updatingIds.has(key) || !connection.is_active}
                                  className="data-[state=checked]:bg-violet-500 shrink-0"
                                />
                              </div>
                              <div className="space-y-2 max-w-md">
                                <Label className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                  Scheduler timezone
                                </Label>
                                <Select
                                  value={connection.scheduler_timezone || 'America/New_York'}
                                  onValueChange={(val) =>
                                    handleSchedulerTimezoneChange(connection, val)
                                  }
                                  disabled={updatingIds.has(key) || !connection.is_active}
                                >
                                  <SelectTrigger className="h-9 text-xs font-light">
                                    <SelectValue placeholder="Timezone" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {schedulerTimezoneSelectOptions(connection.scheduler_timezone).map(
                                      (opt) => (
                                        <SelectItem
                                          key={opt.value}
                                          value={opt.value}
                                          className="text-xs"
                                        >
                                          {opt.label}
                                        </SelectItem>
                                      ),
                                    )}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <Label className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                    Allowed sync days
                                  </Label>
                                  <div className="flex gap-1">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs font-light"
                                      onClick={() => handleScheduleWindowChange(connection, {
                                        sync_allowed_weekdays: ALL_WEEKDAYS,
                                        sync_business_days_only: false,
                                      })}
                                      disabled={updatingIds.has(key) || !connection.is_active}
                                    >
                                      All days
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs font-light"
                                      onClick={() => handleScheduleWindowChange(connection, {
                                        sync_allowed_weekdays: BUSINESS_WEEKDAYS,
                                        sync_business_days_only: true,
                                      })}
                                      disabled={updatingIds.has(key) || !connection.is_active}
                                    >
                                      Weekdays
                                    </Button>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {WEEKDAY_OPTIONS.map((day) => {
                                    const active = selectedWeekdays.includes(day.value);
                                    return (
                                      <Button
                                        key={day.value}
                                        type="button"
                                        variant={active ? 'default' : 'outline'}
                                        size="sm"
                                        className="h-8 min-w-12 text-xs font-light"
                                        disabled={updatingIds.has(key) || !connection.is_active || (active && selectedWeekdays.length === 1)}
                                        onClick={() => {
                                          const nextDays = active
                                            ? selectedWeekdays.filter((value) => value !== day.value)
                                            : [...selectedWeekdays, day.value].sort((a, b) => a - b);
                                          handleScheduleWindowChange(connection, {
                                            sync_allowed_weekdays: nextDays,
                                            sync_business_days_only: nextDays.length === 5 && BUSINESS_WEEKDAYS.every((value) => nextDays.includes(value)),
                                          });
                                        }}
                                      >
                                        {day.label}
                                      </Button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <Label className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                    Allowed sync hours
                                  </Label>
                                  <div className="flex gap-1">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs font-light"
                                      onClick={() => handleScheduleWindowChange(connection, { sync_allowed_hours: ALL_HOURS })}
                                      disabled={updatingIds.has(key) || !connection.is_active}
                                    >
                                      All hours
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs font-light"
                                      onClick={() => handleScheduleWindowChange(connection, { sync_allowed_hours: BUSINESS_HOURS })}
                                      disabled={updatingIds.has(key) || !connection.is_active}
                                    >
                                      8 AM-5 PM
                                    </Button>
                                  </div>
                                </div>
                                <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-12 gap-1.5">
                                  {HOUR_OPTIONS.map((hour) => {
                                    const active = selectedHours.includes(hour);
                                    const label = hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`;
                                    return (
                                      <Button
                                        key={hour}
                                        type="button"
                                        variant={active ? 'default' : 'outline'}
                                        size="sm"
                                        className="h-8 text-xs font-light"
                                        disabled={updatingIds.has(key) || !connection.is_active || (active && selectedHours.length === 1)}
                                        onClick={() => {
                                          const nextHours = active
                                            ? selectedHours.filter((value) => value !== hour)
                                            : [...selectedHours, hour].sort((a, b) => a - b);
                                          handleScheduleWindowChange(connection, { sync_allowed_hours: nextHours });
                                        }}
                                      >
                                        {label}
                                      </Button>
                                    );
                                  })}
                                </div>
                              </div>
                              {connection.los_type === 'encompass' && (
                                <div className="text-xs text-slate-500 font-light">
                                  <span className="font-medium text-slate-600 dark:text-slate-300">
                                    Last Encompass user cache sync:{' '}
                                  </span>
                                  {formatRelativeTime(connection.last_encompass_users_sync_at ?? null)}
                                </div>
                              )}
                            </div>
                            {/* Sync History */}
                            <div>
                              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                                Sync History
                              </div>
                              {isLoadingHistory ? (
                                <div className="flex items-center gap-2 py-4">
                                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                                  <span className="text-sm text-slate-400 font-light">Loading history...</span>
                                </div>
                              ) : history.length === 0 ? (
                                <p className="text-sm text-slate-400 font-light py-2">No sync history yet</p>
                              ) : (
                                <div className="space-y-2">
                                  {history.map((entry) => (
                                    <div
                                      key={entry.id}
                                      className="flex items-center gap-4 text-sm py-2 px-3 rounded-lg bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50"
                                    >
                                      <span className="text-slate-500 dark:text-slate-400 font-light w-[100px] flex-shrink-0" title={entry.started_at}>
                                        {formatRelativeTime(entry.started_at)}
                                      </span>
                                      <Badge
                                        variant="outline"
                                        className={`text-[10px] w-[80px] justify-center flex-shrink-0 ${
                                          entry.sync_type === 'incremental'
                                            ? 'text-blue-600 border-blue-200 dark:text-blue-400 dark:border-blue-800'
                                            : 'text-purple-600 border-purple-200 dark:text-purple-400 dark:border-purple-800'
                                        }`}
                                      >
                                        {entry.sync_type}
                                      </Badge>
                                      <div className="flex items-center gap-3 font-light flex-1 min-w-0">
                                        {entry.loans_added > 0 && (
                                          <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                                            <Plus className="h-3 w-3" />{entry.loans_added} new
                                          </span>
                                        )}
                                        {entry.loans_updated > 0 && (
                                          <span className="text-blue-600 dark:text-blue-400 flex items-center gap-0.5">
                                            <ArrowUpDown className="h-3 w-3" />{entry.loans_updated} updated
                                          </span>
                                        )}
                                        {(entry.loans_unchanged ?? 0) > 0 && (
                                          <span className="text-slate-400 dark:text-slate-500 text-xs">
                                            {entry.loans_unchanged} unchanged
                                          </span>
                                        )}
                                        {entry.loans_failed > 0 && (
                                          <span className="text-red-600 dark:text-red-400">
                                            {entry.loans_failed} failed
                                          </span>
                                        )}
                                        {entry.loans_added === 0 && entry.loans_updated === 0 && entry.loans_failed === 0 && (
                                          <span className="text-slate-400">No changes</span>
                                        )}
                                      </div>
                                      <span className="text-slate-400 font-light flex-shrink-0">
                                        {(entry.total_loans_after || 0).toLocaleString()} total
                                      </span>
                                      <span className="text-slate-400 font-light w-[60px] text-right flex-shrink-0">
                                        {entry.duration_ms ? `${Math.round(entry.duration_ms / 1000)}s` : '—'}
                                      </span>
                                      {entry.status === 'success' ? (
                                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                                      ) : entry.status === 'partial' ? (
                                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                                      ) : (
                                        <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Post-Sync Pipeline Status */}
                            {!isLoadingHistory && hookRuns.length > 0 && (
                              <div>
                                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                                  Post-Sync Pipeline
                                </div>
                                <div className="space-y-1.5">
                                  {hookRuns.map((run) => {
                                    const hookLabel: Record<string, string> = {
                                      'prediction-pipeline': 'Predictions',
                                      'agent-insight-generation': 'Insights',
                                      'manual-insight-generation': 'Insights (Manual)',
                                      'tracked-insight-evaluation': 'Tracked Insights',
                                      'podcast-auto-generation': 'Podcast',
                                      'demo-tenant-auto-refresh': 'Demo Refresh',
                                    };
                                    const label = hookLabel[run.hook_name] ?? run.hook_name;
                                    const insightCount = typeof run.metadata?.insightCount === 'number'
                                      ? run.metadata.insightCount
                                      : typeof run.metadata?.insight_count === 'number'
                                        ? run.metadata.insight_count
                                        : null;
                                    const podcastJobId = run.metadata?.podcast_job_id;
                                    const isLogEligible = [
                                      'agent-insight-generation',
                                      'manual-insight-generation',
                                      'prediction-pipeline',
                                      'tracked-insight-evaluation',
                                      'podcast-auto-generation',
                                    ].includes(run.hook_name);
                                    const logsState = hookRunLogs[run.id];
                                    const logsExpanded = expandedLogRunId === run.id;
                                    return (
                                      <div key={run.id} className="rounded-md border border-slate-100 dark:border-slate-700/50 overflow-hidden">
                                        <div className="flex items-center gap-3 text-xs py-1.5 px-3 bg-white dark:bg-slate-800/50">
                                          <span className="text-slate-500 dark:text-slate-400 font-light w-[80px] flex-shrink-0" title={run.created_at}>
                                            {formatRelativeTime(run.created_at)}
                                          </span>
                                          <span className="font-medium text-slate-700 dark:text-slate-300 w-[145px] flex-shrink-0">
                                            {label}
                                          </span>
                                          <div className="flex-1 min-w-0 font-light text-slate-500 dark:text-slate-400 truncate">
                                            {run.status === 'running' && (
                                              <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                                                <Loader2 className="h-3 w-3 animate-spin" /> Running…
                                              </span>
                                            )}
                                            {run.status === 'completed' && insightCount !== null && (
                                              <span>{insightCount} insights generated</span>
                                            )}
                                            {run.status === 'completed' && podcastJobId && (
                                              <span>Job #{String(podcastJobId)} enqueued</span>
                                            )}
                                            {run.status === 'completed' && insightCount === null && !podcastJobId && (
                                              <span className="text-emerald-600 dark:text-emerald-400">Done</span>
                                            )}
                                            {run.status === 'failed' && run.error_message && (
                                              <span className="text-red-500 dark:text-red-400 truncate" title={run.error_message}>
                                                {run.error_message}
                                              </span>
                                            )}
                                            {run.status === 'skipped' && (
                                              <span className="text-slate-400">Disabled for this connection</span>
                                            )}
                                          </div>
                                          <span className="text-slate-400 font-light flex-shrink-0 w-[45px] text-right">
                                            {run.duration_ms != null ? `${Math.round(run.duration_ms / 1000)}s` : '—'}
                                          </span>
                                          {run.status === 'completed' ? (
                                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                                          ) : run.status === 'running' ? (
                                            <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin flex-shrink-0" />
                                          ) : run.status === 'failed' ? (
                                            <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                                          ) : (
                                            <Clock className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                                          )}
                                          {isLogEligible && (run.status === 'completed' || run.status === 'failed') && (
                                            <button
                                              onClick={() => handleViewLogs(run, connection)}
                                              className="flex items-center gap-1 text-slate-400 hover:text-violet-500 dark:hover:text-violet-400 transition-colors flex-shrink-0"
                                              title="View CloudWatch logs for this run"
                                            >
                                              <ScrollText className="h-3.5 w-3.5" />
                                              <ChevronDownIcon className={`h-3 w-3 transition-transform ${logsExpanded ? 'rotate-180' : ''}`} />
                                            </button>
                                          )}
                                        </div>
                                        {logsExpanded && (
                                          <div className="border-t border-slate-100 dark:border-slate-700/50 bg-slate-950 text-slate-200 font-mono text-[10px] leading-relaxed p-3 max-h-64 overflow-y-auto">
                                            {logsState?.loading && (
                                              <div className="flex items-center gap-2 text-slate-400">
                                                <Loader2 className="h-3 w-3 animate-spin" /> Fetching CloudWatch logs…
                                              </div>
                                            )}
                                            {logsState?.error && (
                                              <div className="text-amber-400">
                                                {logsState.error.includes('not available')
                                                  ? 'CloudWatch not available in this environment (no AWS credentials).'
                                                  : logsState.error}
                                              </div>
                                            )}
                                            {!logsState?.loading && !logsState?.error && logsState?.events.length === 0 && (
                                              <div className="text-slate-500">No log events found for this time window.</div>
                                            )}
                                            {logsState?.events.map((evt, i) => (
                                              <div key={i} className="whitespace-pre-wrap break-all">
                                                <span className="text-slate-500 select-none mr-2">
                                                  {new Date(evt.timestamp).toISOString().replace('T', ' ').replace('Z', '')}
                                                </span>
                                                {evt.message}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <SyncScheduleDialog
        open={scheduleEditorConnection !== null}
        onOpenChange={(next) => {
          if (!next) setScheduleEditorConnection(null);
        }}
        connection={scheduleEditorConnection}
        saving={
          scheduleEditorConnection
            ? updatingIds.has(connKey(scheduleEditorConnection))
            : false
        }
        onSave={async (patch) => {
          if (!scheduleEditorConnection) return;
          await handleScheduleDialogSave(scheduleEditorConnection, patch);
        }}
      />
    </motion.div>
  );
};
