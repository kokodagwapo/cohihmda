/**
 * Stripe Checkout Lambda Function
 * Creates Stripe checkout sessions for subscription plans
 * Migrated from Supabase Edge Function
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import Stripe from 'stripe';
import { getSecret } from '../shared/secrets-manager.js';
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
    // Get Stripe secret key from Secrets Manager
    const STRIPE_SECRET_KEY = await getSecret('coheus/stripe-secret-key');
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2025-12-15.clover' as any,
    });

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
    // For now, we'll need to extract user_id from token or pass it in the request body
    
    const body = event.body ? JSON.parse(event.body) : {};
    const { planId, userId } = body;

    if (!planId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'planId is required' }),
      };
    }

    // Get user's profile and tenant from RDS
    const userResult = await query(
      `SELECT u.id, u.email, COALESCE(p.tenant_id, u.tenant_id) as tenant_id
       FROM public.users u
       LEFT JOIN public.profiles p ON u.id = p.user_id
       WHERE u.id = $1`,
      [userId || token] // TODO: Extract userId from JWT token
    );

    if (userResult.rows.length === 0) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'User not found' }),
      };
    }

    const user = userResult.rows[0];
    const tenantId = user.tenant_id;

    if (!tenantId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'User has no tenant' }),
      };
    }

    // Get plan details
    const planResult = await query(
      `SELECT * FROM public.subscription_plans WHERE id = $1`,
      [planId]
    );

    if (planResult.rows.length === 0) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Plan not found' }),
      };
    }

    const plan = planResult.rows[0];

    // Get or create Stripe customer
    const subscriptionResult = await query(
      `SELECT stripe_customer_id FROM public.subscriptions WHERE tenant_id = $1`,
      [tenantId]
    );

    let customerId = subscriptionResult.rows[0]?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          tenant_id: tenantId,
          user_id: user.id,
        },
      });
      customerId = customer.id;
    }

    // Create checkout session
    const siteUrl = process.env.SITE_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: plan.stripe_price_id_monthly || undefined,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${siteUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/subscription/cancel`,
      metadata: {
        tenant_id: tenantId,
        plan_id: planId,
      },
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (error: any) {
    console.error('Stripe checkout error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message || 'Unknown error' }),
    };
  }
};
