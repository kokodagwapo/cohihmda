import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const CACHE_DIR = path.join(REPO_ROOT, 'server/.cache/hmda-admin')
const JOB_STATE_PATH = path.join(CACHE_DIR, 'job.json')
const LOG_DIR = path.join(CACHE_DIR, 'logs')

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
  if (mode === 'refresh' || mode === 'full') return 'refresh'
  if (mode === 'manifest' || mode === 'copy') return 'manifest'
  return 'manifest'
}

/**
 * @param {'refresh'|'manifest'|'full'|'copy'} mode
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
    env: { ...process.env, HMDA_ANCHOR_YEAR: String(anchorYear) },
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
      writeJob({
        ...current,
        status: 'completed',
        finishedAt,
        message:
          normalized === 'manifest'
            ? 'Years manifest rebuilt from local static files.'
            : 'HMDA refresh completed (lenders + manifest; geo if MLAR available).',
      })
    } else {
      writeJob({
        ...current,
        status: 'failed',
        finishedAt,
        error: `Process exited with code ${code}`,
        message: 'See server log file for details.',
      })
    }
    logStream.write(`[${finishedAt}] finished exit=${code}\n`)
    logStream.end()
    runtime.child = null
  })

  return { ok: true, job: readJob() }
}

export function getHmdaRefreshJobStatus() {
  return readJob()
}
