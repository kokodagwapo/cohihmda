import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { attachTenantContext, getTenantContext } from '../middleware/tenantContext.js';
import { requirePlatformStaff } from '../middleware/rbac.js';
import { pool as managementPool } from '../config/managementDatabase.js';

const router = Router();

async function ensureHelpOverridesTable(): Promise<void> {
  await managementPool.query(`
    CREATE TABLE IF NOT EXISTS help_article_overrides (
      article_id TEXT PRIMARY KEY,
      title TEXT,
      summary TEXT,
      content TEXT,
      updated_by TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

let tableEnsured = false;

async function ensureTable() {
  if (!tableEnsured) {
    await ensureHelpOverridesTable();
    tableEnsured = true;
  }
}

/**
 * GET /api/help/overrides
 * Returns all help article overrides (platform staff only).
 */
router.get(
  '/overrides',
  authenticateToken,
  requirePlatformStaff(),
  async (req: AuthRequest, res) => {
    try {
      await ensureTable();
      const result = await managementPool.query(
        'SELECT article_id, title, summary, content, updated_by, updated_at FROM help_article_overrides ORDER BY updated_at DESC'
      );
      res.json({ overrides: result.rows });
    } catch (err: any) {
      console.error('[HelpContent] Error fetching overrides:', err);
      res.status(500).json({ error: 'Failed to fetch overrides' });
    }
  }
);

/**
 * PUT /api/help/overrides/:articleId
 * Create or update a help article override (platform staff only).
 */
router.put(
  '/overrides/:articleId',
  authenticateToken,
  requirePlatformStaff(),
  async (req: AuthRequest, res) => {
    try {
      await ensureTable();
      const { articleId } = req.params;
      const { title, summary, content } = req.body;

      if (!title && !summary && !content) {
        return res.status(400).json({ error: 'At least one field (title, summary, content) is required' });
      }

      await managementPool.query(
        `INSERT INTO help_article_overrides (article_id, title, summary, content, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (article_id) DO UPDATE SET
           title = COALESCE($2, help_article_overrides.title),
           summary = COALESCE($3, help_article_overrides.summary),
           content = COALESCE($4, help_article_overrides.content),
           updated_by = $5,
           updated_at = NOW()`,
        [articleId, title || null, summary || null, content || null, req.userEmail || req.userId]
      );

      res.json({ success: true, articleId });
    } catch (err: any) {
      console.error('[HelpContent] Error saving override:', err);
      res.status(500).json({ error: 'Failed to save override' });
    }
  }
);

/**
 * DELETE /api/help/overrides/:articleId
 * Revert a help article to its default content (platform staff only).
 */
router.delete(
  '/overrides/:articleId',
  authenticateToken,
  requirePlatformStaff(),
  async (req: AuthRequest, res) => {
    try {
      await ensureTable();
      const { articleId } = req.params;

      const result = await managementPool.query(
        'DELETE FROM help_article_overrides WHERE article_id = $1',
        [articleId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'No override found for this article' });
      }

      res.json({ success: true, articleId });
    } catch (err: any) {
      console.error('[HelpContent] Error deleting override:', err);
      res.status(500).json({ error: 'Failed to revert article' });
    }
  }
);

/**
 * POST /api/help/seed-knowledge-base
 * Seeds the RAG knowledge base with help article content.
 * Platform staff only.
 */
router.post(
  '/seed-knowledge-base',
  authenticateToken,
  attachTenantContext,
  requirePlatformStaff(),
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { articles } = req.body;

      if (!Array.isArray(articles) || articles.length === 0) {
        return res.status(400).json({ error: 'articles array is required' });
      }

      const tableCheck = await tenantPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = 'rag_knowledge_base'
        )
      `);

      if (!tableCheck.rows[0].exists) {
        return res.status(400).json({ error: 'rag_knowledge_base table does not exist. Run migrations first.' });
      }

      let inserted = 0;
      let updated = 0;

      for (const article of articles) {
        const { id, title, category, content, summary } = article;
        if (!id || !title || !content) continue;

        const fullContent = `# ${title}\n\n${summary ? summary + '\n\n' : ''}${content}`;
        const keywords = [
          'help',
          'tutorial',
          category?.toLowerCase(),
          ...title.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3),
        ].filter(Boolean);

        const existing = await tenantPool.query(
          `SELECT id FROM rag_knowledge_base WHERE title = $1 AND category = $2 LIMIT 1`,
          [`[Help] ${title}`, `Help: ${category}`]
        );

        if (existing.rows.length > 0) {
          await tenantPool.query(
            `UPDATE rag_knowledge_base 
             SET content = $1, keywords = $2, updated_at = NOW(), updated_by = $3
             WHERE id = $4`,
            [fullContent, keywords, req.userId, existing.rows[0].id]
          );
          updated++;
        } else {
          await tenantPool.query(
            `INSERT INTO rag_knowledge_base (title, category, content, keywords, priority, is_active, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
            [`[Help] ${title}`, `Help: ${category}`, fullContent, keywords, 100, true, req.userId]
          );
          inserted++;
        }
      }

      res.json({
        success: true,
        inserted,
        updated,
        total: inserted + updated,
      });
    } catch (err: any) {
      console.error('[HelpContent] Error seeding knowledge base:', err);
      res.status(500).json({ error: 'Failed to seed knowledge base' });
    }
  }
);

export default router;
