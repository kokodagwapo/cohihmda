import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Loader2, 
  CreditCard, 
  RefreshCw, 
  Plus, 
  Package,
  CheckCircle2,
  Key,
  ExternalLink,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { EditableText, EditableNumber } from '@/components/ui/EditableText';
import { CreatePlanDialog } from '@/components/admin/CreatePlanDialog';
import { StripeProjections } from '@/components/admin/StripeProjections';

interface Plan {
  id: string;
  name: string;
  display_name: string;
  price_monthly: number | string;
  price_yearly: number | string;
  features: Record<string, any>;
  deployment_options?: string[];
}

interface Subscription {
  id: string;
  plan_name: string;
  status: string;
  current_period_start?: string;
  current_period_end?: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
}

interface StripeSectionProps {
  subscriptionPlans: Plan[];
  subscriptions: Subscription[];
  loading: boolean;
  onRefresh: () => Promise<any>;
}

// Feature descriptions for display
const featureDescriptions: Record<string, string> = {
  max_users: 'Maximum Users',
  max_loans: 'Maximum Loans',
  support: 'Support Level',
  custom_branding: 'Custom Branding',
  api_access: 'API Access',
  advanced_analytics: 'Advanced Analytics',
  dedicated_support: 'Dedicated Support',
  sla_guarantee: 'SLA Guarantee',
  priority_support: 'Priority Support',
  custom_integrations: 'Custom Integrations',
  white_label: 'White Label',
  audit_logs: 'Audit Logs',
  sso: 'Single Sign-On (SSO)',
  multi_tenant: 'Multi-Tenant Support',
};

