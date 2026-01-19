/**
 * User Preferences API Routes
 * Handles user preference storage and retrieval
 * Migrated from Supabase database queries
 */

import { Router } from 'express';
import { pool, retryQuery, isDatabaseConnectionError, handleDatabaseError } from '../config/database.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/user/preferences
 * Get all user preferences
 */
router.get('/preferences', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await retryQuery(
      () => pool.query(
        `SELECT preference_key, preference_value 
         FROM public.user_preferences 
         WHERE user_id = $1`,
        [userId]
      ),
      3, // max retries
      1000 // delay between retries
    );

    const preferences: Record<string, any> = {};
    result.rows.forEach((row: any) => {
      preferences[row.preference_key] = row.preference_value;
    });

    res.json({ preferences });
  } catch (error: any) {
    console.error('Error fetching user preferences:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      table: error.table
    });
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to fetch user preferences')) {
      return;
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch user preferences',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/user/preferences/:key
 * Get a specific user preference
 */
router.get('/preferences/:key', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { key } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await retryQuery(
      () => pool.query(
        `SELECT preference_value 
         FROM public.user_preferences 
         WHERE user_id = $1 AND preference_key = $2`,
        [userId, key]
      ),
      3, // max retries
      1000 // delay between retries
    );

    if (result.rows.length === 0) {
      // Return empty response instead of 404 - client will handle missing preference gracefully
      return res.json({ 
        preference_key: key,
        preference_value: null 
      });
    }

    // JSONB is already parsed by PostgreSQL, return as-is
    res.json({ 
      preference_key: key,
      preference_value: result.rows[0].preference_value 
    });
  } catch (error: any) {
    console.error('Error fetching user preference:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint
    });
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to fetch user preference')) {
      return;
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch user preference',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * PUT /api/user/preferences/:key
 * Update or create a user preference
 */
router.put('/preferences/:key', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { key } = req.params;
    const { preference_value } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // For JSONB columns, node-postgres expects a JSON string
    // Convert to JSON string if it's an object
    const jsonValue = typeof preference_value === 'string' 
      ? preference_value 
      : JSON.stringify(preference_value);

    await retryQuery(
      () => pool.query(
        `INSERT INTO public.user_preferences (user_id, preference_key, preference_value)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (user_id, preference_key)
         DO UPDATE SET preference_value = $3::jsonb, updated_at = NOW()`,
        [userId, key, jsonValue]
      ),
      3, // max retries
      1000 // delay between retries
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error updating user preference:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint
    });
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to update user preference')) {
      return;
    }
    
    res.status(500).json({ 
      error: 'Failed to update user preference',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/user/profile
 * Get user profile
 */
router.get('/profile', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await retryQuery(
      () => pool.query(
        `SELECT p.*, u.email
         FROM public.profiles p
         JOIN public.users u ON p.user_id = u.id
         WHERE p.user_id = $1`,
        [userId]
      ),
      3, // max retries
      1000 // delay between retries
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    console.error('Error fetching user profile:', error);
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to fetch user profile')) {
      return;
    }
    
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

/**
 * PUT /api/user/profile
 * Update user profile
 */
router.put('/profile', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { full_name, email } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Update profile
    await retryQuery(
      () => pool.query(
        `UPDATE public.profiles 
         SET full_name = $1, updated_at = NOW()
         WHERE user_id = $2`,
        [full_name, userId]
      ),
      3, // max retries
      1000 // delay between retries
    );

    // Update user email if provided
    if (email) {
      await retryQuery(
        () => pool.query(
          `UPDATE public.users 
           SET email = $1, updated_at = NOW()
           WHERE id = $2`,
          [email, userId]
        ),
        3, // max retries
        1000 // delay between retries
      );
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error updating user profile:', error);
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to update user profile')) {
      return;
    }
    
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});

export default router;
