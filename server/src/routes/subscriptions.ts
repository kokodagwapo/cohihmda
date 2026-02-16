import { Router } from 'express';
import express from 'express';
import { pool } from '../config/managementDatabase.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';
import Stripe from 'stripe';

const router = Router();

// Initialize Stripe (will be undefined if STRIPE_SECRET_KEY is not set)
// @ts-ignore - Using latest Stripe API version
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' as any })
  : null;

// Validation schemas
const checkoutSchema = z.object({
  planId: z.string().uuid(),
  deploymentType: z.enum(['on_premise', 'hybrid', 'per_lender_aws']),
  billingPeriod: z.enum(['monthly', 'yearly']).optional().default('monthly'),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  lenderName: z.string().optional(),
  lenderEmail: z.string().email().optional(),
});

const publicCheckoutSchema = z.object({
  planId: z.string().uuid(),
  deploymentType: z.enum(['on_premise', 'hybrid', 'per_lender_aws']),
  billingPeriod: z.enum(['monthly', 'yearly']).optional().default('monthly'),
  lenderName: z.string().min(1),
  lenderEmail: z.string().email(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

const cancelSubscriptionSchema = z.object({
  reason: z.string().optional(),
});

const createPlanSchema = z.object({
  name: z.string().min(1),
  display_name: z.string().min(1),
  price_monthly: z.number().min(0),
  price_yearly: z.number().min(0),
  features: z.record(z.any()).optional(),
  deployment_options: z.array(z.string()).optional(),
});

/**
 * GET /api/subscriptions/plans
 * List all available subscription plans
 */
router.get('/plans', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, display_name, price_monthly, price_yearly, features, deployment_options, is_active
       FROM public.subscription_plans
       WHERE is_active = true
       ORDER BY price_monthly ASC`
    );

    res.json({ plans: result.rows });
  } catch (error: any) {
    console.error('Error fetching subscription plans:', error);
    res.status(500).json({ error: 'Failed to fetch subscription plans' });
  }
});

/**
 * PUT /api/subscriptions/plans/:id
 * Update a subscription plan (admin only)
 */
router.put('/plans/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const planId = req.params.id;
    const { display_name, price_monthly, price_yearly, features, deployment_options } = req.body;

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (display_name !== undefined) {
      updates.push(`display_name = $${paramIndex++}`);
      values.push(display_name);
    }
    if (price_monthly !== undefined) {
      updates.push(`price_monthly = $${paramIndex++}`);
      values.push(price_monthly);
    }
    if (price_yearly !== undefined) {
      updates.push(`price_yearly = $${paramIndex++}`);
      values.push(price_yearly);
    }
    if (features !== undefined) {
      updates.push(`features = $${paramIndex++}::jsonb`);
      values.push(JSON.stringify(features));
    }
    if (deployment_options !== undefined) {
      updates.push(`deployment_options = $${paramIndex++}`);
      values.push(deployment_options);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(planId);

    const query = `
      UPDATE public.subscription_plans
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, name, display_name, price_monthly, price_yearly, features, deployment_options, is_active
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    res.json({ plan: result.rows[0] });
  } catch (error: any) {
    console.error('Error updating subscription plan:', error);
    res.status(500).json({ error: 'Failed to update subscription plan' });
  }
});

/**
 * GET /api/subscriptions/current
 * Get current subscription for authenticated tenant
 */
router.get('/current', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Get subscription with plan details
    const subscriptionResult = await pool.query(
      `SELECT 
        ts.id,
        ts.status,
        ts.current_period_start,
        ts.current_period_end,
        ts.deployment_type,
        ts.stripe_subscription_id,
        sp.name as plan_name,
        sp.display_name as plan_display_name,
        sp.price_monthly,
        sp.price_yearly,
        sp.features
       FROM public.tenant_subscriptions ts
       JOIN public.subscription_plans sp ON ts.plan_id = sp.id
       WHERE ts.tenant_id = $1
       ORDER BY ts.created_at DESC
       LIMIT 1`,
      [tenantId]
    );

    if (subscriptionResult.rows.length === 0) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    res.json({ subscription: subscriptionResult.rows[0] });
  } catch (error: any) {
    console.error('Error fetching current subscription:', error);
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

/**
 * GET /api/subscriptions
 * List all tenant subscriptions (admin only)
 */
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    // Get all subscriptions with plan and tenant details
    const result = await pool.query(
      `SELECT 
        ts.id,
        ts.tenant_id,
        ts.status,
        ts.current_period_start,
        ts.current_period_end,
        ts.deployment_type,
        ts.stripe_subscription_id,
        ts.stripe_customer_id,
        ts.created_at,
        sp.name as plan_name,
        sp.display_name as plan_display_name,
        t.name as tenant_name
       FROM public.tenant_subscriptions ts
       JOIN public.subscription_plans sp ON ts.plan_id = sp.id
       LEFT JOIN public.coheus_tenants t ON ts.tenant_id::text = t.id::text
       ORDER BY ts.created_at DESC`
    );

    res.json({ subscriptions: result.rows });
  } catch (error: any) {
    console.error('Error fetching subscriptions:', error);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

/**
 * POST /api/subscriptions/checkout
 * Create Stripe checkout session for new subscription (authenticated users)
 */
router.post('/checkout', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured' });
    }

    const { planId, deploymentType, billingPeriod, successUrl, cancelUrl, lenderName, lenderEmail } = checkoutSchema.parse(req.body);

    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Get plan details
    const planResult = await pool.query(
      'SELECT * FROM public.subscription_plans WHERE id = $1 AND is_active = true',
      [planId]
    );

    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const plan = planResult.rows[0];

    // Check if deployment type is allowed for this plan
    if (!plan.deployment_options.includes(deploymentType)) {
      return res.status(400).json({
        error: `Deployment type '${deploymentType}' is not available for plan '${plan.name}'`,
      });
    }

    // Get or create Stripe customer
    let stripeCustomerId: string;
    const existingSubscription = await pool.query(
      'SELECT stripe_customer_id FROM public.tenant_subscriptions WHERE tenant_id = $1',
      [tenantId]
    );

    if (existingSubscription.rows.length > 0 && existingSubscription.rows[0].stripe_customer_id) {
      stripeCustomerId = existingSubscription.rows[0].stripe_customer_id;
    } else {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: req.userEmail,
        metadata: {
          tenant_id: tenantId,
        },
      });
      stripeCustomerId = customer.id;
    }

    // Determine price and interval based on billing period
    const isYearly = billingPeriod === 'yearly';
    const price = isYearly ? plan.price_yearly : plan.price_monthly;
    const interval = isYearly ? 'year' : 'month';
    const unitAmount = Math.round(price * 100); // Convert to cents

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${plan.display_name} Plan`,
              description: `Coheus ${plan.display_name} - ${deploymentType} deployment (${isYearly ? 'Annual' : 'Monthly'} billing)`,
            },
            recurring: {
              interval: interval,
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl || `${process.env.FRONTEND_URL || 'http://localhost:8081'}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${process.env.FRONTEND_URL || 'http://localhost:8081'}/subscription/cancel`,
      metadata: {
        tenant_id: tenantId,
        plan_id: planId,
        deployment_type: deploymentType,
        billing_period: billingPeriod || 'monthly',
        lender_name: lenderName || req.userEmail?.split('@')[0] || 'Lender',
        lender_email: lenderEmail || req.userEmail || '',
      },
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/**
 * POST /api/subscriptions/checkout/public
 * Create Stripe checkout session for new subscription (public - no auth required)
 * Used for landing page signups
 */
router.post('/checkout/public', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured' });
    }

    const { planId, deploymentType, billingPeriod, lenderName, lenderEmail, successUrl, cancelUrl } = publicCheckoutSchema.parse(req.body);

    // Get plan details
    const planResult = await pool.query(
      'SELECT * FROM public.subscription_plans WHERE id = $1 AND is_active = true',
      [planId]
    );

    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const plan = planResult.rows[0];

    // Check if deployment type is allowed for this plan
    if (!plan.deployment_options.includes(deploymentType) && !plan.deployment_options.includes('hybrid')) {
      return res.status(400).json({
        error: `Deployment type '${deploymentType}' is not available for plan '${plan.name}'`,
      });
    }

    // Create or get Stripe customer by email
    let stripeCustomerId: string;
    const existingCustomers = await stripe.customers.list({
      email: lenderEmail,
      limit: 1,
    });

    if (existingCustomers.data.length > 0) {
      stripeCustomerId = existingCustomers.data[0].id;
    } else {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: lenderEmail,
        name: lenderName,
        metadata: {
          lender_name: lenderName,
        },
      });
      stripeCustomerId = customer.id;
    }

    // Determine price and interval based on billing period
    const isYearly = billingPeriod === 'yearly';
    const price = isYearly ? plan.price_yearly : plan.price_monthly;
    const interval = isYearly ? 'year' : 'month';
    const unitAmount = Math.round(price * 100); // Convert to cents

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${plan.display_name} Plan`,
              description: `Coheus ${plan.display_name} - ${deploymentType === 'per_lender_aws' ? 'Per-Lender AWS' : deploymentType} deployment (${isYearly ? 'Annual' : 'Monthly'} billing)`,
            },
            recurring: {
              interval: interval,
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl || `${process.env.FRONTEND_URL || 'http://localhost:8081'}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${process.env.FRONTEND_URL || 'http://localhost:8081'}`,
      metadata: {
        plan_id: planId,
        deployment_type: deploymentType,
        billing_period: billingPeriod || 'monthly',
        lender_name: lenderName,
        lender_email: lenderEmail,
        // tenant_id will be created in webhook if doesn't exist
      },
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error creating public checkout session:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/**
 * POST /api/subscriptions/webhook
 * Handle Stripe webhook events
 * Note: This endpoint should be publicly accessible and verify webhook signatures
 * IMPORTANT: This route must use express.raw() middleware to preserve raw body for signature verification
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured' });
    }

    const sig = req.headers['stripe-signature'];
    if (!sig) {
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('STRIPE_WEBHOOK_SECRET is not set');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    let event: Stripe.Event;
    try {
      // req.body is a Buffer when using express.raw()
      const body = req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body));
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription);
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentSucceeded(invoice);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice);
        break;
      }
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * GET /api/subscriptions/provisioning-status/:sessionId
 * Get provisioning status for a checkout session
 */
router.get('/provisioning-status/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured' });
    }

    // Get checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const deploymentType = session.metadata?.deployment_type;

    // If not per-lender AWS, return immediately
    if (deploymentType !== 'per_lender_aws') {
      return res.json({
        status: 'completed',
        provisioningStatus: null,
        progress: 100,
        estimatedTimeRemaining: 0,
        errorMessage: null,
        infrastructureUrl: null,
        adminUrl: null,
        deploymentType: deploymentType || 'on_premise',
      });
    }

    // Find tenant by checkout session ID
    const subscriptionResult = await pool.query(
      `SELECT tenant_id 
       FROM public.tenant_subscriptions 
       WHERE stripe_checkout_session_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [sessionId]
    );

    if (subscriptionResult.rows.length === 0) {
      // Check if tenant_id is in metadata (for public checkout)
      const tenantId = session.metadata?.tenant_id;
      if (!tenantId) {
        return res.status(404).json({ error: 'Subscription not found for this session' });
      }

      // Get provisioning status
      const { getProvisioningStatus } = await import('../services/awsProvisioning.js');
      const status = await getProvisioningStatus(tenantId);

      return res.json({
        ...status,
        deploymentType: 'per_lender_aws',
      });
    }

    const tenantId = subscriptionResult.rows[0].tenant_id;

    // Get provisioning status
    const { getProvisioningStatus } = await import('../services/awsProvisioning.js');
    const status = await getProvisioningStatus(tenantId);

    // Get admin credentials if provisioning is complete
    let adminCredentials = null;
    if (status.status === 'active' && status.provisioningStatus === 'completed') {
      const deploymentResult = await pool.query(
        `SELECT metadata 
         FROM public.aws_deployments 
         WHERE tenant_id = $1`,
        [tenantId]
      );

      if (deploymentResult.rows.length > 0 && deploymentResult.rows[0].metadata) {
        const metadata = deploymentResult.rows[0].metadata;
        adminCredentials = {
          username: metadata.admin_username,
          password: metadata.admin_password,
        };
      }
    }

    res.json({
      ...status,
      deploymentType: 'per_lender_aws',
      adminCredentials,
    });
  } catch (error: any) {
    console.error('Error fetching provisioning status:', error);
    res.status(500).json({ error: 'Failed to fetch provisioning status' });
  }
});

/**
 * POST /api/subscriptions/cancel
 * Cancel current subscription
 */
router.post('/cancel', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { reason } = cancelSubscriptionSchema.parse(req.body);

    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Get subscription
    const subscriptionResult = await pool.query(
      'SELECT id, stripe_subscription_id, status FROM public.tenant_subscriptions WHERE tenant_id = $1',
      [tenantId]
    );

    if (subscriptionResult.rows.length === 0) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    const subscription = subscriptionResult.rows[0];

    // Cancel in Stripe if exists
    if (subscription.stripe_subscription_id && stripe) {
      try {
        await stripe.subscriptions.cancel(subscription.stripe_subscription_id);
      } catch (error: any) {
        console.error('Error canceling Stripe subscription:', error);
        // Continue with database update even if Stripe fails
      }
    }

    // Update database
    await pool.query(
      `UPDATE public.tenant_subscriptions
       SET status = 'canceled', updated_at = NOW()
       WHERE id = $1`,
      [subscription.id]
    );

    res.json({ message: 'Subscription canceled successfully' });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error canceling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// ============================================================================
// STRIPE WEBHOOK HANDLERS
// ============================================================================

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const existingTenantId = session.metadata?.tenant_id;
  const planId = session.metadata?.plan_id;
  const deploymentType = session.metadata?.deployment_type;
  const lenderName = session.metadata?.lender_name || 'Lender';
  const lenderEmail = session.metadata?.lender_email || session.customer_email || '';

  if (!planId || !deploymentType) {
    console.error('Missing required metadata in checkout session:', session.id);
    return;
  }

  // Get subscription from Stripe
  const subscriptionId = session.subscription as string;
  if (!subscriptionId) {
    console.error('No subscription ID in checkout session:', session.id);
    return;
  }

  const stripeSubscription = await stripe!.subscriptions.retrieve(subscriptionId);

  let tenantId = existingTenantId;

  // Create tenant if doesn't exist (for public checkout flow)
  if (!tenantId) {
    // Create tenant in management database
    const tenantResult = await pool.query(
      `INSERT INTO public.coheus_tenants (name, status, created_at, updated_at)
       VALUES ($1, 'active', NOW(), NOW())
       RETURNING id`,
      [lenderName]
    );
    tenantId = tenantResult.rows[0].id;

    console.log(`✅ Created new tenant ${tenantId} for ${lenderEmail}`);
  }

  // Create or update tenant subscription
  await pool.query(
    `INSERT INTO public.tenant_subscriptions
     (tenant_id, plan_id, stripe_customer_id, stripe_subscription_id, status, 
      current_period_start, current_period_end, deployment_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id) DO UPDATE
     SET plan_id = EXCLUDED.plan_id,
         stripe_customer_id = EXCLUDED.stripe_customer_id,
         stripe_subscription_id = EXCLUDED.stripe_subscription_id,
         status = EXCLUDED.status,
         current_period_start = EXCLUDED.current_period_start,
         current_period_end = EXCLUDED.current_period_end,
         deployment_type = EXCLUDED.deployment_type,
         updated_at = NOW()`,
    [
      tenantId,
      planId,
      session.customer as string,
      subscriptionId,
      stripeSubscription.status === 'active' ? 'active' : 'trialing',
      new Date(stripeSubscription.current_period_start * 1000),
      new Date(stripeSubscription.current_period_end * 1000),
      deploymentType,
    ]
  );

  console.log(`✅ Subscription created for tenant ${tenantId}`);

  // Send provisioning started email
  try {
    const { sendProvisioningStartedEmail } = await import('../services/emailService.js');
    await sendProvisioningStartedEmail(lenderEmail, lenderName, deploymentType);
  } catch (emailError: any) {
    console.error('Failed to send provisioning started email:', emailError);
    // Don't fail webhook if email fails
  }

  // Trigger AWS provisioning for per-lender AWS deployments
  if (deploymentType === 'per_lender_aws') {
    try {
      // Import provisioning service
      const { provisionLenderInfrastructure } = await import('../services/awsProvisioning.js');
      
      // Trigger provisioning asynchronously (don't block webhook response)
      // Use setTimeout to ensure webhook response is sent first
      setTimeout(() => {
        provisionLenderInfrastructure(tenantId, lenderName, lenderEmail, session.id).catch(async (error) => {
          console.error('Error triggering AWS provisioning:', error);
          
          // Log error to database for manual intervention
          try {
            await pool.query(
              `INSERT INTO public.aws_deployments 
               (tenant_id, status, error_message, provisioning_started_at)
               VALUES ($1, 'failed', $2, NOW())
               ON CONFLICT (tenant_id) DO UPDATE
               SET status = 'failed', error_message = $2, updated_at = NOW()`,
              [tenantId, error.message || 'Unknown provisioning error']
            );

            // Send error notification email
            const { sendProvisioningErrorEmail } = await import('../services/emailService.js');
            await sendProvisioningErrorEmail(lenderEmail, lenderName, error.message || 'Unknown provisioning error');
          } catch (dbError) {
            console.error('Failed to log provisioning error:', dbError);
          }
        });
      }, 1000); // Wait 1 second before starting provisioning
    } catch (error: any) {
      console.error('Failed to import or trigger AWS provisioning:', error);
      // Don't fail the webhook - provisioning can be retried manually
    }
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  await pool.query(
    `UPDATE public.tenant_subscriptions
     SET status = $1,
         current_period_start = $2,
         current_period_end = $3,
         updated_at = NOW()
     WHERE stripe_subscription_id = $4`,
    [
      subscription.status === 'active' ? 'active' : 'past_due',
      new Date(subscription.current_period_start * 1000),
      new Date(subscription.current_period_end * 1000),
      subscription.id,
    ]
  );
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  await pool.query(
    `UPDATE public.tenant_subscriptions
     SET status = 'canceled', updated_at = NOW()
     WHERE stripe_subscription_id = $1`,
    [subscription.id]
  );
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  const subscriptionId = invoice.subscription as string;
  if (!subscriptionId) return;

  await pool.query(
    `UPDATE public.tenant_subscriptions
     SET status = 'active', updated_at = NOW()
     WHERE stripe_subscription_id = $1`,
    [subscriptionId]
  );
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId = invoice.subscription as string;
  if (!subscriptionId) return;

  await pool.query(
    `UPDATE public.tenant_subscriptions
     SET status = 'past_due', updated_at = NOW()
     WHERE stripe_subscription_id = $1`,
    [subscriptionId]
  );
}

/**
 * DELETE /api/subscriptions/:id
 * Cancel a subscription
 */
router.delete('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const subscriptionId = req.params.id;
    const { reason } = cancelSubscriptionSchema.parse(req.body);

    // Get subscription from database
    const result = await pool.query(
      'SELECT * FROM public.tenant_subscriptions WHERE id = $1',
      [subscriptionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const subscription = result.rows[0];

    // Cancel in Stripe if stripe_subscription_id exists
    if (stripe && subscription.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(subscription.stripe_subscription_id, {
          cancellation_details: reason ? { comment: reason } : undefined,
        });
      } catch (stripeError: any) {
        console.error('Stripe cancellation error:', stripeError);
        // Continue even if Stripe fails - update local status
      }
    }

    // Update status in database
    await pool.query(
      `UPDATE public.tenant_subscriptions
       SET status = 'canceled', updated_at = NOW()
       WHERE id = $1`,
      [subscriptionId]
    );

    res.json({ message: 'Subscription canceled successfully', subscription: { ...subscription, status: 'canceled' } });
  } catch (error: any) {
    console.error('Error canceling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

/**
 * POST /api/subscriptions/plans
 * Create a custom subscription plan (admin only)
 */
router.post('/plans', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { name, display_name, price_monthly, price_yearly, features, deployment_options } = createPlanSchema.parse(req.body);

    const result = await pool.query(
      `INSERT INTO public.subscription_plans
       (name, display_name, price_monthly, price_yearly, features, deployment_options, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, true, NOW(), NOW())
       RETURNING *`,
      [
        name,
        display_name,
        price_monthly,
        price_yearly,
        JSON.stringify(features || {}),
        deployment_options || ['cloud'],
      ]
    );

    res.status(201).json({ plan: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error creating plan:', error);
    res.status(500).json({ error: 'Failed to create subscription plan' });
  }
});

/**
 * DELETE /api/subscriptions/plans/:id
 * Delete (soft delete) a subscription plan
 */
router.delete('/plans/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const planId = req.params.id;

    // Soft delete - set is_active to false
    const result = await pool.query(
      `UPDATE public.subscription_plans
       SET is_active = false, updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, display_name`,
      [planId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    res.json({ message: 'Plan deleted successfully', plan: result.rows[0] });
  } catch (error: any) {
    console.error('Error deleting plan:', error);
    res.status(500).json({ error: 'Failed to delete subscription plan' });
  }
});

/**
 * GET /api/subscriptions/projections
 * Calculate revenue projections for different customer counts
 */
router.get('/projections', authenticateToken, async (req: AuthRequest, res) => {
  try {
    // Get all active plans
    const plansResult = await pool.query(
      `SELECT id, name, display_name, price_monthly, price_yearly
       FROM public.subscription_plans
       WHERE is_active = true
       ORDER BY price_monthly ASC`
    );

    const plans = plansResult.rows;
    const customerCounts = [5, 10, 15, 25, 50, 100, 250, 500, 750, 1000];

    // Calculate projections for each plan and customer count
    const projections = customerCounts.map(count => {
      const planProjections: Record<string, any> = {
        customers: count,
      };

      plans.forEach(plan => {
        const monthlyRevenue = parseFloat(plan.price_monthly) * count;
        const yearlyRevenue = parseFloat(plan.price_yearly) * count;
        
        planProjections[plan.name] = {
          plan_id: plan.id,
          display_name: plan.display_name,
          monthly_revenue: monthlyRevenue,
          yearly_revenue: yearlyRevenue,
          monthly_formatted: `$${monthlyRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          yearly_formatted: `$${yearlyRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        };
      });

      return planProjections;
    });

    res.json({ projections, plans: plans.map(p => ({ id: p.id, name: p.name, display_name: p.display_name })) });
  } catch (error: any) {
    console.error('Error calculating projections:', error);
    res.status(500).json({ error: 'Failed to calculate projections' });
  }
});

export default router;

