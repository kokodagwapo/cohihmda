# SaaS Setup Guide

This guide will help you set up the SaaS features of the application.

## Prerequisites

1. Supabase account and project
2. Stripe account (test mode for development)
3. Node.js and npm installed

## Step 1: Database Setup

1. Open your Supabase project dashboard
2. Navigate to SQL Editor
3. Run the migrations in order:
   - `supabase/migrations/20251004190220_ea7aa481-2790-4e74-b2e7-907ae5ca82e0.sql`
   - `supabase/migrations/20251004191659_cff3630f-bdbd-49d3-ab8a-3f557d20f954.sql`
   - `supabase/migrations/20250105000000_subscription_billing.sql`

This will create:
- Subscription plans table with default plans (Free, Pro, Enterprise)
- Subscriptions table
- Usage metrics table
- Payment methods table
- API keys table
- All necessary RLS policies
- Database functions for usage tracking

## Step 2: Stripe Configuration

### Create Stripe Products and Prices

1. Log in to your Stripe Dashboard
2. Go to Products
3. Create products for each plan:
   - **Pro Plan**: $99/month recurring
   - **Enterprise Plan**: $499/month recurring
4. Copy the Price IDs (e.g., `price_xxxxx`)

### Update Database with Stripe Price IDs

Run this SQL in Supabase SQL Editor:

```sql
UPDATE subscription_plans 
SET stripe_price_id_monthly = 'price_your_pro_monthly_id'
WHERE name = 'pro';

UPDATE subscription_plans 
SET stripe_price_id_monthly = 'price_your_enterprise_monthly_id'
WHERE name = 'enterprise';
```

## Step 3: Environment Variables

1. Copy `.env.example` to `.env`
2. Fill in your values:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_key
SITE_URL=http://localhost:5173
```

## Step 4: Supabase Edge Functions

### Deploy Functions

1. Install Supabase CLI:
```bash
npm install -g supabase
```

2. Login to Supabase:
```bash
supabase login
```

3. Link your project:
```bash
supabase link --project-ref your-project-ref
```

4. Set secrets:
```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_your_secret_key
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

5. Deploy functions:
```bash
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
```

## Step 5: Stripe Webhook Setup

1. In Stripe Dashboard, go to Developers > Webhooks
2. Click "Add endpoint"
3. Enter your webhook URL:
   ```
   https://your-project.supabase.co/functions/v1/stripe-webhook
   ```
4. Select events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy the webhook signing secret
6. Update the `STRIPE_WEBHOOK_SECRET` in Supabase secrets

## Step 6: Testing

### Test Subscription Flow

1. Start the development server: `npm run dev`
2. Create a test account
3. Navigate to Settings > Billing
4. Click "Upgrade" on a paid plan
5. Use Stripe test card: `4242 4242 4242 4242`
6. Complete checkout
7. Verify subscription is created in database

### Test Usage Tracking

1. Start a voice call in Agentic mode
2. Check Dashboard for usage metrics
3. Verify limits are enforced when exceeded

## Step 7: Admin Access

To access the admin dashboard:

1. Update the admin email check in `src/pages/Admin.tsx`:
```typescript
const adminEmails = ['your-admin@email.com'];
```

2. Or implement a proper role-based system with a `roles` table

## Troubleshooting

### Webhook Not Working

- Verify webhook URL is correct
- Check Stripe webhook logs for errors
- Ensure `STRIPE_WEBHOOK_SECRET` is set correctly
- Verify function is deployed: `supabase functions list`

### Subscription Not Creating

- Check Stripe dashboard for checkout session
- Verify `stripe_price_id_monthly` is set in database
- Check browser console for errors
- Verify Edge Function logs in Supabase dashboard

### Usage Not Tracking

- Verify RLS policies allow inserts
- Check `record_usage` function permissions
- Ensure tenant_id is correctly linked to user profile

## Production Checklist

Before going to production:

- [ ] Switch Stripe to live mode
- [ ] Update environment variables with production keys
- [ ] Set up production Supabase project
- [ ] Configure production webhook URL
- [ ] Set up monitoring/error tracking (Sentry, etc.)
- [ ] Configure email notifications
- [ ] Set up backup strategy
- [ ] Review and test all RLS policies
- [ ] Set up rate limiting
- [ ] Configure CORS properly
- [ ] Enable Supabase database backups

## Additional Features to Consider

- Email notifications (welcome, billing, usage alerts)
- Usage analytics dashboard
- Team member invitations
- SSO for Enterprise plan
- Custom domain support
- White-label options
- Advanced reporting
- Export functionality (GDPR compliance)



