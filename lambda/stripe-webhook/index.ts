/**
 * Stripe Webhook Lambda Function
 * Handles Stripe webhook events for subscription management
 * Migrated from Supabase Edge Function
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import Stripe from 'stripe';
import { getSecret } from '../shared/secrets-manager.js';
import { query } from '../shared/database.js';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Get Stripe secrets
    const STRIPE_SECRET_KEY = await getSecret('coheus/stripe-secret-key');
    const STRIPE_WEBHOOK_SECRET = await getSecret('coheus/stripe-webhook-secret');
    
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2025-12-15.clover' as any,
    });

    const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    if (!signature) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No signature' }),
      };
    }

    const body = event.body || '';
    const webhookEvent = stripe.webhooks.constructEvent(
      body,
      signature,
      STRIPE_WEBHOOK_SECRET
    );

    switch (webhookEvent.type) {
      case 'checkout.session.completed': {
        const session = webhookEvent.data.object as Stripe.Checkout.Session;
        const tenantId = session.metadata?.tenant_id;
        const planId = session.metadata?.plan_id;

        if (tenantId && planId) {
          // Update or create subscription
          const existingSub = await query(
            `SELECT id FROM public.subscriptions WHERE tenant_id = $1`,
            [tenantId]
          );

          if (existingSub.rows.length > 0) {
            await query(
              `UPDATE public.subscriptions SET
                plan_id = $1,
                status = 'active',
                stripe_subscription_id = $2,
                stripe_customer_id = $3,
                current_period_start = $4,
                current_period_end = $5,
                cancel_at_period_end = false,
                updated_at = NOW()
               WHERE id = $6`,
              [
                planId,
                session.subscription as string,
                session.customer as string,
                new Date(session.created * 1000).toISOString(),
                new Date((session.created + 2592000) * 1000).toISOString(), // 30 days
                existingSub.rows[0].id,
              ]
            );
          } else {
            const newSub = await query(
              `INSERT INTO public.subscriptions 
               (tenant_id, plan_id, status, stripe_subscription_id, stripe_customer_id, current_period_start, current_period_end)
               VALUES ($1, $2, 'active', $3, $4, $5, $6)
               RETURNING id`,
              [
                tenantId,
                planId,
                session.subscription as string,
                session.customer as string,
                new Date(session.created * 1000).toISOString(),
                new Date((session.created + 2592000) * 1000).toISOString(),
              ]
            );

            if (newSub.rows.length > 0) {
              await query(
                `UPDATE public.tenants SET subscription_id = $1 WHERE id = $2`,
                [newSub.rows[0].id, tenantId]
              );
            }
          }
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = webhookEvent.data.object as Stripe.Subscription;
        
        await query(
          `UPDATE public.subscriptions SET
            status = $1,
            current_period_start = $2,
            current_period_end = $3,
            cancel_at_period_end = $4,
            updated_at = NOW()
           WHERE stripe_subscription_id = $5`,
          [
            subscription.status === 'active' ? 'active' : 'canceled',
            new Date((subscription as any).current_period_start * 1000).toISOString(),
            new Date((subscription as any).current_period_end * 1000).toISOString(),
            (subscription as any).cancel_at_period_end || false,
            subscription.id,
          ]
        );
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = webhookEvent.data.object as Stripe.Invoice;
        const subscriptionId = typeof (invoice as any).subscription === 'string' 
          ? (invoice as any).subscription 
          : (invoice as any).subscription?.id;
        
        if (subscriptionId) {
          await query(
            `UPDATE public.subscriptions SET
              status = 'active',
              current_period_start = $1,
              current_period_end = $2,
              updated_at = NOW()
             WHERE stripe_subscription_id = $3`,
            [
              new Date((invoice as any).period_start * 1000).toISOString(),
              new Date((invoice as any).period_end * 1000).toISOString(),
              subscriptionId,
            ]
          );
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = webhookEvent.data.object as Stripe.Invoice;
        const subscriptionId = typeof (invoice as any).subscription === 'string' 
          ? (invoice as any).subscription 
          : (invoice as any).subscription?.id;
        
        if (subscriptionId) {
          await query(
            `UPDATE public.subscriptions SET
              status = 'past_due',
              updated_at = NOW()
             WHERE stripe_subscription_id = $1`,
            [subscriptionId]
          );
        }
        break;
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true }),
    };
  } catch (error: any) {
    console.error('Webhook error:', error);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: error.message || 'Unknown error' }),
    };
  }
};
