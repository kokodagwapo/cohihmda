/**
 * Once per calendar day (after local 5am), compare static lender export etag
 * and refresh cached manifest when the server reports a change.
 */

const STORAGE_KEY = 'hmda_lender_sync_v1'
const SYNC_HOUR = 5

function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeState(next) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore quota */
  }
}

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isPastMorningSyncWindow() {
  return new Date().getHours() >= SYNC_HOUR
}

/**
 * @param {() => Promise<{ staticExportedAt?: string|null, changed?: boolean }>} fetchSyncCheck
 * @returns {Promise<{ stale: boolean, exportedAt: string|null }>}
 */
export async function runHmdaMorningSync(fetchSyncCheck) {
  const state = readState()
  const today = todayKey()
  const alreadyCheckedToday = state.lastCheckDate === today && isPastMorningSyncWindow()

  if (alreadyCheckedToday && state.exportedAt) {
    return { stale: false, exportedAt: state.exportedAt }
  }

  if (!isPastMorningSyncWindow() && state.exportedAt && state.lastCheckDate === today) {
    return { stale: false, exportedAt: state.exportedAt }
  }

  try {
    const body = await fetchSyncCheck()
    const exportedAt = body?.staticExportedAt || null
    const stale = Boolean(exportedAt && state.exportedAt && exportedAt !== state.exportedAt)
    writeState({
      lastCheckDate: today,
      exportedAt: exportedAt || state.exportedAt || null,
      checkedAt: new Date().toISOString(),
    })
    return { stale, exportedAt: exportedAt || state.exportedAt || null }
  } catch {
    return { stale: false, exportedAt: state.exportedAt || null }
  }
}

export function invalidateHmdaLenderCache() {
  writeState({ lastCheckDate: null, exportedAt: null, checkedAt: null })
}
