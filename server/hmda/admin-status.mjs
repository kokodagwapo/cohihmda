import fs from 'node:fs'

import path from 'node:path'

import { fileURLToPath } from 'node:url'

import { loadYearsManifest } from './years-manifest.mjs'

import { loadLenderPack } from './static-lenders-store.mjs'

import { resolveHmdaYearWindow } from './years-service.mjs'

import { createFfiecCache } from './ffiec-client.mjs'

import { HMDA_DEFAULT_ANCHOR_YEAR } from './years-service.mjs'

import { useHmdaWarehouse, isWarehouseReady } from './data-source.mjs'

import { HMDA_DATA_DIR, HMDA_MLAR_DIR, findCombinedMlarFile } from '../../scripts/hmda/paths.mjs'



const __dirname = path.dirname(fileURLToPath(import.meta.url))

const REPO_ROOT = path.resolve(__dirname, '../..')

const DATA_DIR = HMDA_DATA_DIR

const JOB_STATE_PATH = path.join(REPO_ROOT, 'server/.cache/hmda-admin/job.json')



function readJsonSafe(filePath) {

  try {

    if (!fs.existsSync(filePath)) return null

    return JSON.parse(fs.readFileSync(filePath, 'utf8'))

  } catch {

    return null

  }

}



function countRateSources(lenders) {

  const counts = {}

  for (const l of lenders || []) {

    const k = String(l.rateSource || 'missing')

    counts[k] = (counts[k] || 0) + 1

  }

  return counts

}



function scanMlarFiles() {

  if (!fs.existsSync(HMDA_MLAR_DIR)) return []

  return fs

    .readdirSync(HMDA_MLAR_DIR)

    .filter((f) => /^\d{4}_combined_mlar_header\.(txt|zip)$/.test(f))

    .sort()

}



function readGeoDrilldownMeta() {

  const drillPath = path.join(DATA_DIR, 'geo-drilldown-from-hmda.json')

  const raw = readJsonSafe(drillPath)

  if (!raw) return { exists: false, meta: null, geo2025Source: null }

  const meta = raw.meta || {}

  return {

    exists: true,

    meta,

    geo2025Source: meta['2025Source'] || meta[`${HMDA_DEFAULT_ANCHOR_YEAR}Source`] || null,

  }

}



function readTractManifestSummary() {

  const manifest = readJsonSafe(path.join(DATA_DIR, 'geo-map/tracts/manifest.json'))

  if (!manifest?.files) return null

  const years = Object.keys(manifest.files).filter((y) => /^\d{4}$/.test(y)).sort()

  const sample = years.length >= 2 ? years[years.length - 1] : null

  const prev = years.length >= 2 ? years[years.length - 2] : null

  let tractCountsMatchPriorYear = false

  if (sample && prev && manifest.files[sample]?.states?.CA != null) {

    tractCountsMatchPriorYear =

      manifest.files[sample].states.CA === manifest.files[prev].states.CA

  }

  return {

    builtAt: manifest.builtAt || null,

    years,

    tractCountsMatchPriorYear,

  }

}



export function readLastRefreshJob() {

  return readJsonSafe(JOB_STATE_PATH)

}

