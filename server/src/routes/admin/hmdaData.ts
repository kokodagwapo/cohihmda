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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { getHmdaAdminStatus } = require(adminStatusPath) as {
  getHmdaAdminStatus: (year?: number) => Promise<Record<string, unknown>>
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { startHmdaRefreshJob, getHmdaRefreshJobStatus, normalizeRefreshMode } = require(
  adminRefreshPath,
) as {
  startHmdaRefreshJob: (
    mode: 'refresh' | 'manifest' | 'full' | 'copy',
    opts?: { triggeredBy?: string; anchorYear?: number },
  ) => { ok: boolean; error?: string; job?: Record<string, unknown> }
  getHmdaRefreshJobStatus: () => Record<string, unknown> | null
  normalizeRefreshMode: (mode: string) => 'refresh' | 'manifest'
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

router.post('/refresh', authenticateToken, requirePlatformAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const rawMode = String(req.body?.mode || 'manifest')
    const mode = normalizeRefreshMode(rawMode)
    const anchorYear = parseInt(String(req.body?.anchorYear || '2025'), 10) || 2025
    const triggeredBy = req.userEmail || req.userId || 'admin'

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
      message:
        mode === 'manifest'
          ? 'Manifest rebuild started'
          : 'FFIEC refresh started (may take hours; geo steps skip if no combined MLAR)',
      job: result.job,
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || 'Failed to start HMDA refresh' })
  }
})

export default router
