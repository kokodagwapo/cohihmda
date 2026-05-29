import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const CACHE_DIR = path.join(REPO_ROOT, 'server/.cache/hmda-admin')
const JOB_STATE_PATH = path.join(CACHE_DIR, 'job.json')
const LOG_DIR = path.join(CACHE_DIR, 'logs')
const require = createRequire(import.meta.url)
const { clearLenderPackCache } = require('./static-lenders-store.mjs')

/** @type {{ job: object|null, child: import('child_process').ChildProcess|null }} */
const runtime = { job: null, child: null }

function ensureDirs() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

function writeJob(job) {
  ensureDirs()
  fs.writeFileSync(JOB_STATE_PATH, JSON.stringify(job, null, 2))
  runtime.job = job
}

function readJob() {
  if (runtime.job) return runtime.job
  try {
    if (fs.existsSync(JOB_STATE_PATH)) {
      runtime.job = JSON.parse(fs.readFileSync(JOB_STATE_PATH, 'utf8'))
      return runtime.job
    }
  } catch {
    /* ignore */
  }
  return null
}

/** @param {string} mode */
export function normalizeRefreshMode(mode) {
  const m = String(mode || 'manifest').toLowerCase()
  if (m === 'refresh' || m === 'full') return 'refresh'
  if (m === 'lenders' || m === 'lender') return 'lenders'
  if (m === 'geo' || m === 'geography') return 'geo'
  if (m === 'manifest' || m === 'copy') return 'manifest'
  return 'manifest'
}

function progressTotalForMode(mode) {
  switch (mode) {
    case 'manifest':
      return 1
    case 'geo':
      return 3
    case 'lenders':
      return 5
    case 'refresh':
      return 6
    default:
      return 6
  }
}

/**
 * @param {'refresh'|'manifest'|'lenders'|'geo'|'full'|'copy'} mode
 * @param {{ triggeredBy?: string, anchorYear?: number }} opts
 */
export function startHmdaRefreshJob(mode, opts = {}) {
  const normalized = normalizeRefreshMode(mode)
  const existing = readJob()
  if (existing?.status === 'running') {
    return { ok: false, error: 'A refresh job is already running', job: existing }
  }

  const jobId = randomUUID()
  const startedAt = new Date().toISOString()
  const logPath = path.join(LOG_DIR, `${jobId}.log`)
  const anchorYear = Number(opts.anchorYear) || 2025

  const job = {
    jobId,
    mode: normalized,
    anchorYear,
    status: 'running',
    startedAt,
    finishedAt: null,
    triggeredBy: opts.triggeredBy || null,
    logPath: path.relative(REPO_ROOT, logPath),
    message: null,
    error: null,
  }
  writeJob(job)

  const logStream = fs.createWriteStream(logPath, { flags: 'a' })
  logStream.write(`[${startedAt}] HMDA refresh started mode=${normalized} anchorYear=${anchorYear}\n`)

  /** @type {string[]} */
  let commandArgs
  if (normalized === 'manifest') {
    commandArgs = [
      process.execPath,
      path.join(REPO_ROOT, 'scripts/hmda/build-hmda-years-manifest.mjs'),
    ]
  } else {
    commandArgs = [
      process.execPath,
      path.join(REPO_ROOT, 'scripts/hmda/admin-refresh-pipeline.mjs'),
    ]
  }

  const child = spawn(commandArgs[0], commandArgs.slice(1), {
    cwd: REPO_ROOT,
    shell: false,
    env: {
      ...process.env,
      HMDA_ANCHOR_YEAR: String(anchorYear),
      HMDA_REFRESH_MODE: normalized,
    },
    windowsHide: true,
  })

  runtime.child = child

  const appendLog = (chunk) => {
    logStream.write(chunk)
  }

  child.stdout?.on('data', appendLog)
  child.stderr?.on('data', appendLog)

  child.on('error', (err) => {
    const finishedAt = new Date().toISOString()
    writeJob({
      ...readJob(),
      status: 'failed',
      finishedAt,
      error: err.message,
      message: 'Refresh process failed to start',
    })
    logStream.end()
    runtime.child = null
  })

  child.on('close', (code) => {
    const finishedAt = new Date().toISOString()
    const current = readJob()
    if (!current || current.jobId !== jobId) {
      logStream.end()
      runtime.child = null
      return
    }
    if (code === 0) {
      if (normalized === 'lenders' || normalized === 'refresh' || normalized === 'manifest') {
        clearLenderPackCache(anchorYear)
      }
      writeJob({
        ...current,
        status: 'completed',
        finishedAt,
        message: completedMessage(current, normalized),
      })
    } else {
      writeJob({
        ...current,
        status: 'failed',
        finishedAt,
        error: extractLogError(current.logPath) || `Process exited with code ${code}`,
        message: 'See server log file for details.',
      })
    }
    logStream.write(`[${finishedAt}] finished exit=${code}\n`)
    logStream.end()
    runtime.child = null
  })

  return { ok: true, job: readJob() }
}

