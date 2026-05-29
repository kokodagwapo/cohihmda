#!/usr/bin/env node
/**
 * Local HMDA refresh orchestrator — runs entirely inside cohi-hmda.
 * Invoked by server/hmda/admin-refresh.mjs.
 *
 * Modes (HMDA_REFRESH_MODE):
 *   lenders — FFIEC per-institution fetch → static lender JSON (~hours)
 *   geo     — combined MLAR → map layers (~minutes)
 *   refresh — lenders + geo + manifest (full; geo-only fallback if FFIEC blocked)
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findCombinedMlarFile, HMDA_MLAR_DIR } from './paths.mjs'
import { probeFfiecFilers } from './ffiec-probe.mjs'
import { loadFilersFromStatic } from './hmda-filers-source.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..', '..')
const SCRIPTS = path.join(__dirname)
const anchorYear = Number(process.env.HMDA_ANCHOR_YEAR || '2025') || 2025
const mode = (() => {
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--mode=')) return a.slice(7).toLowerCase()
  }
  return String(process.env.HMDA_REFRESH_MODE || 'refresh').toLowerCase()
})()

/** Structured progress lines — parsed by server/hmda/admin-refresh.mjs for Admin UI. */
function emitProgress(step, total, label) {
  console.log(`[HMDA_PROGRESS] ${step}/${total} ${label}`)
}

function runNode(scriptName, args = []) {
  const scriptPath = path.join(SCRIPTS, scriptName)
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: { ...process.env, HMDA_ANCHOR_YEAR: String(anchorYear) },
      windowsHide: true,
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(undefined)
      else reject(new Error(`${scriptName} ${args.join(' ')} exited ${code}`))
    })
  })
}

async function tryGeoSteps() {
  const mlar = findCombinedMlarFile(anchorYear)
  if (!mlar) {
    console.warn(
      `[hmda-admin-refresh] SKIP geo steps: no combined MLAR for ${anchorYear} in ${HMDA_MLAR_DIR}`,
    )
    console.warn('[hmda-admin-refresh] Place {year}_combined_mlar_header.txt or .zip in that folder.')
    return false
  }
  console.log(`[hmda-admin-refresh] combined MLAR: ${mlar}`)
  await runNode('build-geo-drilldown-hmda.mjs', [String(anchorYear)])
  await runNode('build-geo-map-enrichment.mjs', [String(anchorYear)])
  await runNode('build-geo-map-summary.mjs', [String(anchorYear)])
  await runNode('build-geo-tract-features.mjs', [String(anchorYear)])
  return true
}

async function rebuildManifest() {
  await runNode('build-hmda-years-manifest.mjs')
}

/** @param {string} reason */
async function runGeoPipeline(reason = null) {
  const total = 3
  if (reason) {
    console.warn(`[hmda-admin-refresh] ${reason}`)
    console.warn('[hmda-admin-refresh] Running geography + manifest only.')
  }
  const mlar = findCombinedMlarFile(anchorYear)
  emitProgress(1, total, reason ? 'FFIEC unavailable — geography only' : 'Build geography from combined MLAR')
  emitProgress(
    2,
    total,
    mlar ? 'Processing county / tract map layers' : 'Geography skipped (no combined MLAR file)',
  )
  await tryGeoSteps()
  emitProgress(3, total, 'Rebuild years manifest')
  await rebuildManifest()
  console.log('[hmda-admin-refresh] done (geo pipeline)')
}

async function runLendersPipeline() {
  const total = 5
  emitProgress(1, total, 'Fetch MLAR insights from FFIEC (batched, resumable)')
  await runNode('fetch-hmda-mlar-insights.mjs', [`--year=${anchorYear}`, '--resume'])
  emitProgress(2, total, 'Export enriched lender JSON')
  await runNode('export-hmda-enriched.mjs', [`--year=${anchorYear}`])
  emitProgress(3, total, 'Build paginated lender pages')
  await runNode('build-hmda-lender-pages.mjs', [`--year=${anchorYear}`])
  emitProgress(4, total, 'Build products summary')
  await runNode('build-hmda-products-summary.mjs')
  emitProgress(5, total, 'Rebuild years manifest')
  await rebuildManifest()
  console.log('[hmda-admin-refresh] done (lenders pipeline)')
}

async function runFullPipeline() {
  const total = 6
  const probe = await probeFfiecFilers(anchorYear)
  if (!probe.ok) {
    const staticCount = loadFilersFromStatic(anchorYear).length
    if (staticCount > 0) {
      console.warn(`[hmda-admin-refresh] FFIEC filers probe: ${probe.reason}`)
      console.warn(
        `[hmda-admin-refresh] Continuing lender refresh using ${staticCount} LEIs from static JSON; per-institution MLAR fetch will be attempted.`,
      )
    } else {
      await runGeoPipeline(probe.reason || 'FFIEC unreachable')
      console.log('[hmda-admin-refresh] done (geo-only fallback — no static lender roster)')
      return
    }
  }

  emitProgress(1, total, 'Fetch MLAR insights from FFIEC')
  await runNode('fetch-hmda-mlar-insights.mjs', [`--year=${anchorYear}`, '--resume'])
  emitProgress(2, total, 'Export enriched lender JSON')
  await runNode('export-hmda-enriched.mjs', [`--year=${anchorYear}`])
  emitProgress(3, total, 'Build paginated lender pages')
  await runNode('build-hmda-lender-pages.mjs', [`--year=${anchorYear}`])
  emitProgress(4, total, 'Build products summary')
  await runNode('build-hmda-products-summary.mjs')
  const mlar = findCombinedMlarFile(anchorYear)
  emitProgress(
    5,
    total,
    mlar ? 'Build geography from combined MLAR' : 'Geography skipped (no combined MLAR file)',
  )
  await tryGeoSteps()
  emitProgress(6, total, 'Rebuild years manifest')
  await rebuildManifest()
  console.log('[hmda-admin-refresh] done (full pipeline)')
}

async function main() {
  console.log(`[hmda-admin-refresh] mode=${mode} anchor year=${anchorYear}`)
  console.log(`[hmda-admin-refresh] MLAR dir: ${HMDA_MLAR_DIR}`)

  if (mode === 'geo') {
    await runGeoPipeline()
    return
  }

  if (mode === 'lenders') {
    const staticCount = loadFilersFromStatic(anchorYear).length
    const probe = await probeFfiecFilers(anchorYear)
    if (!probe.ok) {
      console.warn(`[hmda-admin-refresh] FFIEC filers probe: ${probe.reason}`)
      if (staticCount > 0) {
        console.warn(
          `[hmda-admin-refresh] Using ${staticCount} LEIs from static JSON; batching per-institution MLAR downloads.`,
        )
      } else {
        throw new Error(
          `${probe.reason || 'FFIEC unreachable'} and no static lender JSON for ${anchorYear}. ` +
            'Deploy lender data first or run from a network where ffiec.cfpb.gov is reachable.',
        )
      }
    }
    await runLendersPipeline()
    return
  }

  await runFullPipeline()
}

main().catch((err) => {
  console.error('[hmda-admin-refresh] failed:', err.message)
  process.exit(1)
})
