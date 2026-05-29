#!/usr/bin/env node
/**
 * Local HMDA refresh orchestrator — runs entirely inside cohi-hmda.
 * Invoked by server/hmda/admin-refresh.mjs (mode=refresh).
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findCombinedMlarFile, HMDA_MLAR_DIR } from './paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..', '..')
const SCRIPTS = path.join(__dirname)
const anchorYear = Number(process.env.HMDA_ANCHOR_YEAR || '2025') || 2025

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

async function main() {
  console.log(`[hmda-admin-refresh] anchor year: ${anchorYear}`)
  console.log(`[hmda-admin-refresh] MLAR dir: ${HMDA_MLAR_DIR}`)

  await runNode('fetch-hmda-mlar-insights.mjs', [`--year=${anchorYear}`, '--resume'])
  await runNode('export-hmda-enriched.mjs', [`--year=${anchorYear}`])
  await runNode('build-hmda-lender-pages.mjs', [`--year=${anchorYear}`])
  await runNode('build-hmda-products-summary.mjs')
  await tryGeoSteps()
  await runNode('build-hmda-years-manifest.mjs')

  console.log('[hmda-admin-refresh] done')
}

main().catch((err) => {
  console.error('[hmda-admin-refresh] failed:', err.message)
  process.exit(1)
})