This guide will help you set up the SaaS features of the application.

## Prerequisites

1. Supabase account and project
2. Stripe account (test mode for development)
3. Node.js and npm installed

## Step 1: Database Setup

1. Open your Supabase project dashboard
2. Navigate to SQL Editor
3. Run the migrations in order:
   - `supabase/migrations/20251004190220_ea7aa481-2790-4e74-b2e7-907ae5ca82e0.sql`
   - `supabase/migrations/20251004191659_cff3630f-bdbd-49d3-ab8a-3f557d20f954.sql`
   - `supabase/migrations/20250105000000_subscription_billing.sql`

This will create:
- Subscription plans table with default plans (Free, Pro, Enterprise)
- Subscriptions table
- Usage metrics table
- Payment methods table
- API keys table
- All necessary RLS policies
- Database functions for usage tracking

## Step 2: Stripe Configuration

### Create Stripe Products and Prices

1. Log in to your Stripe Dashboard
2. Go to Products
3. Create products for each plan:
   - **Pro Plan**: $99/month recurring
   - **Enterprise Plan**: $499/month recurring
4. Copy the Price IDs (e.g., `price_xxxxx`)

### Update Database with Stripe Price IDs

Run this SQL in Supabase SQL Editor:

```sql
UPDATE subscription_plans 
SET stripe_price_id_monthly = 'price_your_pro_monthly_id'
WHERE name = 'pro';

UPDATE subscription_plans 
SET stripe_price_id_monthly = 'price_your_enterprise_monthly_id'
WHERE name = 'enterprise';
```

## Step 3: Environment Variables

1. Copy `.env.example` to `.env`
2. Fill in your values:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_key
SITE_URL=http://localhost:5173
```

## Step 4: Supabase Edge Functions

### Deploy Functions

1. Install Supabase CLI:
```bash
npm install -g supabase
```

2. Login to Supabase:
```bash
supabase login
```

3. Link your project:
```bash
supabase link --project-ref your-project-ref
```

4. Set secrets:
```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_your_secret_key
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

5. Deploy functions:
```bash
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
```

## Step 5: Stripe Webhook Setup

1. In Stripe Dashboard, go to Developers > Webhooks
2. Click "Add endpoint"
3. Enter your webhook URL:
   ```
   https://your-project.supabase.co/functions/v1/stripe-webhook
   ```
4. Select events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy the webhook signing secret
6. Update the `STRIPE_WEBHOOK_SECRET` in Supabase secrets

## Step 6: Testing

### Test Subscription Flow

1. Start the development server: `npm run dev`
2. Create a test account
3. Navigate to Settings > Billing
4. Click "Upgrade" on a paid plan
5. Use Stripe test card: `4242 4242 4242 4242`
6. Complete checkout
7. Verify subscription is created in database

### Test Usage Tracking

1. Start a voice call in Agentic mode
2. Check Dashboard for usage metrics
3. Verify limits are enforced when exceeded

## Step 7: Admin Access

To access the admin dashboard:

1. Update the admin email check in `src/pages/Admin.tsx`:
```typescript
const adminEmails = ['your-admin@email.com'];
```

2. Or implement a proper role-based system with a `roles` table

## Troubleshooting

### Webhook Not Working

- Verify webhook URL is correct
- Check Stripe webhook logs for errors
- Ensure `STRIPE_WEBHOOK_SECRET` is set correctly
- Verify function is deployed: `supabase functions list`

### Subscription Not Creating

- Check Stripe dashboard for checkout session
- Verify `stripe_price_id_monthly` is set in database
- Check browser console for errors
- Verify Edge Function logs in Supabase dashboard

### Usage Not Tracking

- Verify RLS policies allow inserts
- Check `record_usage` function permissions
- Ensure tenant_id is correctly linked to user profile

## Production Checklist

Before going to production:

- [ ] Switch Stripe to live mode
- [ ] Update environment variables with production keys
- [ ] Set up production Supabase project
- [ ] Configure production webhook URL
- [ ] Set up monitoring/error tracking (Sentry, etc.)
- [ ] Configure email notifications
- [ ] Set up backup strategy
- [ ] Review and test all RLS policies
- [ ] Set up rate limiting
- [ ] Configure CORS properly
- [ ] Enable Supabase database backups

## Additional Features to Consider

- Email notifications (welcome, billing, usage alerts)
- Usage analytics dashboard
- Team member invitations
- SSO for Enterprise plan
- Custom domain support
- White-label options
- Advanced reporting
- Export functionality (GDPR compliance)



