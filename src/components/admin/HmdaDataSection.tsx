import { useCallback, useEffect, useRef, useState } from 'react'

import {

  Card,

  CardContent,

  CardDescription,

  CardHeader,

  CardTitle,

} from '@/components/ui/card'

import { Button } from '@/components/ui/button'

import { Badge } from '@/components/ui/badge'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

import {

  Dialog,

  DialogContent,

  DialogDescription,

  DialogHeader,

  DialogTitle,

} from '@/components/ui/dialog'

import {

  Select,

  SelectContent,

  SelectItem,

  SelectTrigger,

  SelectValue,

} from '@/components/ui/select'

import {

  Table,

  TableBody,

  TableCell,

  TableRow,

} from '@/components/ui/table'

import {

  AlertTriangle,

  CheckCircle2,

  Clock,

  Database,

  HelpCircle,

  Info,

  Loader2,

  RefreshCw,

  XCircle,

} from 'lucide-react'

import { api } from '@/lib/api'

import { useToast } from '@/hooks/use-toast'



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

    availableYears: number[]

    unavailable?: number[]

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

  } | null

  warnings: Warning[]
  automation?: {
    enabled: boolean
    status: string
    recommendation: string
  }
  recommendedSchedule: Record<string, string>

}



type RefreshJob = HmdaAdminStatus['lastRefresh']

type RefreshMode = 'refresh' | 'manifest'

type ModalKey = 'details' | 'issues' | 'job' | 'help' | null



