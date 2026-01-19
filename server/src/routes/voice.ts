// @ts-nocheck
import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { pool } from '../config/database.js';
import { logCostEvent } from '../middleware/costTracking.js';

const router = Router();

// Store active voice sessions in memory (in production, use Redis)
const activeSessions = new Map<string, {
  userId: string;
  context?: string;
  startedAt: Date;
  lastActivity: Date;
}>();

/**
 * POST /api/voice/sessions
 * Start a new Gemini voice agentic session
 */
router.post('/sessions', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { context } = req.body; // Optional context like 'v2'
    const userId = req.user!.userId;

    // Check if user already has an active session
    const existingSession = Array.from(activeSessions.entries()).find(
      ([_, session]) => session.userId === userId
    );

    if (existingSession) {
      return res.json({
        sessionId: existingSession[0],
        wsUrl: `/ws/aletheia?token=${encodeURIComponent(req.headers.authorization?.replace('Bearer ', '') || '')}${context ? `&context=${context}` : ''}`,
        ...existingSession[1],
      });
    }

    // Create new session
    const sessionId = `voice_${userId}_${Date.now()}`;
    activeSessions.set(sessionId, {
      userId,
      context,
      startedAt: new Date(),
      lastActivity: new Date(),
    });

    // Get API URL from environment
    const API_URL = process.env.API_URL || 'http://localhost:3001';
    const wsProtocol = API_URL.replace('http://', 'ws://').replace('https://', 'wss://');
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    const wsUrl = `${wsProtocol}/ws/aletheia?token=${encodeURIComponent(token)}${context ? `&context=${context}` : ''}`;

    res.status(201).json({
      sessionId,
      wsUrl,
      context,
      startedAt: activeSessions.get(sessionId)!.startedAt,
      message: 'Voice session created. Connect to WebSocket URL to start.',
    });
  } catch (error) {
    console.error('Error creating voice session:', error);
    res.status(500).json({ error: 'Failed to create voice session' });
  }
});

/**
 * GET /api/voice/sessions
 * Get all active voice sessions for the authenticated user
 */
router.get('/sessions', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    
    const userSessions = Array.from(activeSessions.entries())
      .filter(([_, session]) => session.userId === userId)
      .map(([sessionId, session]) => ({
        sessionId,
        context: session.context,
        startedAt: session.startedAt,
        lastActivity: session.lastActivity,
        duration: Date.now() - session.startedAt.getTime(),
      }));

    res.json({
      sessions: userSessions,
      count: userSessions.length,
    });
  } catch (error) {
    console.error('Error fetching voice sessions:', error);
    res.status(500).json({ error: 'Failed to fetch voice sessions' });
  }
});

/**
 * GET /api/voice/sessions/:sessionId
 * Get details of a specific voice session
 */
router.get('/sessions/:sessionId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user!.userId;

    const session = activeSessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Voice session not found' });
    }

    if (session.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      sessionId,
      ...session,
      duration: Date.now() - session.startedAt.getTime(),
    });
  } catch (error) {
    console.error('Error fetching voice session:', error);
    res.status(500).json({ error: 'Failed to fetch voice session' });
  }
});

/**
 * DELETE /api/voice/sessions/:sessionId
 * End a voice session
 */
