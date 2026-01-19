/**
 * Demo Data Routes
 * Generate and manage demo/test data for development and testing
 */

import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';

const router = Router();

const generateDemoSchema = z.object({
  count: z.number().int().min(1).max(1000).optional().default(10),
  type: z.enum(['loans', 'contacts', 'calls', 'all']).optional().default('all'),
});

/**
 * POST /api/demo/generate
 * Generate demo data (loans, contacts, calls)
 */
router.post('/generate', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { count, type } = generateDemoSchema.parse(req.body);

    // Get user's tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    const tenantId = profileResult.rows[0]?.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'User must be associated with a tenant' });
    }

    const generated = {
      contacts: 0,
      loans: 0,
      calls: 0,
    };

    // Generate contacts
    if (type === 'contacts' || type === 'all') {
      const contactsToGenerate = Math.min(count, 100);
      for (let i = 0; i < contactsToGenerate; i++) {
        await pool.query(
          `INSERT INTO public.contacts (
            tenant_id, full_name, email, phone, employer, 
            employment_status, monthly_income, loan_amount_requested
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            tenantId,
            `Demo Contact ${i + 1}`,
            `demo${i + 1}@example.com`,
            `555-${String(i).padStart(4, '0')}`,
            `Company ${(i % 10) + 1}`,
            ['employed', 'self-employed', 'retired'][i % 3],
            Math.floor(Math.random() * 10000) + 3000,
            Math.floor(Math.random() * 400000) + 100000,
          ]
        );
      }
      generated.contacts = contactsToGenerate;
    }

    // Generate loans
    if (type === 'loans' || type === 'all') {
      const loansToGenerate = Math.min(count, 100);
      const statuses = ['active', 'pending', 'closed', 'locked'];
      const loanTypes = ['conventional', 'fha', 'va', 'jumbo', 'usda'];
      
      for (let i = 0; i < loansToGenerate; i++) {
        const loanAmount = Math.floor(Math.random() * 400000) + 100000;
        const interestRate = (Math.random() * 3 + 3).toFixed(3); // 3-6%
        
        await pool.query(
          `INSERT INTO public.loans (
            tenant_id, borrower_name, loan_number, loan_amount, 
            interest_rate, loan_type, status, property_address,
            estimated_close_date, loan_officer
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            tenantId,
            `Demo Borrower ${i + 1}`,
            `DEMO${String(i + 1).padStart(6, '0')}`,
            loanAmount,
            parseFloat(interestRate),
            loanTypes[i % loanTypes.length],
            statuses[i % statuses.length],
            `${i + 1} Demo Street, Demo City, ST 12345`,
            new Date(Date.now() + Math.random() * 90 * 24 * 60 * 60 * 1000), // Random date within 90 days
            `LO ${(i % 5) + 1}`,
          ]
        );
      }
      generated.loans = loansToGenerate;
    }

    // Generate call sessions
    if (type === 'calls' || type === 'all') {
      const callsToGenerate = Math.min(count, 50);
      
      // Get some contacts to associate with calls
      const contacts = await pool.query(
        'SELECT id FROM public.contacts WHERE tenant_id = $1 LIMIT $2',
        [tenantId, callsToGenerate]
      );

      for (let i = 0; i < Math.min(callsToGenerate, contacts.rows.length); i++) {
        const duration = Math.floor(Math.random() * 1800) + 60; // 1-30 minutes
        const sentiment = (Math.random() * 2 - 1).toFixed(2); // -1 to 1
        
        await pool.query(
          `INSERT INTO public.call_sessions (
            tenant_id, contact_id, started_at, ended_at, 
            duration_seconds, status, sentiment_score, summary
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            tenantId,
            contacts.rows[i].id,
            new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Random date within last 30 days
            new Date(),
            duration,
            'completed',
            parseFloat(sentiment),
            `Demo call summary ${i + 1}. Discussed loan options and requirements.`,
          ]
        );
      }
      generated.calls = Math.min(callsToGenerate, contacts.rows.length);
    }

    res.json({
      message: 'Demo data generated successfully',
      generated,
      tenantId,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Error generating demo data:', error);
    res.status(500).json({ error: 'Failed to generate demo data' });
  }
});

/**
 * POST /api/demo/reset
 * Reset/delete all demo data for the tenant
 */
router.post('/reset', authenticateToken, async (req: AuthRequest, res) => {
  try {
    // Get user's tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    const tenantId = profileResult.rows[0]?.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'User must be associated with a tenant' });
    }

    // Delete demo data (in order to respect foreign key constraints)
    const results = await Promise.all([
      pool.query('DELETE FROM public.call_sessions WHERE tenant_id = $1', [tenantId]),
      pool.query('DELETE FROM public.documents WHERE tenant_id = $1', [tenantId]),
      pool.query('DELETE FROM public.loans WHERE tenant_id = $1', [tenantId]),
      pool.query('DELETE FROM public.contacts WHERE tenant_id = $1', [tenantId]),
      pool.query('DELETE FROM public.cost_events WHERE tenant_id = $1', [tenantId]),
    ]);

    const deleted = {
      calls: results[0].rowCount || 0,
      documents: results[1].rowCount || 0,
      loans: results[2].rowCount || 0,
      contacts: results[3].rowCount || 0,
      costEvents: results[4].rowCount || 0,
    };

    res.json({
      message: 'Demo data reset successfully',
      deleted,
      tenantId,
    });
  } catch (error: any) {
    console.error('Error resetting demo data:', error);
    res.status(500).json({ error: 'Failed to reset demo data' });
  }
});

/**
 * GET /api/demo/stats
 * Get statistics about current demo data
 */
router.get('/stats', authenticateToken, async (req: AuthRequest, res) => {
  try {
    // Get user's tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    const tenantId = profileResult.rows[0]?.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'User must be associated with a tenant' });
    }

    const [contacts, loans, calls, documents] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM public.contacts WHERE tenant_id = $1', [tenantId]),
      pool.query('SELECT COUNT(*) as count FROM public.loans WHERE tenant_id = $1', [tenantId]),
      pool.query('SELECT COUNT(*) as count FROM public.call_sessions WHERE tenant_id = $1', [tenantId]),
      pool.query('SELECT COUNT(*) as count FROM public.documents WHERE tenant_id = $1', [tenantId]),
    ]);

    res.json({
      tenantId,
      stats: {
        contacts: parseInt(contacts.rows[0].count),
        loans: parseInt(loans.rows[0].count),
        calls: parseInt(calls.rows[0].count),
        documents: parseInt(documents.rows[0].count),
      },
    });
  } catch (error: any) {
    console.error('Error fetching demo stats:', error);
    res.status(500).json({ error: 'Failed to fetch demo statistics' });
  }
});

export default router;
