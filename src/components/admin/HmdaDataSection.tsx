import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@/components/ui/table'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  HelpCircle,
  Info,
  Loader2,
  Map,
  RefreshCw,
  Users,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useToast } from '@/hooks/use-toast'

const HMDA_YEARS = ['2025', '2024', '2023', '2022'] as const

type Warning = {
  level: 'info' | 'warning'
  code: string
  message: string
}

type HmdaAdminStatus = {
  anchorYear: number
  checkedAt: string
  health: 'green' | 'amber' | 'red'
  dataSource: string
  warehouseReady: boolean
  mlarDir: string
  mlarDirExists: boolean
  mlarFilesFound: string[]
  geoBuildReady: boolean
  static: {
    dataDir: string
    manifestGeneratedAt: string | null
    larDetailMaxYear: number | null
    lenderExportedAt: string | null
    lenderRecordCount: number | null
    rateSourceCounts: Record<string, number>
    yearCoverage: {
      tracts?: boolean
      tractFallbackYear?: number | null
      partial?: boolean
      geo?: boolean
      geoFallbackYear?: number | null
    } | null
  }
  ffiec: {
    liveAvailable: boolean
    dataBrowserLive?: boolean
    runtimeMode?: string
    lenderSyncMethod?: string
    mlarCheckpointInstitutions?: number | null
    availableYears: number[]
    unavailable?: { year: number; reason: string }[]
  }
  geography: {
    drilldownExists: boolean
    geo2025Source: string | null
    tractManifest: {
      builtAt: string | null
      years: string[]
      tractCountsMatchPriorYear: boolean
    } | null
  }
  lastRefresh: {
    jobId: string
    mode: string
    status: string
    startedAt: string
    finishedAt: string | null
    message: string | null
    error: string | null
    triggeredBy: string | null
    logPath: string | null
    progress?: {
      step: number
      total: number
      label: string
      percent: number
    } | null
  } | null
  warnings: Warning[]
  automation?: {
    enabled: boolean
    status: string
    recommendation: string
  }
  recommendedSchedule: Record<string, string>
}

type RefreshJob = (HmdaAdminStatus['lastRefresh'] & { anchorYear?: number }) | null
type RefreshMode = 'manifest' | 'lenders' | 'geo' | 'refresh'
type ModalKey = 'details' | 'issues' | 'job' | 'help' | null

function formatWhen(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function formatWhenShort(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function statusBadge(status: string | undefined) {
  switch (status) {
    case 'running':
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Running
        </Badge>
      )
    case 'completed':
      return (
        <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
          <CheckCircle2 className="h-3 w-3" /> Completed
        </Badge>
      )
    case 'failed':
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" /> Failed
        </Badge>
      )
    default:
      return <Badge variant="outline">{status || 'Idle'}</Badge>
  }
}

function healthBadge(health: HmdaAdminStatus['health']) {
  switch (health) {
    case 'green':
      return (
        <Badge className="bg-emerald-600 hover:bg-emerald-600 gap-1">
          <CheckCircle2 className="h-3 w-3" /> Healthy
        </Badge>
      )
    case 'amber':
      return (
        <Badge variant="secondary" className="gap-1 border-amber-500 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3" /> Needs attention
        </Badge>
      )
    case 'red':
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" /> Action required
        </Badge>
      )
  }
}

function aggregateHealth(statuses: HmdaAdminStatus[]) {
  if (statuses.some((s) => s.health === 'red')) return 'red' as const
  if (statuses.some((s) => s.health === 'amber')) return 'amber' as const
  return 'green' as const
}

function geographyLabel(status: HmdaAdminStatus | null) {
  if (!status) return '—'
  const cov = status.static.yearCoverage
  if (cov?.geoFallbackYear) return `Fallback → ${cov.geoFallbackYear}`
  if (cov?.geo && cov?.tracts) return 'Maps + tracts'
  if (cov?.geo) return 'Maps ready'
  if (status.geography.drilldownExists) return 'Drilldown present'
  return 'Not built'
}