const PROGRESS_RE = /\[HMDA_PROGRESS\] (\d+)\/(\d+) (.+)/g

function extractLogError(logPath) {
  if (!logPath) return null
  try {
    const abs = path.isAbsolute(logPath) ? logPath : path.join(REPO_ROOT, logPath)
    const lines = fs.readFileSync(abs, 'utf8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (!line) continue
      if (
        line.includes('failed:') ||
        line.includes('Access Denied') ||
        /HTTP 403/.test(line) ||
        line.includes('Error:')
      ) {
        return line.replace(/^\[[^\]]+\]\s*/, '').slice(0, 400)
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

function completedMessage(job, normalized) {
  try {
    const abs = path.join(REPO_ROOT, job.logPath)
    const log = fs.readFileSync(abs, 'utf8')
    const geoSkipped = /SKIP geo steps: no combined MLAR/.test(log)
    if (geoSkipped && normalized === 'geo') {
      return `Manifest rebuilt only — no combined MLAR file for ${job.anchorYear}. Geography was not changed. Switch Admin year to one with a file in data/hmda-mlar, or add ${job.anchorYear}_combined_mlar_header.zip.`
    }
    if (geoSkipped && normalized === 'refresh') {
      return `Lender refresh completed for ${job.anchorYear}. Geography skipped — no combined MLAR file for that year.`
    }
    if (log.includes('geo-only fallback')) {
      return 'Geography and manifest rebuilt. Lender refresh skipped — FFIEC API was unreachable from this server (often HTTP 403).'
    }
    if (log.includes('(geo pipeline)')) {
      return `Geography and manifest rebuilt for ${job.anchorYear || 'anchor year'}. Map JSON updated in public/data/hmda/.`
    }
    if (log.includes('(lenders pipeline)')) {
      if (log.includes('from static JSON')) {
        return `Lender refresh completed for ${job.anchorYear || 'anchor year'} using static LEI roster (FFIEC filers API unavailable for this year).`
      }
      return `Lender data refreshed from FFIEC for ${job.anchorYear || 'anchor year'} and saved to public/data/hmda/.`
    }
  } catch {
    /* ignore */
  }
  if (normalized === 'manifest') {
    return 'Years manifest rebuilt from local static files.'
  }
  if (normalized === 'geo') {
    return `Geography rebuild completed for ${job.anchorYear || 'anchor year'}.`
  }
  if (normalized === 'lenders') {
    return `Lender refresh completed for ${job.anchorYear || 'anchor year'}.`
  }
  return 'Full HMDA refresh completed (lenders + geography when MLAR present + manifest).'
}

/** @param {ReturnType<typeof readJob>} job */
function parseJobProgress(job) {
  if (!job) return null
  const totalDefault = progressTotalForMode(job.mode)
  if (job.status === 'completed') {
    return {
      step: totalDefault,
      total: totalDefault,
      label: 'Complete',
      percent: 100,
    }
  }

  const fallback = {
    step: 0,
    total: totalDefault,
    label: job.status === 'failed' ? 'Stopped' : 'Starting…',
    percent: job.status === 'failed' ? 0 : 2,
  }

  if (!job.logPath) return fallback

  try {
    const abs = path.isAbsolute(job.logPath) ? job.logPath : path.join(REPO_ROOT, job.logPath)
    if (!fs.existsSync(abs)) return fallback
    const text = fs.readFileSync(abs, 'utf8')
    let match
    let last = null
    while ((match = PROGRESS_RE.exec(text)) !== null) {
      last = match
    }
    if (!last) return fallback
    const step = Number(last[1])
    const total = Number(last[2]) || totalDefault
    const label = String(last[3] || '').trim() || fallback.label
    const ratio = total > 0 ? step / total : 0
    const percent =
      job.status === 'running'
        ? Math.min(99, Math.max(2, Math.round(ratio * 100)))
        : job.status === 'failed'
          ? Math.min(99, Math.max(0, Math.round(ratio * 100)))
          : 100
    return { step, total, label, percent }
  } catch {
    return fallback
  }
}

export function getHmdaRefreshJobStatus() {
  const job = readJob()
  if (!job) return null
  const progress = parseJobProgress(job)
  return progress ? { ...job, progress } : job
}