function formatWhen(iso: string | null | undefined) {

  if (!iso) return '—'

  try {

    return new Date(iso).toLocaleString()

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



function geoStatusLabel(status: HmdaAdminStatus | null) {

  if (!status) return '—'

  const src = status.geography.geo2025Source

  if (src && src.toLowerCase().includes('scaled')) return 'Scaled from prior year'

  if (status.static.yearCoverage?.geoFallbackYear) {

    return `Fallback → ${status.static.yearCoverage.geoFallbackYear}`

  }

  if (status.geoBuildReady && status.geography.drilldownExists) return 'Native MLAR'

  if (status.geography.drilldownExists) return 'Drilldown present'

  return 'No drilldown'

}



function modeLabel(mode: string | undefined) {
  if (mode === 'refresh' || mode === 'full') return 'Refresh from FFIEC source'
  if (mode === 'manifest' || mode === 'copy') return 'Rebuild manifest only'
  return mode || '—'
}

function recommendedGuidance(status: HmdaAdminStatus | null) {
  if (!status) return null

  const hasLenders = (status.static.lenderRecordCount ?? 0) > 0
  const geoScaled =
    Boolean(status.geography.geo2025Source?.toLowerCase().includes('scaled')) ||
    Boolean(status.static.yearCoverage?.geoFallbackYear)

  if (hasLenders && !status.geoBuildReady && geoScaled) {
    return {
      title: 'Recommended: verify dashboards first',
      steps: [
        'Open the HMDA DataBank (/hmda) and spot-check lender counts, rates, and a few profiles — data is already loaded.',
        'Rebuild manifest only rescans local files; it never needs the MLAR folder below.',
        'Fix 2025 maps only when geography matters: download the combined MLAR file from FFIEC and place it in the folder shown below, then run Refresh from FFIEC source (or geo-only CLI steps in the help modal).',
      ],
    }
  }

  if (hasLenders && status.geoBuildReady) {
    return {
      title: 'Recommended: refresh when filings update',
      steps: [
        'Lender and geography inputs are present. Use Rebuild manifest only after manual file edits.',
        'Run Refresh from FFIEC source during filing season to pull newer per-institution LAR data (~hours).',
        'Re-run refresh after replacing the combined MLAR file when FFIEC publishes an updated geography extract.',
      ],
    }
  }

  if (!hasLenders) {
    return {
      title: 'Recommended: load lender data first',
      steps: [
        'No lender export found for this year. Run Refresh from FFIEC source (per-institution fetch; no MLAR folder required).',
        'After lenders load, add combined MLAR for map geography if needed.',
      ],
    }
  }

  return {
    title: 'Recommended: verify, then refresh as needed',
    steps: [
      'Confirm dashboards look correct with existing static JSON.',
      'Use Rebuild manifest only for a quick local manifest rescan (no FFIEC, no MLAR).',
      'Use Refresh from FFIEC source when you need updated lender filings from FFIEC.',
    ],
  }
}

function mlarFolderStatus(status: HmdaAdminStatus | null) {
  if (!status) return ''
  const parts = [`MLAR folder: ${status.mlarDir}`]
  if (!status.mlarDirExists) parts.push('(folder not created yet — optional until you fix maps)')
  else if (!status.geoBuildReady) parts.push('(no combined file for anchor year)')
  else parts.push('(combined file ready for geography build)')
  return parts.join(' · ')
}



export function HmdaDataSection() {

  const { toast } = useToast()

  const [anchorYear, setAnchorYear] = useState('2025')

  const [status, setStatus] = useState<HmdaAdminStatus | null>(null)

  const [job, setJob] = useState<RefreshJob>(null)

  const [loading, setLoading] = useState(true)

  const [refreshing, setRefreshing] = useState(false)

  const [refreshMode, setRefreshMode] = useState<RefreshMode>('manifest')

  const [openModal, setOpenModal] = useState<ModalKey>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)



  const loadStatus = useCallback(async () => {

    try {

      const data = await api.request<HmdaAdminStatus>(`/api/admin/hmda-data/status?years=${anchorYear}`)

      setStatus(data)

      if (data.lastRefresh) setJob(data.lastRefresh)

    } catch (e) {

      toast({

        title: 'Failed to load HMDA data status',

        description: e instanceof Error ? e.message : 'Unknown error',

        variant: 'destructive',

      })

    } finally {

      setLoading(false)

    }

  }, [anchorYear, toast])



  const loadJobStatus = useCallback(async () => {

    try {

      const data = await api.request<{ job: RefreshJob }>('/api/admin/hmda-data/refresh/status')

      setJob(data.job)

      if (data.job?.status === 'running') return true

      if (data.job?.status === 'completed' || data.job?.status === 'failed') {

        await loadStatus()

      }

      return false

    } catch {

      return false

    }

  }, [loadStatus])



  useEffect(() => {

    setLoading(true)

    void loadStatus()

  }, [loadStatus])



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

        if (!stillRunning) setRefreshing(false)

      })

    }, 3000)

    return () => {

      if (pollRef.current) clearInterval(pollRef.current)

    }

  }, [refreshing, loadJobStatus])



  const handleRefresh = async () => {

    setRefreshing(true)

    try {

      const res = await api.request<{ job: RefreshJob; message: string }>('/api/admin/hmda-data/refresh', {

        method: 'POST',

        body: JSON.stringify({

          mode: refreshMode,

          anchorYear: Number(anchorYear),

        }),

      })

      setJob(res.job)

      toast({

        title: refreshMode === 'manifest' ? 'Manifest rebuild started' : 'FFIEC refresh started',

        description: res.message,

      })

    } catch (e) {

      setRefreshing(false)

      toast({

        title: 'Could not start refresh',

        description: e instanceof Error ? e.message : 'Unknown error',

        variant: 'destructive',

      })

    }

  }



  const inlineWarnings = status?.warnings?.slice(0, 2) ?? []
  const extraWarningCount = Math.max(0, (status?.warnings?.length ?? 0) - 2)
  const guidance = recommendedGuidance(status)



  if (loading && !status) {

    return (

      <div className="flex items-center justify-center py-16 text-muted-foreground">

        <Loader2 className="mr-2 h-5 w-5 animate-spin" />

        Loading HMDA data status…

      </div>

    )

  }



  return (

    <div className="space-y-6">

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

        <div>

          <h2 className="text-2xl font-semibold tracking-tight">HMDA Data</h2>

          <p className="text-sm text-muted-foreground">

            Static HMDA exports, FFIEC refresh, and geography build controls.

          </p>

        </div>

        <div className="flex flex-wrap items-center gap-2">

          <Select value={anchorYear} onValueChange={setAnchorYear}>

            <SelectTrigger className="w-[120px]">

              <SelectValue />

            </SelectTrigger>

            <SelectContent>

              {['2025', '2024', '2023', '2022'].map((y) => (

                <SelectItem key={y} value={y}>

                  {y}

                </SelectItem>

              ))}

            </SelectContent>

          </Select>

          <Button variant="outline" size="sm" onClick={() => loadStatus()} disabled={loading}>

            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}

            <span className="ml-2">Refresh status</span>

          </Button>

        </div>

      </div>



      <Card>

        <CardContent className="pt-6">

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">

            <div className="space-y-1">

              <p className="text-xs font-medium text-muted-foreground">Health</p>

              {healthBadge(status?.health ?? 'green')}

            </div>

            <div className="space-y-1">

              <p className="text-xs font-medium text-muted-foreground">Last export</p>

              <p className="text-sm font-medium">{formatWhen(status?.static.lenderExportedAt)}</p>

            </div>

            <div className="space-y-1">

              <p className="text-xs font-medium text-muted-foreground">Lenders ({anchorYear})</p>

              <p className="text-sm font-medium">

                {status?.static.lenderRecordCount?.toLocaleString() ?? '—'}

              </p>

            </div>

            <div className="space-y-1">

              <p className="text-xs font-medium text-muted-foreground">Geography</p>

              <p className="text-sm font-medium">{geoStatusLabel(status)}</p>

            </div>

            <div className="space-y-1">

              <p className="text-xs font-medium text-muted-foreground">Last sync</p>

              <div className="flex flex-wrap items-center gap-2">

                {statusBadge(job?.status)}

                {job && (

                  <Button variant="link" className="h-auto p-0 text-xs" onClick={() => setOpenModal('job')}>

                    Details

                  </Button>

                )}

              </div>

            </div>

          </div>

          <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">

            <Button variant="outline" size="sm" onClick={() => setOpenModal('details')}>

              <Database className="mr-2 h-4 w-4" /> Data details

            </Button>

            <Button variant="outline" size="sm" onClick={() => setOpenModal('issues')}>

              <AlertTriangle className="mr-2 h-4 w-4" /> Issues

              {(status?.warnings?.length ?? 0) > 0 && (

                <Badge variant="secondary" className="ml-2">

                  {status?.warnings.length}

                </Badge>

              )}

            </Button>

            <Button variant="outline" size="sm" onClick={() => setOpenModal('help')}>

              <HelpCircle className="mr-2 h-4 w-4" /> How refresh works

            </Button>

          </div>

        </CardContent>

      </Card>



      {inlineWarnings.length > 0 && (

        <div className="space-y-2">

          {inlineWarnings.map((w) => (

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

          {extraWarningCount > 0 && (

            <Button variant="link" className="h-auto p-0 text-sm" onClick={() => setOpenModal('issues')}>

              View all {status?.warnings.length} issues

            </Button>

          )}

        </div>

      )}



      <Card>

        <CardHeader className="pb-3">
          <CardTitle className="text-base">Manual sync</CardTitle>
          <CardDescription>
            Two data paths: <strong>lenders</strong> (FFIEC per-institution fetch) and{' '}
            <strong>geography</strong> (optional combined MLAR file for maps).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {guidance && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>{guidance.title}</AlertTitle>
              <AlertDescription>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                  {guidance.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
                <Button
                  variant="link"
                  className="mt-2 h-auto p-0 text-sm"
                  onClick={() => setOpenModal('help')}
                >
                  Full MLAR &amp; refresh guide
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
            <p>
              <strong className="text-foreground">What is MLAR?</strong> Modified Loan Application Register —
              FFIEC&apos;s public mortgage filing data. This app uses it two ways:
            </p>
            <p>
              <strong className="text-foreground">Per-institution files</strong> — fetched automatically during
              &quot;Refresh from FFIEC source&quot; for lender panels, rates, and product mix.{' '}
              <em>No local MLAR folder needed.</em>
            </p>
            <p>
              <strong className="text-foreground">Combined MLAR file</strong> — one large national file you
              download once into <code>{status?.mlarDir ?? 'data/hmda-mlar/'}</code> for state/county/tract
              map builds only. Missing folder is normal until you care about map accuracy.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">

            <div className="space-y-1">

              <p className="text-xs font-medium text-muted-foreground">Action</p>

              <Select value={refreshMode} onValueChange={(v) => setRefreshMode(v as RefreshMode)}>

                <SelectTrigger className="w-[260px]">

                  <SelectValue />

                </SelectTrigger>

                <SelectContent>

                  <SelectItem value="manifest">Rebuild manifest only (fast)</SelectItem>

                  <SelectItem value="refresh">Refresh from FFIEC source (slow)</SelectItem>

                </SelectContent>

              </Select>

            </div>

            <Button onClick={handleRefresh} disabled={refreshing}>

              {refreshing ? (

                <>

                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running…

                </>

              ) : (

                <>

                  <RefreshCw className="mr-2 h-4 w-4" /> Run now

                </>

              )}

            </Button>

          </div>

          <p className="text-xs text-muted-foreground">{mlarFolderStatus(status)}</p>
          {status?.automation && !status.automation.enabled && (
            <Alert className="mt-2 border-dashed">
              <Clock className="h-4 w-4" />
              <AlertTitle>Automated refresh (planned)</AlertTitle>
              <AlertDescription className="text-sm">
                {status.automation.recommendation} Until then, use manual sync above or{' '}
                <code className="text-xs">npm run hmda:refresh</code> on a build runner for production
                data updates.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>

      </Card>



      <Dialog open={openModal === 'details'} onOpenChange={(o) => setOpenModal(o ? 'details' : null)}>

        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">

          <DialogHeader>

            <DialogTitle>Data details</DialogTitle>

            <DialogDescription>Static artifacts and coverage for {anchorYear}</DialogDescription>

          </DialogHeader>

          <div className="space-y-4 text-sm">

            <div className="grid gap-2">

              <div className="flex justify-between gap-4">

                <span className="text-muted-foreground">Data directory</span>

                <span className="text-right font-mono text-xs">{status?.static.dataDir}</span>

              </div>

              <div className="flex justify-between">

                <span className="text-muted-foreground">Manifest built</span>

                <span>{formatWhen(status?.static.manifestGeneratedAt)}</span>

              </div>

              <div className="flex justify-between">

                <span className="text-muted-foreground">LAR detail max year</span>

                <span>{status?.static.larDetailMaxYear ?? '—'}</span>

              </div>

              <div className="flex justify-between">

                <span className="text-muted-foreground">Data source mode</span>

                <span>{status?.warehouseReady ? 'Warehouse DB' : 'Static JSON'}</span>

              </div>

            </div>

            <div>

              <p className="mb-2 text-xs font-medium text-muted-foreground">Rate sources</p>

              <div className="flex flex-wrap gap-1">

                {Object.entries(status?.static.rateSourceCounts || {}).map(([k, v]) => (

                  <Badge key={k} variant="secondary">

                    {k}: {v}

                  </Badge>

                ))}

              </div>

            </div>

            <div className="grid gap-2 border-t pt-3">

              <div className="flex justify-between gap-4">

                <span className="text-muted-foreground">FFIEC live for {anchorYear}</span>

                <span>{status?.ffiec.liveAvailable ? 'Yes' : 'No (static only)'}</span>

              </div>

              <div className="flex justify-between gap-4">

                <span className="text-muted-foreground shrink-0">FFIEC API years</span>

                <span className="text-right text-xs">{status?.ffiec.availableYears?.join(', ') || '—'}</span>

              </div>

              <div className="flex justify-between gap-4">

                <span className="text-muted-foreground shrink-0">Geo source</span>

                <span className="text-right text-xs">{status?.geography.geo2025Source || 'Native / unknown'}</span>

              </div>

              <div className="flex justify-between">

                <span className="text-muted-foreground">Tract manifest</span>

                <span>{formatWhen(status?.geography.tractManifest?.builtAt)}</span>

              </div>

            </div>

            <div className="border-t pt-3">

              <p className="mb-2 text-xs font-medium text-muted-foreground">Combined MLAR files</p>

              <p className="text-xs text-muted-foreground mb-1">

                Folder: <code>{status?.mlarDir}</code>

              </p>

              {status?.mlarFilesFound?.length ? (

                <ul className="list-inside list-disc text-xs">

                  {status.mlarFilesFound.map((f) => (

                    <li key={f}>{f}</li>

                  ))}

                </ul>

              ) : (

                <p className="text-xs text-muted-foreground">None found</p>

              )}

            </div>

          </div>

        </DialogContent>

      </Dialog>



      <Dialog open={openModal === 'issues'} onOpenChange={(o) => setOpenModal(o ? 'issues' : null)}>

        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">

          <DialogHeader>

            <DialogTitle>Issues &amp; recommendations</DialogTitle>

            <DialogDescription>Warnings and suggested refresh schedule</DialogDescription>

          </DialogHeader>

          {(status?.warnings?.length ?? 0) === 0 ? (

            <p className="text-sm text-muted-foreground">No issues reported.</p>

          ) : (

            <div className="space-y-2">

              {status!.warnings.map((w) => (

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

          <div className="border-t pt-4">

            <p className="mb-2 text-sm font-medium">Recommended schedule (manual for now)</p>

            <Table>

              <TableBody>

                {status &&

                  Object.entries(status.recommendedSchedule).map(([k, v]) => (

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

        </DialogContent>

      </Dialog>



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

              <div className="flex justify-between gap-4">

                <span className="text-muted-foreground shrink-0">Job ID</span>

                <span className="font-mono text-xs truncate max-w-[200px]">{job.jobId}</span>

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

              {job.triggeredBy && (

                <div className="flex justify-between">

                  <span className="text-muted-foreground">Triggered by</span>

                  <span>{job.triggeredBy}</span>

                </div>

              )}

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



      <Dialog open={openModal === 'help'} onOpenChange={(o) => setOpenModal(o ? 'help' : null)}>

        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">

          <DialogHeader>

            <DialogTitle>How refresh works</DialogTitle>

            <DialogDescription>Local pipeline — no sibling repo required</DialogDescription>

          </DialogHeader>

          <div className="space-y-4 text-sm text-muted-foreground">
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-foreground">
              <p className="font-medium mb-1">Suggested path for your environment</p>
              {guidance ? (
                <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                  {guidance.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              ) : (
                <p>Load status above to see a recommendation.</p>
              )}
            </div>

            <div>
              <p className="font-medium text-foreground mb-1">Two kinds of MLAR data</p>
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="align-top font-medium text-foreground w-[35%]">
                      Per-institution
                    </TableCell>
                    <TableCell className="text-sm">
                      ~4,800 small files from FFIEC (one per lender LEI). Powers lender search, origination
                      counts, rates, declinations. Fetched over HTTP during &quot;Refresh from FFIEC source&quot;.
                      Does <strong>not</strong> use <code>{status?.mlarDir ?? 'data/hmda-mlar/'}</code>.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="align-top font-medium text-foreground">
                      Combined (national)
                    </TableCell>
                    <TableCell className="text-sm">
                      One large file: <code>{anchorYear}_combined_mlar_header.zip</code> (or .txt). Powers
                      state/county/census-tract map layers. You download from FFIEC and place in{' '}
                      <code>{status?.mlarDir ?? 'data/hmda-mlar/'}</code>. Optional until map geography must
                      match the filing year exactly.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div>
              <p className="font-medium text-foreground mb-1">Rebuild manifest only</p>
              <p>
                Rescans files under <code>public/data/hmda/</code> and updates the year-picker manifest.
                Completes in seconds. No FFIEC calls, no MLAR folder, no lender or geo changes.
              </p>
            </div>

            <div>
              <p className="font-medium text-foreground mb-1">Refresh from FFIEC source</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Fetch modified-LAR per institution from FFIEC (resume checkpoint in .cache/hmda/)</li>
                <li>Export enriched <code>hmda-lenders-{'{year}'}-only.json</code></li>
                <li>Build paginated lender pages + lender manifest</li>
                <li>Rebuild product summaries for all years</li>
                <li>
                  Build geography from combined MLAR — <em>skipped with a log warning</em> if the file is
                  missing; lenders still update
                </li>
                <li>County enrichment, map summary, and tract feature layers</li>
                <li>Rebuild years manifest</li>
              </ol>
            </div>

            <div>
              <p className="font-medium text-foreground mb-1">Fix 2025 map geography (when needed)</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  Create folder <code>{status?.mlarDir ?? 'data/hmda-mlar/'}</code> (or set{' '}
                  <code>HMDA_MLAR_DIR</code> in .env)
                </li>
                <li>
                  Download combined modified-LAR for {anchorYear} from{' '}
                  <a
                    href={`https://ffiec.cfpb.gov/data-publication/modified-lar/${anchorYear}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    FFIEC modified-LAR {anchorYear}
                  </a>
                </li>
                <li>
                  Save as <code>{anchorYear}_combined_mlar_header.zip</code> in that folder
                </li>
                <li>Run Refresh from FFIEC source, or CLI: npm run hmda:geo -- {anchorYear}</li>
              </ol>
              <p className="mt-2">
                Until then, geography may show as &quot;scaled from prior year&quot; — lender dashboards still
                work.
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-md border p-3">
              <Clock className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                Full lender refresh can take hours (~4,800 LEIs). Jobs run in the background; see the Last
                sync job modal for log path. Test with{' '}
                <code>npm run hmda:mlar-insights -- --year={anchorYear} --limit=5 --resume</code>.
              </p>
            </div>
            {status?.automation && !status.automation.enabled && (
              <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">Automated scheduling (planned)</p>
                <p>{status.automation.recommendation}</p>
              </div>
            )}
          </div>

        </DialogContent>

      </Dialog>

    </div>

  )

}