router.delete('/sessions/:sessionId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user!.userId;

    const session = activeSessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Voice session not found' });
    }

    if (session.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const duration = Date.now() - session.startedAt.getTime();
    const durationMinutes = duration / (1000 * 60);
    activeSessions.delete(sessionId);

    // Get tenant_id for cost tracking
    let tenantId: string | null = null;
    try {
      const profileResult = await pool.query(
        'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
        [userId]
      );
      if (profileResult.rows.length > 0 && profileResult.rows[0].tenant_id) {
        tenantId = profileResult.rows[0].tenant_id;
      }
    } catch (error) {
      console.error('Error fetching tenant_id for cost tracking:', error);
    }

    // Track voice AI costs (estimate: assume 40% input, 60% output based on typical usage)
    if (tenantId && durationMinutes > 0) {
      try {
        // Get voice model from RAG settings (default to Gemini)
        const ragSettingsResult = await pool.query(
          'SELECT voice_model FROM public.tenant_rag_settings WHERE tenant_id = $1',
          [tenantId]
        );
        const voiceModel = ragSettingsResult.rows[0]?.voice_model || 'google/gemini-2.0-flash-live';

        // Determine pricing based on model
        let inputPricePerMin = 0.035; // Gemini default
        let outputPricePerMin = 0.07; // Gemini default
        let provider = 'google';
        let serviceName = 'gemini-2.0-flash-live';

        if (voiceModel.includes('openai') || voiceModel.includes('realtime')) {
          inputPricePerMin = 0.06;
          outputPricePerMin = 0.24;
          provider = 'openai';
          serviceName = 'realtime-api';
        }

        const inputMinutes = durationMinutes * 0.4; // Estimate 40% input
        const outputMinutes = durationMinutes * 0.6; // Estimate 60% output

        // Log input cost
        await logCostEvent(tenantId, {
          serviceCategory: 'voice_ai',
          serviceProvider: provider,
          serviceName,
          usageType: 'audio_input_minutes',
          usageAmount: inputMinutes,
          usageUnit: 'minutes',
          unitPrice: inputPricePerMin,
          userId,
          sessionId,
          metadata: { context: session.context },
        });

        // Log output cost
        await logCostEvent(tenantId, {
          serviceCategory: 'voice_ai',
          serviceProvider: provider,
          serviceName,
          usageType: 'audio_output_minutes',
          usageAmount: outputMinutes,
          usageUnit: 'minutes',
          unitPrice: outputPricePerMin,
          userId,
          sessionId,
          metadata: { context: session.context },
        });
      } catch (costError) {
        console.error('Error tracking voice session cost:', costError);
        // Don't fail the request if cost tracking fails
      }
    }

    // Optionally save session to database (if table exists)
    try {
      await pool.query(
        `INSERT INTO public.voice_sessions (user_id, session_id, context, duration_ms, started_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (session_id) DO UPDATE SET ended_at = NOW(), duration_ms = $4`,
        [userId, sessionId, session.context || null, duration, session.startedAt]
      );
    } catch (dbError: any) {
      // Table might not exist yet - that's okay, we'll use in-memory storage
      if (dbError.code !== '42P01') { // 42P01 = table does not exist
        console.error('Error saving voice session to database:', dbError);
      }
      // Don't fail the request if DB save fails
    }

    res.json({
      message: 'Voice session ended',
      sessionId,
      duration,
      durationMinutes: Math.round(durationMinutes * 100) / 100,
    });
  } catch (error) {
    console.error('Error ending voice session:', error);
    res.status(500).json({ error: 'Failed to end voice session' });
  }
});

/**
 * POST /api/voice/sessions/:sessionId/activity
 * Update last activity timestamp for a session
 */
router.post('/sessions/:sessionId/activity', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user!.userId;

    const session = activeSessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Voice session not found' });
    }

    if (session.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    session.lastActivity = new Date();
    activeSessions.set(sessionId, session);

    res.json({
      message: 'Activity updated',
      lastActivity: session.lastActivity,
    });
  } catch (error) {
    console.error('Error updating session activity:', error);
    res.status(500).json({ error: 'Failed to update session activity' });
  }
});

/**
 * GET /api/voice/config
 * Get voice agentic configuration
 */
router.get('/config', authenticateToken, async (req: AuthRequest, res) => {
  try {
    res.json({
      provider: 'gemini',
      model: 'models/gemini-2.0-flash-exp',
      voice: 'Aoede',
      supportedContexts: ['v2', 'default'],
      audioFormat: 'pcm16',
      sampleRate: 24000,
      features: {
        realTime: true,
        contextAware: true,
        multiTurn: true,
      },
    });
  } catch (error) {
    console.error('Error fetching voice config:', error);
    res.status(500).json({ error: 'Failed to fetch voice config' });
  }
});

export default router;

