import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** cohi-hmda repository root */
export const REPO_ROOT = path.resolve(__dirname, '../..')

/** All HMDA static JSON artifacts served at runtime */
export const HMDA_DATA_DIR = path.join(REPO_ROOT, 'public/data/hmda')

/** Build checkpoints (MLAR insights progress, etc.) */
export const HMDA_CACHE_DIR = path.join(REPO_ROOT, '.cache/hmda')

/** Combined MLAR txt/zip for geography builds — override with HMDA_MLAR_DIR env */
export const HMDA_MLAR_DIR = process.env.HMDA_MLAR_DIR
  ? path.resolve(process.env.HMDA_MLAR_DIR)
  : path.join(REPO_ROOT, 'data/hmda-mlar')

export function hmdaDataPath(...segments) {
  return path.join(HMDA_DATA_DIR, ...segments)
}

export function findCombinedMlarFile(year) {
  const y = Number(year)
  if (!Number.isFinite(y)) return null
  for (const suffix of ['.txt', '.zip']) {
    const p = path.join(HMDA_MLAR_DIR, `${y}_combined_mlar_header${suffix}`)
    if (fs.existsSync(p)) return p
  }
  return null
}
