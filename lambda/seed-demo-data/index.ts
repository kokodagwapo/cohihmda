/**
 * Seed Demo Data Lambda Function
 * Creates demo contacts, call sessions, and conversation data
 * Migrated from Supabase Edge Function
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { query } from '../shared/database.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  try {
    // Get user from Authorization header (JWT token)
    const authHeader = event.headers.Authorization || event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    const token = authHeader.replace('Bearer ', '');
    // TODO: Verify JWT token and get user ID
    const body = event.body ? JSON.parse(event.body) : {};
    const userId = body.userId || token; // TODO: Extract from JWT

    // Get user's tenant
    const userResult = await query(
      `SELECT COALESCE(p.tenant_id, u.tenant_id) as tenant_id
       FROM public.users u
       LEFT JOIN public.profiles p ON u.id = p.user_id
       WHERE u.id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'User not found' }),
      };
    }

    const tenantId = userResult.rows[0].tenant_id;

    if (!tenantId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No tenant found' }),
      };
    }

    // Create demo contacts
    const contactsResult = await query(
      `INSERT INTO public.contacts 
       (tenant_id, full_name, email, phone, monthly_income, employer, employment_status, loan_amount_requested)
       VALUES 
       ($1, 'Sarah Johnson', 'sarah.j@email.com', '+1-555-0123', 8500.00, 'Tech Corp', 'Full-time', 50000.00),
       ($1, 'Michael Chen', 'mchen@email.com', '+1-555-0456', 6200.00, 'Retail Solutions Inc', 'Full-time', 75000.00),
       ($1, 'Emily Rodriguez', 'emily.r@email.com', '+1-555-0789', 7800.00, 'Healthcare Plus', 'Full-time', 35000.00)
       RETURNING id, full_name`,
      [tenantId]
    );

    const contacts = contactsResult.rows;

    // Create demo call sessions
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const twoHoursAgo = new Date(now.getTime() - 7200000);
    const tenMinutesAgo = new Date(now.getTime() - 600000);

    const sessionsResult = await query(
      `INSERT INTO public.call_sessions 
       (tenant_id, contact_id, status, started_at, ended_at, duration_seconds, sentiment_score, summary)
       VALUES 
       ($1, $2, 'completed', $3, $4, 300, 0.85, 'Successful pre-qualification. All documents verified.'),
       ($1, $5, 'flagged', $6, $7, 280, 0.65, 'Income mismatch detected. Requires manual review.'),
       ($1, $8, 'in_progress', $9, NULL, NULL, 0.78, 'Currently in progress. Awaiting document upload.')
       RETURNING id`,
      [
        tenantId,
        contacts[0].id,
        oneHourAgo.toISOString(),
        new Date(oneHourAgo.getTime() + 300000).toISOString(),
        contacts[1].id,
        twoHoursAgo.toISOString(),
        new Date(twoHoursAgo.getTime() + 280000).toISOString(),
        contacts[2].id,
        tenMinutesAgo.toISOString(),
      ]
    );

    const sessions = sessionsResult.rows;

    // Create conversation turns for first call
    if (sessions.length > 0) {
      await query(
        `INSERT INTO public.conversation_turns 
         (call_session_id, speaker, message, timestamp)
         VALUES 
         ($1, 'agent', 'Hi! I''m Maylin. What''s your name?', $2),
         ($1, 'customer', 'Sarah Johnson', $3),
         ($1, 'agent', 'Nice to meet you, Sarah! Are you currently employed?', $4),
         ($1, 'customer', 'Yes, I work at Tech Corp', $5),
         ($1, 'agent', 'Great! Can you tell me your monthly income?', $6),
         ($1, 'customer', '$8,500 per month', $7)`,
        [
          sessions[0].id,
          oneHourAgo.toISOString(),
          new Date(oneHourAgo.getTime() + 2000).toISOString(),
          new Date(oneHourAgo.getTime() + 4000).toISOString(),
          new Date(oneHourAgo.getTime() + 6000).toISOString(),
          new Date(oneHourAgo.getTime() + 8000).toISOString(),
          new Date(oneHourAgo.getTime() + 10000).toISOString(),
        ]
      );
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Demo data created successfully',
        data: {
          contacts: contacts.length,
          call_sessions: sessions.length,
        },
      }),
    };
  } catch (error: any) {
    console.error('Seed demo data error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error.message || 'Unknown error',
      }),
    };
  }
};