export const StripeSection = ({
  subscriptionPlans,
  subscriptions,
  loading,
  onRefresh,
}: StripeSectionProps) => {
  const { toast } = useToast();
  const [updatingPlan, setUpdatingPlan] = useState<string | null>(null);

  const updatePlan = useCallback(async (planId: string, updates: Partial<Plan>) => {
    setUpdatingPlan(planId);
    try {
      await api.request(`/api/subscriptions/plans/${planId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      toast({
        title: 'Plan Updated',
        description: 'Subscription plan updated successfully.',
      });
      await onRefresh();
    } catch (error: any) {
      toast({
        title: 'Update Failed',
        description: error.message || 'Failed to update plan.',
        variant: 'destructive',
      });
    } finally {
      setUpdatingPlan(null);
    }
  }, [onRefresh, toast]);

  const handleMonthlyPriceChange = useCallback((planId: string, value: number) => {
    updatePlan(planId, { price_monthly: value });
  }, [updatePlan]);

  const handleYearlyPriceChange = useCallback((planId: string, value: number) => {
    updatePlan(planId, { price_yearly: value });
  }, [updatePlan]);

  const handleCancelSubscription = async (subscriptionId: string) => {
    if (!confirm('Are you sure you want to cancel this subscription?')) return;
    
    try {
      await api.request(`/api/subscriptions/${subscriptionId}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason: 'User requested cancellation' }),
      });
      toast({
        title: 'Success',
        description: 'Subscription canceled successfully',
      });
      await onRefresh();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to cancel subscription',
        variant: 'destructive',
      });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Subscription Plans */}
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
                Subscription Plans
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light mt-1">
                Manage subscription plans and pricing
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <CreatePlanDialog onPlanCreated={onRefresh} />
              <Button
                onClick={onRefresh}
                variant="outline"
                size="sm"
                className="font-extralight"
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : subscriptionPlans.length === 0 ? (
            <div className="text-center py-12">
              <CreditCard className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
              <p className="text-sm text-slate-500 dark:text-slate-400 font-light">
                No subscription plans configured
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 font-light mt-2 mb-4">
                Default plans (Starter, Professional, Enterprise) should be created automatically on first run.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="font-extralight"
                onClick={() => {
                  toast({
                    title: 'Setup Plans',
                    description: 'Plans are created automatically. If missing, check database or restart server.',
                  });
                }}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Check Plans
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {subscriptionPlans.map((plan) => (
                <Card key={plan.id} className="border-slate-200 dark:border-slate-700">
                  <CardHeader>
                    <CardTitle className="text-lg font-thin text-slate-900 dark:text-white">
                      <EditableText
                        id={`plan-${plan.id}-display_name`}
                        defaultValue={plan.display_name}
                        onChange={(value) => updatePlan(plan.id, { display_name: String(value) })}
                      />
                    </CardTitle>
                    <div className="mt-2">
                      <span className="text-2xl font-light text-slate-900 dark:text-white">
                        $<EditableNumber
                          id={`plan-${plan.id}-price_monthly`}
                          defaultValue={parseFloat(String(plan.price_monthly))}
                          format={(v) => v.toFixed(2)}
                          onChange={(value) => handleMonthlyPriceChange(plan.id, value)}
                        />
                      </span>
                      <span className="text-sm text-slate-500 dark:text-slate-400 font-light">/month</span>
                    </div>
                    {plan.price_yearly && (() => {
                      const monthly = typeof plan.price_monthly === 'number' ? plan.price_monthly : parseFloat(String(plan.price_monthly));
                      const yearly = typeof plan.price_yearly === 'number' ? plan.price_yearly : parseFloat(String(plan.price_yearly));
                      const savingsPercent = Math.round((1 - yearly / (monthly * 12)) * 100);
                      return (
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-light mt-1">
                          $<EditableNumber
                            id={`plan-${plan.id}-price_yearly`}
                            defaultValue={yearly}
                            format={(v) => v.toFixed(2)}
                            onChange={(value) => handleYearlyPriceChange(plan.id, value)}
                          />/year (save {savingsPercent}%)
                        </p>
                      );
                    })()}
                  </CardHeader>
                  <CardContent>
                    {plan.features && typeof plan.features === 'object' && (
                      <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400 font-light">
                        {Object.entries(plan.features).map(([key, value]) => {
                          const featureDesc = featureDescriptions[key] || key.replace(/_/g, ' ');
                          const isNumeric = typeof value === 'number' || !isNaN(Number(value));
                          const displayValue = value === -1 ? 'Unlimited' : String(value);
                          
                          return (
                            <li key={key} className="flex flex-col gap-1">
                              <div className="flex items-start gap-2">
                                <CheckCircle2 className="h-3 w-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                                <div className="flex-1">
                                  <div className="font-medium text-slate-700 dark:text-slate-300">
                                    {featureDesc}
                                  </div>
                                  {isNumeric ? (
                                    <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                                      <EditableNumber
                                        id={`plan-${plan.id}-feature-${key}`}
                                        defaultValue={value === -1 ? -1 : Number(value)}
                                        format={(v) => v === -1 ? 'Unlimited' : String(v)}
                                        onChange={(newValue) => {
                                          const updatedFeatures = { ...plan.features, [key]: newValue };
                                          updatePlan(plan.id, { features: updatedFeatures });
                                        }}
                                      />
                                    </div>
                                  ) : (
                                    <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                                      <EditableText
                                        id={`plan-${plan.id}-feature-${key}`}
                                        defaultValue={displayValue}
                                        onChange={(newValue) => {
                                          const updatedFeatures = { ...plan.features, [key]: String(newValue) };
                                          updatePlan(plan.id, { features: updatedFeatures });
                                        }}
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {plan.deployment_options && plan.deployment_options.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-light mb-2">
                          Deployment Options:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {plan.deployment_options.map((option: string) => (
                            <Badge
                              key={option}
                              variant="outline"
                              className="text-xs border-slate-200 dark:border-slate-700"
                            >
                              {option.replace(/_/g, ' ')}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Subscriptions */}
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
            Active Subscriptions
          </CardTitle>
          <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
            Current tenant subscriptions and billing status
          </CardDescription>
        </CardHeader>
        <CardContent>
          {subscriptions.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
              <p className="text-sm text-slate-500 dark:text-slate-400 font-light">
                No active subscriptions
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 font-light mt-2 mb-4">
                Create a subscription via Stripe checkout or API
              </p>
              <Button
                variant="outline"
                size="sm"
                className="font-extralight"
                onClick={() => {
                  toast({
                    title: 'Create Subscription',
                    description: 'Use POST /api/subscriptions/checkout to create a new subscription.',
                  });
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Subscription
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {subscriptions && Array.isArray(subscriptions) && subscriptions.length > 0 ? subscriptions.map((subscription) => (
                <Card key={subscription.id} className="border-slate-200 dark:border-slate-700">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-base font-extralight text-slate-900 dark:text-white">
                            {subscription.plan_name || 'Unknown Plan'}
                          </h3>
                          <Badge
                            className={
                              subscription.status === 'active'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0'
                                : subscription.status === 'trialing'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-0'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0'
                            }
                          >
                            {subscription.status || 'Unknown'}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-xs text-slate-500 dark:text-slate-400 font-light">
                          {subscription.current_period_start && (
                            <div>
                              <span className="font-medium">Period Start:</span>{' '}
                              {new Date(subscription.current_period_start).toLocaleDateString()}
                            </div>
                          )}
                          {subscription.current_period_end && (
                            <div>
                              <span className="font-medium">Period End:</span>{' '}
                              {new Date(subscription.current_period_end).toLocaleDateString()}
                            </div>
                          )}
                          {subscription.stripe_customer_id && (
                            <div className="col-span-2">
                              <span className="font-medium">Customer ID:</span>{' '}
                              <span className="font-mono text-xs">{subscription.stripe_customer_id.substring(0, 20)}...</span>
                            </div>
                          )}
                          {subscription.stripe_subscription_id && (
                            <div className="col-span-2">
                              <span className="font-medium">Subscription ID:</span>{' '}
                              <span className="font-mono text-xs">{subscription.stripe_subscription_id.substring(0, 20)}...</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 ml-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCancelSubscription(subscription.id)}
                          className="text-red-600 hover:text-red-700 dark:text-red-400"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revenue Projections */}
      <StripeProjections />

      {/* Stripe Integration */}
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
            Stripe Integration
          </CardTitle>
          <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
            Configure Stripe payment processing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700 rounded-lg">
            <div className="flex items-start gap-3">
              <CreditCard className="h-5 w-5 text-violet-500 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-base font-extralight text-slate-900 dark:text-white mb-1">Stripe Dashboard</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-light mb-2">
                  Manage products, prices, and webhooks in Stripe Dashboard
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="font-extralight"
                  onClick={() => window.open('https://dashboard.stripe.com', '_blank')}
                >
                  <ExternalLink className="h-3 w-3 mr-2" />
                  Open Stripe Dashboard
                </Button>
              </div>
            </div>
          </div>
          <div className="p-4 bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700 rounded-lg">
            <div className="flex items-start gap-3">
              <Key className="h-5 w-5 text-amber-500 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-base font-extralight text-slate-900 dark:text-white mb-1">API Keys</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                  Configure STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in environment variables
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

