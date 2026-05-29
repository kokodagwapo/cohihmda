/**
 * Admin — HMDA public data status and manual refresh triggers.
 */

import { Router, Response } from 'express'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
import { authenticateToken, AuthRequest } from '../../middleware/auth.js'
import { requireRole } from '../../middleware/rbac.js'
import { auditLog } from '../../services/auditLogger.js'

const requirePlatformAdmin = requireRole('super_admin', 'platform_admin')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)
const adminStatusPath = path.resolve(__dirname, '../../../hmda/admin-status.mjs')
const adminRefreshPath = path.resolve(__dirname, '../../../hmda/admin-refresh.mjs')
const hmdaPathsPath = path.resolve(__dirname, '../../../../scripts/hmda/paths.mjs')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { getHmdaAdminStatus } = require(adminStatusPath) as {
  getHmdaAdminStatus: (year?: number) => Promise<Record<string, unknown>>
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { startHmdaRefreshJob, getHmdaRefreshJobStatus, normalizeRefreshMode } = require(
  adminRefreshPath,
) as {
  startHmdaRefreshJob: (
    mode: 'refresh' | 'manifest' | 'lenders' | 'geo' | 'full' | 'copy',
    opts?: { triggeredBy?: string; anchorYear?: number },
  ) => { ok: boolean; error?: string; job?: Record<string, unknown> }
  getHmdaRefreshJobStatus: () => Record<string, unknown> | null
  normalizeRefreshMode: (mode: string) => 'refresh' | 'manifest' | 'lenders' | 'geo'
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { findCombinedMlarFile, HMDA_MLAR_DIR } = require(hmdaPathsPath) as {
  findCombinedMlarFile: (year: number) => string | null
  HMDA_MLAR_DIR: string
}

const router = Router()

router.get('/status', authenticateToken, requirePlatformAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const year = parseInt(String(req.query.years || req.query.year || '2025'), 10) || 2025
    const status = await getHmdaAdminStatus(year)
    res.json(status)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || 'Failed to load HMDA admin status' })
  }
})

router.get('/refresh/status', authenticateToken, requirePlatformAdmin, (_req: AuthRequest, res: Response) => {
  const job = getHmdaRefreshJobStatus()
  res.json({ job })
})

const REFRESH_START_MESSAGES: Record<string, string> = {
  manifest: 'Manifest rebuild started',
  lenders: 'Lender refresh started (FFIEC batch — may take hours; results saved to static JSON)',
  geo: 'Geography rebuild started (combined MLAR → map layers)',
  refresh: 'Full refresh started (lenders + geography + manifest)',
}

router.post('/refresh', authenticateToken, requirePlatformAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const rawMode = String(req.body?.mode || 'manifest')
    const mode = normalizeRefreshMode(rawMode)
    const anchorYear = parseInt(String(req.body?.anchorYear || '2025'), 10) || 2025
    const triggeredBy = req.userEmail || req.userId || 'admin'

    if (mode === 'geo' && !findCombinedMlarFile(anchorYear)) {
      const status = await getHmdaAdminStatus(anchorYear)
      const yearCoverage = status.static as { yearCoverage?: { geo?: boolean } } | undefined
      const mlarFiles = (status.mlarFilesFound as string[] | undefined) || []
      const otherYears = mlarFiles
        .map((f) => f.match(/^(\d{4})/)?.[1])
        .filter((y): y is string => Boolean(y && y !== String(anchorYear)))
      const staticNote = yearCoverage?.yearCoverage?.geo
        ? ` Static map data for ${anchorYear} is already deployed — no rebuild needed unless you add a combined MLAR file.`
        : ''
      const mlarDirLabel = path.relative(path.resolve(__dirname, '../../../..'), HMDA_MLAR_DIR)
      const hint = otherYears.length
        ? ` Switch Admin year to ${otherYears[0]} (combined file on disk) or download ${anchorYear} from FFIEC.`
        : ` Download ${anchorYear}_combined_mlar_header.zip from FFIEC into ${mlarDirLabel}.`
      return res.status(400).json({
        error: `No combined MLAR file for ${anchorYear}.${staticNote}${hint}`,
      })
    }

    const result = startHmdaRefreshJob(mode, { triggeredBy, anchorYear })
    if (!result.ok) {
      return res.status(409).json({ error: result.error, job: result.job })
    }

    await auditLog({
      userId: req.userId,
      userEmail: req.userEmail,
      action: 'hmda_data_refresh_started',
      resource: 'hmda_static_data',
      metadata: { mode, anchorYear, jobId: result.job?.jobId },
      status: 'success',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    })

    res.status(202).json({
      message: REFRESH_START_MESSAGES[mode] || REFRESH_START_MESSAGES.manifest,
      job: result.job,
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || 'Failed to start HMDA refresh' })
  }
})

export default router
