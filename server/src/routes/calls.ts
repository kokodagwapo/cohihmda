import { Router } from 'express';
import { pool, retryQuery, handleDatabaseError } from '../config/database.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Get call sessions
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 5;
    
    const result = await retryQuery(
      () => pool.query(
        `SELECT cs.*, c.full_name, c.email, c.phone
         FROM public.call_sessions cs
         LEFT JOIN public.contacts c ON cs.contact_id = c.id
         ORDER BY cs.created_at DESC
         LIMIT $1`,
        [limit]
      ),
      3, // max retries
      1000 // delay between retries
    );
    
    res.json(result.rows);
  } catch (error: any) {
    console.error('Error fetching calls:', error);
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Internal server error')) {
      return;
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single call session
router.get('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    
    const result = await retryQuery(
      () => pool.query(
        `SELECT cs.*, c.*
         FROM public.call_sessions cs
         LEFT JOIN public.contacts c ON cs.contact_id = c.id
         WHERE cs.id = $1`,
        [id]
      ),
      3, // max retries
      1000 // delay between retries
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Call session not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error: any) {
    console.error('Error fetching call:', error);
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Internal server error')) {
      return;
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create call session
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { contact_id, tenant_id } = req.body;
    
    const result = await retryQuery(
      () => pool.query(
        `INSERT INTO public.call_sessions (contact_id, tenant_id, started_at, status)
         VALUES ($1, $2, NOW(), 'in_progress')
         RETURNING *`,
        [contact_id, tenant_id]
      ),
      3, // max retries
      1000 // delay between retries
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    console.error('Error creating call session:', error);
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Internal server error')) {
      return;
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update call session
router.patch('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { ended_at, duration_seconds, status, sentiment_score, summary } = req.body;
    
    const result = await retryQuery(
      () => pool.query(
        `UPDATE public.call_sessions
         SET ended_at = COALESCE($1, ended_at),
             duration_seconds = COALESCE($2, duration_seconds),
             status = COALESCE($3, status),
             sentiment_score = COALESCE($4, sentiment_score),
             summary = COALESCE($5, summary)
         WHERE id = $6
         RETURNING *`,
        [ended_at, duration_seconds, status, sentiment_score, summary, id]
      ),
      3, // max retries
      1000 // delay between retries
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Call session not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error: any) {
    console.error('Error updating call session:', error);
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Internal server error')) {
      return;
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