function modeLabel(mode: string | undefined) {
  if (mode === 'lenders') return 'Refresh lenders'
  if (mode === 'geo') return 'Rebuild geography'
  if (mode === 'refresh' || mode === 'full') return 'Full refresh'
  if (mode === 'manifest' || mode === 'copy') return 'Rebuild manifest'
  return mode || '—'
}

function syncStartTitle(mode: RefreshMode) {
  switch (mode) {
    case 'manifest':
      return 'Manifest rebuild started'
    case 'lenders':
      return 'Lender refresh started'
    case 'geo':
      return 'Geography rebuild started'
    case 'refresh':
      return 'Full refresh started'
    default:
      return 'Sync started'
  }
}

type SyncActionConfig = {
  label: string
  externalApi: string
  description: ReactNode
  variant: 'default' | 'outline' | 'secondary'
  icon: typeof Database
}

const SYNC_ACTIONS: Record<RefreshMode, SyncActionConfig> = {
  manifest: {
    label: 'Rebuild manifest',
    externalApi: 'No',
    variant: 'outline',
    icon: Database,
    description: (
      <>
        Scans local files in <code className="text-xs">public/data/hmda/</code> and updates the year
        manifest. Takes seconds and requires no network.
      </>
    ),
  },
  lenders: {
    label: 'Refresh lenders',
    externalApi: 'Yes — FFIEC',
    variant: 'default',
    icon: RefreshCw,
    description: (
      <>
        Downloads <strong>per-institution MLAR</strong> from{' '}
        <code className="text-xs">ffiec.cfpb.gov</code> (~4,800 LEIs, takes hours). Saves lender JSON
        to disk. For 2025, the filers list API often fails, so it uses your saved LEI roster but still
        fetches each institution&apos;s file over HTTP.
      </>
    ),
  },
  geo: {
    label: 'Rebuild geography',
    externalApi: 'No live API',
    variant: 'secondary',
    icon: RefreshCw,
    description: (
      <>
        Reads the <strong>combined MLAR zip</strong> already on disk (
        <code className="text-xs">data/hmda-mlar/&#123;year&#125;_combined_mlar_header.zip</code>) and
        builds map layers locally. You must download that file from FFIEC yourself — the button does not
        fetch it.
      </>
    ),
  },
  refresh: {
    label: 'Full refresh',
    externalApi: 'Partially',
    variant: 'outline',
    icon: RefreshCw,
    description: (
      <>
        Runs <strong>Refresh lenders</strong> (FFIEC API) + <strong>Rebuild geography</strong> (local
        zip) + <strong>manifest</strong> update.
      </>
    ),
  },
}

function SyncActionButton({
  mode,
  selectedYear,
  refreshing,
  activeSyncMode,
  disabled,
  onClick,
}: {
  mode: RefreshMode
  selectedYear: string
  refreshing: boolean
  activeSyncMode: RefreshMode | null
  disabled?: boolean
  onClick: () => void
}) {
  const action = SYNC_ACTIONS[mode]
  const Icon = action.icon
  const isRunning = refreshing && activeSyncMode === mode

  return (
    <HoverCard openDelay={200} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span className="inline-flex">
          <Button
            variant={action.variant}
            size="sm"
            disabled={disabled || refreshing}
            onClick={onClick}
          >
            {isRunning ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Icon className="mr-2 h-4 w-4" />
            )}
            {action.label}
          </Button>
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-80 space-y-3 p-3">
        <div>
          <p className="text-sm font-semibold">{action.label}</p>
          {mode === 'geo' && (
            <p className="mt-0.5 text-xs text-muted-foreground">Anchor year: {selectedYear}</p>
          )}
        </div>
        <div className="space-y-2 text-xs">
          <div className="flex gap-2">
            <span className="shrink-0 font-medium text-muted-foreground">External API?</span>
            <span>{action.externalApi}</span>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">What it does</p>
            <p className="mt-1 leading-relaxed text-foreground">{action.description}</p>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

function mlarFolderSummary(status: HmdaAdminStatus | null, year: string) {
  if (!status) return ''
  const parts = [`MLAR folder: ${status.mlarDir}`]
  if (!status.mlarDirExists) {
    parts.push('(not created — optional until geography rebuild)')
  } else if (status.geoBuildReady) {
    parts.push(`(${year} combined file ready)`)
  } else {
    const otherYears = (status.mlarFilesFound || [])
      .map((f) => f.match(/^(\d{4})/)?.[1])
      .filter((y): y is string => Boolean(y && y !== year))
    if (otherYears.length) {
      parts.push(`(no ${year} file; ${otherYears.join(', ')} on disk)`)
    } else {
      parts.push(`(no ${year} combined file)`)
    }
  }
  return parts.join(' · ')
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

function YearCard({
  year,
  status,
  selected,
  pulseSelect,
  job,
  onSelect,
  onIssues,
  onDetails,
}: {
  year: string
  status: HmdaAdminStatus | null
  selected: boolean
  pulseSelect: boolean
  job: RefreshJob
  onSelect: () => void
  onIssues: () => void
  onDetails: () => void
}) {
  const warnings = status?.warnings?.filter((w) => w.level === 'warning').length ?? 0
  const notes = status?.warnings?.filter((w) => w.level === 'info').length ?? 0
  const lastSyncForYear =
    job && String(job.anchorYear ?? '') === year ? job : null

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-lg border bg-card p-4 text-left shadow-sm transition-all duration-300 hover:bg-muted/30',
        selected &&
          'border-emerald-600 ring-2 ring-emerald-500/30 shadow-md shadow-emerald-500/15 dark:border-emerald-500 dark:ring-emerald-400/25 dark:shadow-emerald-900/30',
        pulseSelect && 'animate-year-card-select',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold tracking-tight">{year}</p>
          {status ? healthBadge(status.health) : <Badge variant="outline">Loading</Badge>}
        </div>
        {selected && (
          <Badge className="shrink-0 border-transparent bg-emerald-700 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:text-white dark:hover:bg-emerald-600">
            Selected
          </Badge>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <Metric
          label="Lenders"
          value={status?.static.lenderRecordCount?.toLocaleString() ?? '—'}
        />
        <Metric label="Last export" value={formatWhenShort(status?.static.lenderExportedAt)} />
        <Metric label="Geography" value={geographyLabel(status)} />
        <Metric
          label="Last sync"
          value={
            lastSyncForYear?.status ? (
              <span className="capitalize">{lastSyncForYear.status}</span>
            ) : (
              '—'
            )
          }
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
        {warnings > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs border-destructive/40 text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation()
              onIssues()
            }}
          >
            <AlertTriangle className="mr-1 h-3 w-3" />
            {warnings} issue{warnings === 1 ? '' : 's'}
          </Button>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
            No issues
          </span>
        )}
        {notes > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {notes} note{notes === 1 ? '' : 's'}
          </Badge>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7 text-xs"
          onClick={(e) => {
            e.stopPropagation()
            onDetails()
          }}
        >
          Details
          <ChevronRight className="ml-0.5 h-3 w-3" />
        </Button>
      </div>
    </button>
  )
}

export function HmdaDataSection() {
  const { toast } = useToast()
  const [selectedYear, setSelectedYear] = useState<string>('2025')
  const [yearStatuses, setYearStatuses] = useState<Record<string, HmdaAdminStatus>>({})
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [job, setJob] = useState<RefreshJob>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeSyncMode, setActiveSyncMode] = useState<RefreshMode | null>(null)
  const [openModal, setOpenModal] = useState<ModalKey>(null)
  const [modalYear, setModalYear] = useState<string>('2025')
  const [syncPulseKey, setSyncPulseKey] = useState(0)
  const [selectionPulseYear, setSelectionPulseYear] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevJobStatusRef = useRef<string | null>(null)
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const status = yearStatuses[selectedYear] ?? null
  const modalStatus = yearStatuses[modalYear] ?? null
  const allStatuses = HMDA_YEARS.map((y) => yearStatuses[y]).filter(Boolean) as HmdaAdminStatus[]
  const overallHealth = allStatuses.length ? aggregateHealth(allStatuses) : 'green'
  const totalLenders = allStatuses.reduce(
    (sum, s) => sum + (s.static.lenderRecordCount ?? 0),
    0,
  )
  const yearsWithData = allStatuses.filter((s) => (s.static.lenderRecordCount ?? 0) > 0).length
  const openIssues = allStatuses.reduce(
    (sum, s) => sum + s.warnings.filter((w) => w.level === 'warning').length,
    0,
  )

  const loadAllStatuses = useCallback(async () => {
    try {
      const entries = await Promise.all(
        HMDA_YEARS.map(async (year) => {
          const data = await api.request<HmdaAdminStatus>(`/api/admin/hmda-data/status?years=${year}`)
          return [year, data] as const
        }),
      )
      setYearStatuses(Object.fromEntries(entries))
      setCheckedAt(new Date().toISOString())
    } catch (e) {
      toast({
        title: 'Failed to load HMDA data status',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  const loadJobStatus = useCallback(async () => {
    try {
      const data = await api.request<{ job: RefreshJob & { anchorYear?: number } }>(
        '/api/admin/hmda-data/refresh/status',
      )
      const prev = prevJobStatusRef.current
      setJob(data.job)

      if (prev === 'running' && data.job?.status === 'completed') {
        toast({
          title: 'HMDA sync completed',
          description: data.job.message || 'Static data refresh finished successfully.',
        })
      } else if (prev === 'running' && data.job?.status === 'failed') {
        toast({
          title: 'HMDA sync failed',
          description: data.job.error || data.job.message || 'See job details for the log path.',
          variant: 'destructive',
        })
      }

      if (data.job?.status) prevJobStatusRef.current = data.job.status
      if (data.job?.status === 'running') return true
      if (data.job?.status === 'completed' || data.job?.status === 'failed') {
        await loadAllStatuses()
      }
      return false
    } catch {
      return false
    }
  }, [loadAllStatuses, toast])

  useEffect(() => {
    setLoading(true)
    void loadAllStatuses()
  }, [loadAllStatuses])

  useEffect(() => {
    void loadJobStatus().then((running) => {
      if (running) setRefreshing(true)
    })
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [loadJobStatus])

  useEffect(() => {
    if (!refreshing) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }
    pollRef.current = setInterval(() => {
      void loadJobStatus().then((stillRunning) => {
        if (!stillRunning) {
          setRefreshing(false)
          setActiveSyncMode(null)
        }
      })
    }, 2000)
    void loadJobStatus()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [refreshing, loadJobStatus])

  const handleRefresh = async (mode: RefreshMode) => {
    setRefreshing(true)
    setActiveSyncMode(mode)
    try {
      const res = await api.request<{ job: RefreshJob; message: string }>('/api/admin/hmda-data/refresh', {
        method: 'POST',
        body: JSON.stringify({ mode, anchorYear: Number(selectedYear) }),
      })
      setJob(res.job)
      if (res.job?.status) prevJobStatusRef.current = res.job.status
      toast({ title: syncStartTitle(mode), description: res.message })
      void loadJobStatus()
    } catch (e) {
      setRefreshing(false)
      setActiveSyncMode(null)
      toast({
        title: 'Could not start sync',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }

  const openYearModal = (year: string, modal: Exclude<ModalKey, null>) => {
    setModalYear(year)
    setOpenModal(modal)
  }

  const handleSelectYear = (year: string) => {
    if (year === selectedYear) return
    setSelectedYear(year)
    setSyncPulseKey((k) => k + 1)
    setSelectionPulseYear(year)
    if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current)
    pulseTimeoutRef.current = setTimeout(() => setSelectionPulseYear(null), 500)
  }

  useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current)
    }
  }, [])

  if (loading && allStatuses.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading HMDA data status…
      </div>
    )
  }

  const summaryStatus = status ?? allStatuses[0] ?? null

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">HMDA Data</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Saved JSON in <code className="text-xs">public/data/hmda/</code> powers the DataBank.
            Sync jobs fetch from FFIEC, then write to disk — the app does not call FFIEC on every page load.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => loadAllStatuses()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Refresh status</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpenModal('help')}>
            <HelpCircle className="mr-2 h-4 w-4" />
            How sync works
          </Button>
        </div>
      </div>

      {/* Overall summary */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Overview</CardTitle>
              <CardDescription>
                {checkedAt ? `Updated ${formatWhen(checkedAt)}` : 'Loading…'}
              </CardDescription>
            </div>
            {healthBadge(overallHealth)}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex gap-3 rounded-md border bg-muted/20 p-3">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Lenders across years</p>
                <p className="text-lg font-semibold">{totalLenders.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{yearsWithData} years with data</p>
              </div>
            </div>
            <div className="flex gap-3 rounded-md border bg-muted/20 p-3">
              <Database className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Runtime mode</p>
                <p className="text-sm font-medium">
                  {summaryStatus?.ffiec.runtimeMode ?? (summaryStatus?.warehouseReady ? 'database' : 'Static JSON')}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  Manifest {formatWhenShort(summaryStatus?.static.manifestGeneratedAt)}
                </p>
              </div>
            </div>
            <div className="flex gap-3 rounded-md border bg-muted/20 p-3">
              <Map className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Combined MLAR</p>
                <p className="text-sm font-medium truncate">
                  {summaryStatus?.mlarFilesFound?.length
                    ? `${summaryStatus.mlarFilesFound.length} file(s) on disk`
                    : 'None on disk'}
                </p>
                <p className="text-xs text-muted-foreground truncate">{summaryStatus?.mlarDir}</p>
              </div>
            </div>
            <div className="flex gap-3 rounded-md border bg-muted/20 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Open issues</p>
                <p className="text-lg font-semibold">{openIssues}</p>
                <p className="text-xs text-muted-foreground">Across all filing years</p>
              </div>
            </div>
          </div>

          {(refreshing || job?.status === 'running') && (
            <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium">
                  Sync in progress · {job?.anchorYear ?? selectedYear} · {modeLabel(job?.mode)}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {job?.progress
                    ? `${job.progress.percent}%${
                        job.progress.total > 1 ? ` · ${job.progress.step}/${job.progress.total}` : ''
                      }`
                    : '…'}
                </span>
              </div>
              <Progress value={job?.progress?.percent ?? 5} className="h-2" />
              <p className="text-xs text-muted-foreground">{job?.progress?.label ?? 'Starting…'}</p>
              <Button variant="link" className="h-auto p-0 text-xs" onClick={() => setOpenModal('job')}>
                View job details
              </Button>
            </div>
          )}

          {!refreshing && job?.status && job.status !== 'running' && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Last background job:</span>
              {statusBadge(job.status)}
              <span className="text-muted-foreground">
                {job.anchorYear ?? '—'} · {formatWhen(job.finishedAt ?? job.startedAt)}
              </span>
              <Button variant="link" className="h-auto p-0 text-xs" onClick={() => setOpenModal('job')}>
                Details
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-year cards */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium">Filing years</h3>
          <p className="text-xs text-muted-foreground">Select a year to run sync actions below</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {HMDA_YEARS.map((year) => (
            <YearCard
              key={year}
              year={year}
              status={yearStatuses[year] ?? null}
              selected={selectedYear === year}
              pulseSelect={selectionPulseYear === year}
              job={job}
              onSelect={() => handleSelectYear(year)}
              onIssues={() => openYearModal(year, 'issues')}
              onDetails={() => openYearModal(year, 'details')}
            />
          ))}
        </div>
      </div>

      {/* Sync for selected year */}
      <Card
        key={syncPulseKey}
        className={cn(
          syncPulseKey > 0 && 'animate-sync-panel-glow ring-1 ring-primary/30',
        )}
      >
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sync · HMDA {selectedYear}</CardTitle>
          <CardDescription>
            Batch jobs write to <code className="text-xs">public/data/hmda/</code>.{' '}
            {mlarFolderSummary(status, selectedYear)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <SyncActionButton
              mode="manifest"
              selectedYear={selectedYear}
              refreshing={refreshing}
              activeSyncMode={activeSyncMode}
              onClick={() => void handleRefresh('manifest')}
            />
            <SyncActionButton
              mode="lenders"
              selectedYear={selectedYear}
              refreshing={refreshing}
              activeSyncMode={activeSyncMode}
              onClick={() => void handleRefresh('lenders')}
            />
            <SyncActionButton
              mode="geo"
              selectedYear={selectedYear}
              refreshing={refreshing}
              activeSyncMode={activeSyncMode}
              disabled={!status?.geoBuildReady}
              onClick={() => void handleRefresh('geo')}
            />
            <SyncActionButton
              mode="refresh"
              selectedYear={selectedYear}
              refreshing={refreshing}
              activeSyncMode={activeSyncMode}
              onClick={() => void handleRefresh('refresh')}
            />
          </div>
          {!status?.geoBuildReady && (
            <p className="text-xs text-muted-foreground">
              Rebuild geography requires{' '}
              <code className="text-xs">{selectedYear}_combined_mlar_header.zip</code> in{' '}
              {status?.mlarDir ?? 'data/hmda-mlar'}.
            </p>
          )}
          {status?.ffiec.lenderSyncMethod && (
            <p className="text-xs text-muted-foreground">
              Lender data source for {selectedYear}: {status.ffiec.lenderSyncMethod}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Data details modal */}
      <Dialog
        open={openModal === 'details'}
        onOpenChange={(o) => setOpenModal(o ? 'details' : null)}
      >
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>HMDA {modalYear} · data details</DialogTitle>
            <DialogDescription>Static artifacts and FFIEC coverage</DialogDescription>
          </DialogHeader>
          {modalStatus ? (
            <div className="space-y-4 text-sm">
              <div className="grid gap-2">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Lenders</span>
                  <span>{modalStatus.static.lenderRecordCount?.toLocaleString() ?? '—'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Last export</span>
                  <span>{formatWhen(modalStatus.static.lenderExportedAt)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Geography</span>
                  <span>{geographyLabel(modalStatus)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Data directory</span>
                  <span className="text-right font-mono text-xs">{modalStatus.static.dataDir}</span>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Rate sources</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(modalStatus.static.rateSourceCounts || {}).map(([k, v]) => (
                    <Badge key={k} variant="secondary">
                      {k}: {v}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="grid gap-2 border-t pt-3">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Lender sync method</span>
                  <span className="text-right text-xs max-w-[65%]">
                    {modalStatus.ffiec.lenderSyncMethod || '—'}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Data Browser API (live)</span>
                  <span>
                    {(modalStatus.ffiec.dataBrowserLive ?? modalStatus.ffiec.liveAvailable) ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Geo build ready</span>
                  <span>{modalStatus.geoBuildReady ? 'Yes (combined MLAR on disk)' : 'No'}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No status loaded for {modalYear}.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Issues modal */}
      <Dialog open={openModal === 'issues'} onOpenChange={(o) => setOpenModal(o ? 'issues' : null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>HMDA {modalYear} · issues</DialogTitle>
            <DialogDescription>Warnings and informational notes for this filing year</DialogDescription>
          </DialogHeader>
          {(modalStatus?.warnings?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No issues reported for {modalYear}.</p>
          ) : (
            <div className="space-y-2">
              {modalStatus!.warnings.map((w) => (
                <Alert key={w.code} variant={w.level === 'warning' ? 'destructive' : 'default'}>
                  {w.level === 'warning' ? (
                    <AlertTriangle className="h-4 w-4" />
                  ) : (
                    <Info className="h-4 w-4" />
                  )}
                  <AlertTitle className="capitalize">{w.code.replace(/_/g, ' ')}</AlertTitle>
                  <AlertDescription>{w.message}</AlertDescription>
                </Alert>
              ))}
            </div>
          )}
          {modalStatus?.recommendedSchedule && (
            <div className="border-t pt-4">
              <p className="mb-2 text-sm font-medium">Suggested schedule</p>
              <Table>
                <TableBody>
                  {Object.entries(modalStatus.recommendedSchedule).map(([k, v]) => (
                    <TableRow key={k}>
                      <TableCell className="capitalize text-muted-foreground w-[40%]">
                        {k.replace(/([A-Z])/g, ' $1')}
                      </TableCell>
                      <TableCell className="text-sm">{v}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Job modal */}
      <Dialog open={openModal === 'job'} onOpenChange={(o) => setOpenModal(o ? 'job' : null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Last sync job</DialogTitle>
            <DialogDescription>Background refresh run details</DialogDescription>
          </DialogHeader>
          {job ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                {statusBadge(job.status)}
              </div>
              {job.progress && (
                <div className="space-y-2 pt-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{job.progress.label}</span>
                    <span className="tabular-nums">{job.progress.percent}%</span>
                  </div>
                  <Progress value={job.progress.percent} className="h-2" />
                </div>
              )}
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Anchor year</span>
                <span>{job.anchorYear ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mode</span>
                <span>{modeLabel(job.mode)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Started</span>
                <span>{formatWhen(job.startedAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Finished</span>
                <span>{formatWhen(job.finishedAt)}</span>
              </div>
              {job.message && <p className="text-xs text-muted-foreground pt-1">{job.message}</p>}
              {job.error && <p className="text-xs text-destructive">{job.error}</p>}
              {job.logPath && (
                <p className="text-xs text-muted-foreground pt-1">
                  Log: <code>{job.logPath}</code>
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No sync jobs recorded yet.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Help modal */}
      <Dialog open={openModal === 'help'} onOpenChange={(o) => setOpenModal(o ? 'help' : null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>How sync works</DialogTitle>
            <DialogDescription>Two FFIEC sources, one static runtime</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-muted-foreground">
            <div className="rounded-md border p-3 space-y-2">
              <p className="font-medium text-foreground">Per-institution MLAR (Refresh lenders)</p>
              <p>
                ~4,800 HTTP downloads — one modified-LAR file per lender LEI. Powers lender search,
                rates, and declinations. Works for 2025 even when the Data Browser filers API returns 400.
              </p>
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <p className="font-medium text-foreground">Combined MLAR (Rebuild geography)</p>
              <p>
                One national zip in <code>{summaryStatus?.mlarDir ?? 'data/hmda-mlar/'}</code> — powers
                state/county/tract map layers. Year on the zip must match the selected filing year.
              </p>
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <p className="font-medium text-foreground">At runtime</p>
              <p>
                The DataBank reads saved JSON via your API — not live FFIEC on every page load. Re-run sync
                when filings update.
              </p>
            </div>
            {summaryStatus?.automation && !summaryStatus.automation.enabled && (
              <Alert className="border-dashed">
                <Clock className="h-4 w-4" />
                <AlertTitle>Automated refresh (planned)</AlertTitle>
                <AlertDescription className="text-sm">
                  {summaryStatus.automation.recommendation}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
