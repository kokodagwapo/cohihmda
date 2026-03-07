import { useState, useCallback, useEffect } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

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

interface StripeData {
  plans: Plan[];
  subscriptions: Subscription[];
}

export const useStripeData = (enabled = true) => {
  const [loading, setLoading] = useState(false);
  const [subscriptionPlans, setSubscriptionPlans] = useState<Plan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const { toast } = useToast();

  const loadStripeData = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const [plansResponse, subscriptionsResponse] = await Promise.all([
        api.request<{ plans: Plan[] }>('/api/subscriptions/plans'),
        api.request<{ subscriptions: Subscription[] }>('/api/subscriptions'),
      ]);

      setSubscriptionPlans(plansResponse.plans || []);
      setSubscriptions(subscriptionsResponse.subscriptions || []);
    } catch (error: any) {
      console.error('Error loading Stripe data:', error);
      
      setSubscriptionPlans([]);
      setSubscriptions([]);
      
      if (error.status !== 404) {
        toast({
          title: 'Error Loading Stripe Data',
          description: error.message || 'Failed to load subscription data. Please try refreshing.',
          variant: 'destructive',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [toast, enabled]);

  useEffect(() => {
    loadStripeData();
  }, [loadStripeData]);

  return {
    subscriptionPlans,
    subscriptions,
    loading,
    loadStripeData,
  };
};