function formatWhen(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function readMlarInsightsCheckpointSummary(year) {
  const filePath = path.join(REPO_ROOT, '.cache/hmda/mlar-insights', `mlar-insights-${year}.json`)
  const raw = readJsonSafe(filePath)
  if (!raw?.byLei || typeof raw.byLei !== 'object') return null
  const institutionCount = Object.keys(raw.byLei).length
  if (!institutionCount) return null
  return { institutionCount, checkpointPath: path.relative(REPO_ROOT, filePath) }
}

function describeLenderSyncMethod({ year, dataBrowserLive, hasStaticLenders, mlarCheckpoint, rateSourceCounts, lastRefresh }) {
  const mlarRates = Number(rateSourceCounts?.['hmda-mlar'] || 0)
  if (
    lastRefresh?.status === 'completed' &&
    Number(lastRefresh.anchorYear) === Number(year) &&
    (lastRefresh.mode === 'lenders' || lastRefresh.mode === 'refresh')
  ) {
    return `Per-institution modified-LAR batch (${formatWhen(lastRefresh.finishedAt)})`
  }
  if (mlarCheckpoint?.institutionCount || mlarRates > 0) {
    const n = mlarCheckpoint?.institutionCount || mlarRates
    return `Per-institution modified-LAR batch (${n.toLocaleString()} institutions in checkpoint/export)`
  }
  if (dataBrowserLive && hasStaticLenders) {
    return 'Data Browser API filers list (live queries also available at runtime when enabled)'
  }
  if (hasStaticLenders) return 'Static JSON on disk (source unknown — run Refresh lenders to sync from FFIEC)'
  return 'Not loaded — run Refresh lenders'
}



/** @param {number} [anchorYear] */

export async function getHmdaAdminStatus(anchorYear = HMDA_DEFAULT_ANCHOR_YEAR) {

  const year = Number(anchorYear) || HMDA_DEFAULT_ANCHOR_YEAR

  const manifest = loadYearsManifest()

  const yearRow = manifest?.years?.[String(year)] || null



  let lenderPack = null

  let rateSourceCounts = {}

  try {

    lenderPack = await loadLenderPack(year)

    rateSourceCounts = countRateSources(lenderPack.lenders)

  } catch (e) {

    lenderPack = { error: e.message }

  }



  let ffiecWindow = null

  try {

    const cache = createFfiecCache(60_000)

    ffiecWindow = await resolveHmdaYearWindow(year, 0, cache)

  } catch (e) {

    ffiecWindow = { error: e.message }

  }



  const geo = readGeoDrilldownMeta()

  const tractManifest = readTractManifestSummary()

  const mlarFilesFound = scanMlarFiles()

  const geoBuildReady = Boolean(findCombinedMlarFile(year))

  const mlarDirExists = fs.existsSync(HMDA_MLAR_DIR)



  let warehouseReady = false

  try {

    warehouseReady = useHmdaWarehouse() && (await isWarehouseReady())

  } catch {

    warehouseReady = false

  }

  const lastJob = readLastRefreshJob()
  const dataBrowserLive = Boolean(ffiecWindow?.available?.includes(year))
  const mlarCheckpoint = readMlarInsightsCheckpointSummary(year)
  const hasStaticLenders = Boolean(yearRow?.lenders && (yearRow?.lenderCount ?? 0) > 0)
  const lenderSyncMethod = describeLenderSyncMethod({
    year,
    dataBrowserLive,
    hasStaticLenders,
    mlarCheckpoint,
    rateSourceCounts,
    lastRefresh: lastJob,
  })

  const warnings = []

  if (!dataBrowserLive) {

    const hasStaticGeo = Boolean(yearRow?.geo && !yearRow?.partial)

    const ffiecReason = ffiecWindow?.unavailable?.find((u) => u.year === year)?.reason

    let message

    if (hasStaticLenders || hasStaticGeo) {

      message = `Live FFIEC Data Browser API does not serve ${year} yet (or is unreachable from this server). Static JSON for ${year} is already deployed — the app uses that.`

    } else {

      message = `FFIEC Data Browser API does not serve ${year} yet — static MLAR exports are required.`

    }

    if (ffiecReason && /HTTP 403|Access Denied|timed out/i.test(ffiecReason)) {

      message = `FFIEC API probe failed for ${year} (${ffiecReason}). ${

        hasStaticLenders || hasStaticGeo

          ? 'Static JSON for this year is deployed and in use.'

          : 'Deploy static MLAR exports for this year.'

      }`

    }

    warnings.push({

      level: 'info',

      code: 'ffiec_year_unavailable',

      message,

    })

  }

  if (geo.geo2025Source && String(geo.geo2025Source).toLowerCase().includes('scaled')) {

    warnings.push({

      level: 'warning',

      code: 'geo_scaled',

      message: `Geography for ${year} is scaled from prior year, not built from combined MLAR.`,

    })

  }

  if (
    yearRow?.tractFallbackYear &&
    Number(yearRow.tractFallbackYear) < Number(year)
  ) {

    warnings.push({

      level: 'warning',

      code: 'tract_fallback',

      message: `Census tract layer for ${year} falls back to ${yearRow.tractFallbackYear}.`,

    })

  }

  if (rateSourceCounts.estimated > 0) {

    warnings.push({

      level: 'info',

      code: 'estimated_rates',

      message: `${rateSourceCounts.estimated} lender(s) use estimated rates (no MLAR median).`,

    })

  }

  if (!geoBuildReady) {
    const hasStaticGeo = Boolean(yearRow?.geo)
    if (!hasStaticGeo) {
      const mlarYearsOnDisk = mlarFilesFound
        .map((f) => Number(f.match(/^(\d{4})/)?.[1]))
        .filter(Number.isFinite)
        .sort((a, b) => b - a)
      const otherMlarYears = mlarYearsOnDisk.filter((y) => y !== year)
      const mlarDirLabel = path.relative(REPO_ROOT, HMDA_MLAR_DIR)

      let message = `No combined MLAR file for ${year} in ${mlarDirLabel} — Rebuild geography cannot run for this anchor year.`
      if (otherMlarYears.length) {
        message += ` Combined MLAR on disk: ${otherMlarYears.join(', ')} — switch Admin year to match or download ${year} from FFIEC.`
      } else {
        message += ' Download the combined modified-LAR from FFIEC to enable geography rebuild.'
      }
      warnings.push({
        level: 'warning',
        code: 'mlar_geo_missing',
        message,
      })
    }
  }



  const health =

    lastJob?.status === 'failed'

      ? 'red'

      : warnings.some((w) => w.level === 'warning')

        ? 'amber'

        : 'green'



  return {

    anchorYear: year,

    checkedAt: new Date().toISOString(),

    health,

    dataSource: warehouseReady ? 'database' : 'static',

    warehouseReady,

    mlarDir: path.relative(REPO_ROOT, HMDA_MLAR_DIR),

    mlarDirExists,

    mlarFilesFound,

    geoBuildReady,

    static: {

      dataDir: path.relative(REPO_ROOT, DATA_DIR),

      manifestGeneratedAt: manifest?.generatedAt || null,

      larDetailMaxYear: manifest?.larDetailMaxYear ?? null,

      lenderExportedAt: lenderPack?.meta?.exportedAt || null,

      lenderRecordCount: lenderPack?.meta?.recordCount ?? lenderPack?.lenders?.length ?? null,

      rateSourceCounts,

      yearCoverage: yearRow,

    },

    ffiec: {

      /** @deprecated use dataBrowserLive — kept for older clients */
      liveAvailable: dataBrowserLive,

      dataBrowserLive,

      runtimeMode: warehouseReady ? 'database' : 'static JSON on disk',

      lenderSyncMethod,

      mlarCheckpointInstitutions: mlarCheckpoint?.institutionCount ?? null,

      availableYears: ffiecWindow?.available || [],

      unavailable: ffiecWindow?.unavailable || [],

    },

    geography: {

      drilldownExists: geo.exists,

      geo2025Source: geo.geo2025Source,

      tractManifest,

    },

    lastRefresh: lastJob

      ? {

          jobId: lastJob.jobId,

          mode: lastJob.mode,

          status: lastJob.status,

          startedAt: lastJob.startedAt,

          finishedAt: lastJob.finishedAt || null,

          message: lastJob.message || null,

          error: lastJob.error || null,

          triggeredBy: lastJob.triggeredBy || null,

          logPath: lastJob.logPath || null,

        }

      : null,

    warnings,

    automation: {
      enabled: false,
      status: 'not_configured',
      recommendation:
        'Automated refresh is not enabled yet. On AWS, use EventBridge Scheduler + ECS RunTask (or scheduled CI → S3 + CloudFront) for weekly manifest and filing-season lender updates. Admin schedule presets are planned.',
    },

    recommendedSchedule: {

      ffiecProbe: 'daily — check whether FFIEC API serves the anchor year',

      mlarInsightsRefresh: 'weekly during filing season (uses --resume)',

      fullGeoRebuild: 'when combined MLAR file is added or updated in data/hmda-mlar/',

      manifestRebuild: 'after any manual file changes under public/data/hmda/',

    },

  }

}