This guide will help you set up the SaaS features of the application.

## Prerequisites

1. Supabase account and project
2. Stripe account (test mode for development)
3. Node.js and npm installed

## Step 1: Database Setup

1. Open your Supabase project dashboard
2. Navigate to SQL Editor
3. Run the migrations in order:
   - `supabase/migrations/20251004190220_ea7aa481-2790-4e74-b2e7-907ae5ca82e0.sql`
   - `supabase/migrations/20251004191659_cff3630f-bdbd-49d3-ab8a-3f557d20f954.sql`
   - `supabase/migrations/20250105000000_subscription_billing.sql`

This will create:
- Subscription plans table with default plans (Free, Pro, Enterprise)
- Subscriptions table
- Usage metrics table
- Payment methods table
- API keys table
- All necessary RLS policies
- Database functions for usage tracking

## Step 2: Stripe Configuration

### Create Stripe Products and Prices

1. Log in to your Stripe Dashboard
2. Go to Products
3. Create products for each plan:
   - **Pro Plan**: $99/month recurring
   - **Enterprise Plan**: $499/month recurring
4. Copy the Price IDs (e.g., `price_xxxxx`)

### Update Database with Stripe Price IDs

Run this SQL in Supabase SQL Editor:

```sql
UPDATE subscription_plans 
SET stripe_price_id_monthly = 'price_your_pro_monthly_id'
WHERE name = 'pro';

UPDATE subscription_plans 
SET stripe_price_id_monthly = 'price_your_enterprise_monthly_id'
WHERE name = 'enterprise';
```

## Step 3: Environment Variables

1. Copy `.env.example` to `.env`
2. Fill in your values:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_key
SITE_URL=http://localhost:5173
```

## Step 4: Supabase Edge Functions

### Deploy Functions

1. Install Supabase CLI:
```bash
npm install -g supabase
```

2. Login to Supabase:
```bash
supabase login
```

3. Link your project:
```bash
supabase link --project-ref your-project-ref
```

4. Set secrets:
```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_your_secret_key
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

5. Deploy functions:
```bash
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
```

## Step 5: Stripe Webhook Setup

1. In Stripe Dashboard, go to Developers > Webhooks
2. Click "Add endpoint"
3. Enter your webhook URL:
   ```
   https://your-project.supabase.co/functions/v1/stripe-webhook
   ```
4. Select events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy the webhook signing secret
6. Update the `STRIPE_WEBHOOK_SECRET` in Supabase secrets

## Step 6: Testing

### Test Subscription Flow

1. Start the development server: `npm run dev`
2. Create a test account
3. Navigate to Settings > Billing
4. Click "Upgrade" on a paid plan
5. Use Stripe test card: `4242 4242 4242 4242`
6. Complete checkout
7. Verify subscription is created in database

### Test Usage Tracking

1. Start a voice call in Agentic mode
2. Check Dashboard for usage metrics
3. Verify limits are enforced when exceeded

## Step 7: Admin Access

To access the admin dashboard:

1. Update the admin email check in `src/pages/Admin.tsx`:
```typescript
const adminEmails = ['your-admin@email.com'];
```

2. Or implement a proper role-based system with a `roles` table

## Troubleshooting

### Webhook Not Working

- Verify webhook URL is correct
- Check Stripe webhook logs for errors
- Ensure `STRIPE_WEBHOOK_SECRET` is set correctly
- Verify function is deployed: `supabase functions list`

### Subscription Not Creating

- Check Stripe dashboard for checkout session
- Verify `stripe_price_id_monthly` is set in database
- Check browser console for errors
- Verify Edge Function logs in Supabase dashboard

### Usage Not Tracking

- Verify RLS policies allow inserts
- Check `record_usage` function permissions
- Ensure tenant_id is correctly linked to user profile

## Production Checklist

Before going to production:

- [ ] Switch Stripe to live mode
- [ ] Update environment variables with production keys
- [ ] Set up production Supabase project
- [ ] Configure production webhook URL
- [ ] Set up monitoring/error tracking (Sentry, etc.)
- [ ] Configure email notifications
- [ ] Set up backup strategy
- [ ] Review and test all RLS policies
- [ ] Set up rate limiting
- [ ] Configure CORS properly
- [ ] Enable Supabase database backups

## Additional Features to Consider

- Email notifications (welcome, billing, usage alerts)
- Usage analytics dashboard
- Team member invitations
- SSO for Enterprise plan
- Custom domain support
- White-label options
- Advanced reporting
- Export functionality (GDPR compliance)






