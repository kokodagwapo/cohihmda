import { Navigation } from '@/components/layout/Navigation';
import { Footer } from '@/components/layout/Footer';
import { 
  TrendingUp,
  CheckCircle2,
  Target,
  Activity,
  ArrowRight,
  Award,
  Newspaper,
  Filter,
  Brain,
  Sparkles,
  Play,
  BarChart3,
  Shield,
  Zap,
  ChevronDown,
  Network
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import AetherFlowHero from '@/components/ui/aether-flow-hero';
import { useEdit } from '@/contexts/EditContext';

import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTheme } from '@/components/theme-provider';
import { api } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader2, Check, Cloud, Server } from 'lucide-react';

// Core capabilities matching the actual platform
const capabilities = [
  {
    id: '1',
    title: 'AI Dialogues',
    icon: Brain,
    gradient: 'from-violet-500 to-purple-600',
    description: 'Strategic insights with reasoning. Understand not just what—but why.',
  },
  {
    id: '2',
    title: 'Live Metrics',
    icon: Activity,
    gradient: 'from-blue-500 to-cyan-600',
    description: 'Revenue, pipeline, margins, and cycle time—updated in real-time.',
  },
  {
    id: '3',
    title: 'Health Scores',
    icon: Target,
    gradient: 'from-emerald-500 to-teal-600',
    description: 'Profitability, operations, and risk exposure at a glance.',
  },
  {
    id: '4',
    title: 'Team Rankings',
    icon: Award,
    gradient: 'from-amber-500 to-orange-600',
    description: 'Performance badges and leaderboards for top producers.',
  },
  {
    id: '5',
    title: 'Pipeline Flow',
    icon: Filter,
    gradient: 'from-pink-500 to-rose-600',
    description: 'Visual funnel from application to funding with conversions.',
  },
  {
    id: '6',
    title: 'Market Intel',
    icon: Newspaper,
    gradient: 'from-slate-500 to-gray-600',
    description: 'Industry news with AI-powered executive summaries.',
  },
];

// Sample dialogues from Cohi
const CohiDialogues = [
  {
    type: 'growth',
    message: "Revenue at $158.2M—up 18.6% YTD. Positioned for a record year.",
    context: "Tracking trajectory against historical patterns."
  },
  {
    type: 'alert',
    message: "7 rate locks expire in 48 hours. $2.8M at risk.",
    context: "Flagging time-sensitive items requiring action."
  },
  {
    type: 'insight',
    message: "Margin per loan at $18.2K—above $17K target, top quartile.",
    context: "Benchmarking against industry standards."
  }
];

interface SubscriptionPlan {
  id: string;
  name: string;
  display_name: string;
  price_monthly: number;
  price_yearly: number;
  features: {
    max_users?: number;
    los_adapters?: number;
    storage_gb?: number;
    api_calls_per_month?: number;
  };
  deployment_options: string[];
}

const Index = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useEdit();
  const { setTheme } = useTheme();
  const { toast } = useToast();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [selectedDeploymentType, setSelectedDeploymentType] = useState<'on_premise' | 'per_lender_aws' | 'hybrid'>('on_premise');
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [loadingCheckout, setLoadingCheckout] = useState<string | null>(null);
  const [showLenderModal, setShowLenderModal] = useState(false);
  const [selectedPlanForModal, setSelectedPlanForModal] = useState<string | null>(null);
  const [lenderInfo, setLenderInfo] = useState({ name: '', email: '' });

  // Force light theme on landing page - always override any stored preference
  useEffect(() => {
    setTheme('light');
    // Also set it immediately to prevent flash of dark theme
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
  }, [setTheme]);

  // Only check bypass on initial mount, not on auth changes
  useEffect(() => {
    // Only trigger bypass redirect on initial page load (not when auth state changes from other pages)
    if (isAuthenticated && window.location.pathname === '/') {
      const bypassEnabled = localStorage.getItem('bypass-landing-page') === 'true';
      if (bypassEnabled) {
        navigate('/admin', { replace: true });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only on mount

  // Fetch subscription plans
  useEffect(() => {
    const fetchPlans = async () => {
      try {
        setLoadingPlans(true);
        const response = await api.request<{ plans: SubscriptionPlan[] }>('/api/subscriptions/plans');
        if (response.plans && response.plans.length > 0) {
          setPlans(response.plans);
        } else {
          // Fallback pricing if API returns empty or fails
          console.warn('No plans returned from API, using fallback');
          setPlans([
            {
              id: 'starter-fallback',
              name: 'starter',
              display_name: 'Starter',
              price_monthly: 499,
              price_yearly: 4990,
              features: { max_users: 5, los_adapters: 1, storage_gb: 10, api_calls_per_month: 10000 },
              deployment_options: ['on_premise']
            },
            {
              id: 'professional-fallback',
              name: 'professional',
              display_name: 'Professional',
              price_monthly: 999,
              price_yearly: 9990,
              features: { max_users: 25, los_adapters: 3, storage_gb: 100, api_calls_per_month: 100000 },
              deployment_options: ['on_premise', 'hybrid']
            },
            {
              id: 'enterprise-fallback',
              name: 'enterprise',
              display_name: 'Enterprise',
              price_monthly: 2499,
              price_yearly: 24990,
              features: { max_users: -1, los_adapters: -1, storage_gb: 1000, api_calls_per_month: -1 },
              deployment_options: ['on_premise', 'hybrid', 'per_lender_aws']
            }
          ]);
        }
      } catch (error: any) {
        console.error('Error fetching plans:', error);
        // Use fallback pricing on error
        setPlans([
          {
            id: 'starter-fallback',
            name: 'starter',
            display_name: 'Starter',
            price_monthly: 499,
            price_yearly: 4990,
            features: { max_users: 5, los_adapters: 1, storage_gb: 10, api_calls_per_month: 10000 },
            deployment_options: ['on_premise']
          },
          {
            id: 'professional-fallback',
            name: 'professional',
            display_name: 'Professional',
            price_monthly: 999,
            price_yearly: 9990,
            features: { max_users: 25, los_adapters: 3, storage_gb: 100, api_calls_per_month: 100000 },
            deployment_options: ['on_premise', 'hybrid']
          },
          {
            id: 'enterprise-fallback',
            name: 'enterprise',
            display_name: 'Enterprise',
            price_monthly: 2499,
            price_yearly: 24990,
            features: { max_users: -1, los_adapters: -1, storage_gb: 1000, api_calls_per_month: -1 },
            deployment_options: ['on_premise', 'hybrid', 'per_lender_aws']
          }
        ]);
        toast({
          title: 'Notice',
          description: 'Using default pricing. Some features may be unavailable.',
          variant: 'default',
        });
      } finally {
        setLoadingPlans(false);
      }
    };
    fetchPlans();
  }, [toast]);

  const handleGetStarted = async (planId: string) => {
    // For non-authenticated users, show a simple form to collect email and name
    if (!isAuthenticated) {
      setSelectedPlanForModal(planId);
      setShowLenderModal(true);
      return;
    }

    await initiateCheckout(planId);
  };

  const initiateCheckout = async (planId: string, customLenderInfo?: { name: string; email: string }) => {
    try {
      setLoadingCheckout(planId);
      
      const lenderName = customLenderInfo?.name?.trim();
      const lenderEmail = customLenderInfo?.email?.trim();

      // Validate lender info for non-authenticated users
      if (!isAuthenticated) {
        if (!lenderName || lenderName.length < 2) {
          toast({
            title: 'Invalid Name',
            description: 'Please enter a valid company or full name (at least 2 characters)',
            variant: 'destructive',
          });
          setLoadingCheckout(null);
          return;
        }

        if (!lenderEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lenderEmail)) {
          toast({
            title: 'Invalid Email',
            description: 'Please enter a valid email address',
            variant: 'destructive',
          });
          setLoadingCheckout(null);
          return;
        }
      }

      // Map frontend deployment type to backend format
      const backendDeploymentType = selectedDeploymentType === 'on_premise' ? 'on_premise' : 
                                    selectedDeploymentType === 'per_lender_aws' ? 'per_lender_aws' : 
                                    'hybrid';

      let response;
      
      if (!isAuthenticated) {
        // Create public checkout session
        response = await api.request<{ sessionId: string; url: string }>('/api/subscriptions/checkout/public', {
          method: 'POST',
          body: JSON.stringify({
            planId,
            deploymentType: backendDeploymentType,
            billingPeriod: billingPeriod,
            lenderName,
            lenderEmail,
            successUrl: `${window.location.origin}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${window.location.origin}/subscription/cancel`,
          }),
        });
      } else {
        // For authenticated users, use the authenticated endpoint
        response = await api.request<{ sessionId: string; url: string }>('/api/subscriptions/checkout', {
          method: 'POST',
          body: JSON.stringify({
            planId,
            deploymentType: backendDeploymentType,
            billingPeriod: billingPeriod,
            successUrl: `${window.location.origin}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${window.location.origin}/subscription/cancel`,
          }),
        });
      }

      // Close modal if open
      if (showLenderModal) {
        setShowLenderModal(false);
        setLenderInfo({ name: '', email: '' });
        setSelectedPlanForModal(null);
      }

      // Redirect to Stripe checkout
      if (response.url) {
        window.location.href = response.url;
      } else {
        throw new Error('No checkout URL received from server');
      }
    } catch (error: any) {
      console.error('Error creating checkout session:', error);
      
      // Provide more specific error messages
      let errorMessage = 'Failed to start checkout';
      if (error.message?.includes('Stripe is not configured')) {
        errorMessage = 'Payment processing is temporarily unavailable. Please contact support.';
      } else if (error.message?.includes('Plan not found')) {
        errorMessage = 'The selected plan is no longer available. Please refresh and try again.';
      } else if (error.message?.includes('Deployment type')) {
        errorMessage = 'The selected deployment type is not available for this plan.';
      } else if (error.message) {
        errorMessage = error.message;
      }

      toast({
        title: 'Checkout Error',
        description: errorMessage,
        variant: 'destructive',
      });
      setLoadingCheckout(null);
    }
  };

  return (
    <div className="relative min-h-screen bg-white dark:bg-slate-950 selection:bg-violet-500/20">
      <Navigation />
      
      {/* Hero */}
      <section className="relative">
        <AetherFlowHero />
      </section>

      {/* Capabilities Grid */}
      <section className="px-6 py-32 sm:py-40">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1 }}
            className="mb-20"
          >
            <p className="text-xs font-medium tracking-[0.2em] text-slate-600 dark:text-slate-400 uppercase mb-4">
              Capabilities
            </p>
            <h2 className="text-3xl sm:text-4xl font-extralight text-slate-900 dark:text-white tracking-tight leading-tight">
              Six ways to see clearly.
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-slate-200 dark:bg-slate-800 rounded-2xl overflow-hidden">
            {capabilities.map((cap, idx) => (
              <motion.div
                key={cap.id}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: idx * 0.08 }}
                className="group bg-white dark:bg-slate-950 p-8 sm:p-10 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors duration-300"
              >
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${cap.gradient} flex items-center justify-center mb-6 opacity-80 group-hover:opacity-100 transition-opacity`}>
                  <cap.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2 tracking-tight">
                  {cap.title}
                </h3>
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed font-light">
                  {cap.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Cohi Section */}
      <section className="px-6 py-32 sm:py-40 bg-slate-50 dark:bg-slate-900/50">
        <div className="mx-auto max-w-4xl">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1 }}
            className="mb-16"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <p className="text-xs font-medium tracking-[0.2em] text-violet-600 dark:text-violet-400 uppercase">
                Cohi AI
              </p>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extralight text-slate-900 dark:text-white tracking-tight leading-tight mb-4">
              Intelligence that thinks out loud.
            </h2>
            <p className="text-base text-slate-700 dark:text-slate-300 font-light max-w-xl">
              Every insight includes reasoning—so you know exactly why it matters.
            </p>
          </motion.div>

          <div className="space-y-4">
            {CohiDialogues.map((dialogue, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: idx * 0.1 }}
                className={`p-6 sm:p-8 rounded-xl border ${
                  dialogue.type === 'growth' 
                    ? 'bg-emerald-50/50 dark:bg-emerald-950/10 border-emerald-100 dark:border-emerald-900/30' 
                    : dialogue.type === 'alert'
                    ? 'bg-amber-50/50 dark:bg-amber-950/10 border-amber-100 dark:border-amber-900/30'
                    : 'bg-blue-50/50 dark:bg-blue-950/10 border-blue-100 dark:border-blue-900/30'
                }`}
              >
                <p className="text-base sm:text-lg text-slate-900 dark:text-slate-100 font-light mb-3">
                  "{dialogue.message}"
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 font-light flex items-center gap-2">
                  <Sparkles className="w-3 h-3" />
                  {dialogue.context}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Metrics */}
      <section className="px-6 py-32 sm:py-40">
        <div className="mx-auto max-w-5xl">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1 }}
            className="grid grid-cols-2 lg:grid-cols-4 gap-12 sm:gap-16"
          >
            {[
              { value: '$158M', label: 'Revenue', change: '+18.6%' },
              { value: '9,847', label: 'Loans', change: 'YTD' },
              { value: '72.8%', label: 'Pull-Through', change: '+4.2%' },
              { value: '25d', label: 'Cycle Time', change: '-6 days' },
            ].map((stat, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
                className="text-center"
              >
                <div className="text-4xl sm:text-5xl font-extralight text-slate-900 dark:text-white tracking-tight mb-1">
                  {stat.value}
                </div>
                <div className="text-sm text-slate-700 dark:text-slate-300 font-light mb-1">
                  {stat.label}
                </div>
                <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  {stat.change}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="px-6 py-32 sm:py-40 bg-gradient-to-b from-slate-50 to-white dark:from-slate-900/50 dark:to-slate-950">
        <div className="mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1 }}
            className="text-center mb-16"
          >
            <p className="text-xs font-medium tracking-[0.2em] text-slate-600 dark:text-slate-400 uppercase mb-4">
              Pricing
            </p>
            <h2 className="text-3xl sm:text-4xl font-extralight text-slate-900 dark:text-white tracking-tight mb-4">
              Choose your deployment model
            </h2>
            <p className="text-base text-slate-700 dark:text-slate-300 font-light max-w-2xl mx-auto mb-8">
              Coheus respects your data privacy. We do not host your data. Choose the deployment model that gives you complete control over your infrastructure and data.
            </p>

            {/* Billing Period Toggle */}
            <div className="flex items-center justify-center gap-4 mb-8">
              <div className="inline-flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-full p-1">
                <button
                  type="button"
                  onClick={() => setBillingPeriod('monthly')}
                  className={`px-4 py-2 rounded-full text-sm font-light transition-all ${
                    billingPeriod === 'monthly'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setBillingPeriod('yearly')}
                  className={`px-4 py-2 rounded-full text-sm font-light transition-all relative ${
                    billingPeriod === 'yearly'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Annual
                  {plans.length > 0 && (() => {
                    const maxSavings = Math.max(...plans.map(p => {
                      if (p.price_yearly >= p.price_monthly * 12) return 0;
                      return Math.round((1 - p.price_yearly / (p.price_monthly * 12)) * 100);
                    }));
                    return maxSavings > 0 ? (
                      <span className="ml-1.5 text-xs bg-emerald-500 text-white px-1.5 py-0.5 rounded-full">
                        Save up to {maxSavings}%
                      </span>
                    ) : null;
                  })()}
                </button>
              </div>
            </div>

            {/* Deployment Type Selector */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mb-12">
              <RadioGroup
                value={selectedDeploymentType}
                onValueChange={(value) => setSelectedDeploymentType(value as 'on_premise' | 'per_lender_aws' | 'hybrid')}
                className="flex flex-col sm:flex-row gap-4 sm:gap-6"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="on_premise" id="on_premise" />
                  <Label htmlFor="on_premise" className="flex items-center gap-2 cursor-pointer font-light">
                    <Server className="h-4 w-4" />
                    On-Premise
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="per_lender_aws" id="per_lender_aws" />
                  <Label htmlFor="per_lender_aws" className="flex items-center gap-2 cursor-pointer font-light">
                    <Cloud className="h-4 w-4" />
                    Amazon AWS Private
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="hybrid" id="hybrid" />
                  <Label htmlFor="hybrid" className="flex items-center gap-2 cursor-pointer font-light">
                    <Network className="h-4 w-4" />
                    Hybrid
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </motion.div>

          {/* Pricing Cards */}
          {loadingPlans ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : plans.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-slate-600 dark:text-slate-400 mb-4">Unable to load pricing plans</p>
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
                className="mt-4"
              >
                Retry
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
              {plans.map((plan, idx) => {
                const isPopular = plan.name === 'professional';
                // Check if the selected deployment type is available for this plan
                // The plan.deployment_options is an array from the backend (e.g., ['on_premise', 'hybrid'])
                const deploymentAvailable = plan.deployment_options && Array.isArray(plan.deployment_options) && 
                  plan.deployment_options.includes(selectedDeploymentType);
                
                return (
                  <motion.div
                    key={plan.id}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: idx * 0.1 }}
                  >
                    <Card className={`relative h-full border-2 transition-all duration-300 ${
                      isPopular 
                        ? 'border-blue-500 shadow-xl scale-105' 
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                    } ${!deploymentAvailable ? 'opacity-50' : ''}`}>
                      {isPopular && (
                        <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                          <Badge className="bg-blue-600 text-white px-4 py-1 text-xs font-medium">
                            Most Popular
                          </Badge>
                        </div>
                      )}
                      <CardHeader className="pb-4">
                        <CardTitle className="text-2xl font-light text-slate-900 dark:text-white tracking-tight">
                          {plan.display_name}
                        </CardTitle>
                        <div className="mt-4">
                          {billingPeriod === 'monthly' ? (
                            <>
                              <div className="flex items-baseline gap-2">
                                <span className="text-4xl font-extralight text-slate-900 dark:text-white">${plan.price_monthly}</span>
                                <span className="text-sm text-slate-600 dark:text-slate-400 font-light">/month</span>
                              </div>
                              <p className="text-xs text-slate-500 dark:text-slate-500 mt-1 font-light">
                                ${plan.price_yearly.toLocaleString()}/year billed annually
                                {plan.price_yearly < plan.price_monthly * 12 && (
                                  <span className="text-emerald-600 dark:text-emerald-400 ml-1">
                                    (save {Math.round((1 - plan.price_yearly / (plan.price_monthly * 12)) * 100)}%)
                                  </span>
                                )}
                              </p>
                            </>
                          ) : (
                            <>
                              <div className="flex items-baseline gap-2">
                                <span className="text-4xl font-extralight text-slate-900 dark:text-white">
                                  ${Math.round(plan.price_yearly / 12)}
                                </span>
                                <span className="text-sm text-slate-600 dark:text-slate-400 font-light">/month</span>
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <p className="text-xs text-slate-500 dark:text-slate-500 font-light">
                                  Billed ${plan.price_yearly.toLocaleString()}/year
                                </p>
                                {plan.price_yearly < plan.price_monthly * 12 && (
                                  <Badge variant="outline" className="text-xs bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">
                                    Save {Math.round((1 - plan.price_yearly / (plan.price_monthly * 12)) * 100)}%
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 line-through font-light">
                                ${plan.price_monthly * 12}/year if paid monthly
                              </p>
                            </>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <div className="space-y-3">
                          {plan.features.max_users && (
                            <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                              <Check className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                              <span className="font-light">
                                {plan.features.max_users === -1 ? 'Unlimited' : plan.features.max_users} users
                              </span>
                            </div>
                          )}
                          {plan.features.los_adapters && (
                            <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                              <Check className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                              <span className="font-light">
                                {plan.features.los_adapters === -1 ? 'Unlimited' : plan.features.los_adapters} LOS adapters
                              </span>
                            </div>
                          )}
                          {plan.features.storage_gb && (
                            <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                              <Check className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                              <span className="font-light">
                                {plan.features.storage_gb === -1 ? 'Unlimited' : `${plan.features.storage_gb} GB`} storage
                              </span>
                            </div>
                          )}
                          {plan.features.api_calls_per_month && (
                            <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                              <Check className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                              <span className="font-light">
                                {plan.features.api_calls_per_month === -1 ? 'Unlimited' : `${plan.features.api_calls_per_month.toLocaleString()}`} API calls/month
                              </span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                            <Check className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                            <span className="font-light">SOC 2 Type II compliance</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                            <Check className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                            <span className="font-light">24/7 support</span>
                          </div>
                        </div>
                        <Button
                          size="lg"
                          onClick={() => handleGetStarted(plan.id)}
                          disabled={!deploymentAvailable || loadingCheckout === plan.id}
                          className={`w-full ${
                            isPopular
                              ? 'bg-blue-600 hover:bg-blue-700 text-white'
                              : 'bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-100 text-white dark:text-slate-900'
                          }`}
                        >
                          {loadingCheckout === plan.id ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Processing...
                            </>
                          ) : !deploymentAvailable ? (
                            'Not Available'
                          ) : (
                            <>
                              Get Started
                              <ArrowRight className="ml-2 h-4 w-4" />
                            </>
                          )}
                        </Button>
                        {!deploymentAvailable && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 text-center font-light">
                            {selectedDeploymentType === 'per_lender_aws' 
                              ? 'Available for Enterprise plan only'
                              : selectedDeploymentType === 'hybrid'
                              ? 'Available for Professional and Enterprise plans'
                              : selectedDeploymentType === 'on_premise'
                              ? 'Available for all plans'
                              : 'Not available for this plan'}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Automated SaaS Flow */}
      <section className="px-6 py-32 sm:py-40 bg-gradient-to-b from-white via-slate-50 to-white dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1 }}
            className="text-center mb-16"
          >
            <p className="text-xs font-medium tracking-[0.2em] text-slate-600 dark:text-slate-400 uppercase mb-4">
              Automated Provisioning
            </p>
            <h2 className="text-3xl sm:text-4xl font-extralight text-slate-900 dark:text-white tracking-tight mb-4">
              From payment to live infrastructure in 15-25 minutes
            </h2>
            <p className="text-base text-slate-700 dark:text-slate-300 font-light max-w-2xl mx-auto">
              Fully automated SaaS flow with Stripe checkout and AWS provisioning. Zero manual intervention required.
            </p>
          </motion.div>

          {/* Flow Diagram */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="bg-white dark:bg-slate-800/50 backdrop-blur-sm border border-slate-200/60 dark:border-slate-700/50 rounded-2xl p-6 sm:p-8 lg:p-12 shadow-xl"
          >
            <div className="space-y-6">
              {/* Step 1: Landing Page */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg">
                  <svg className="w-8 h-8 sm:w-10 sm:h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                </div>
                <div className="flex-1 bg-indigo-50/50 dark:bg-indigo-900/10 rounded-xl p-4 sm:p-6 border-l-4 border-indigo-500">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">Step 1</span>
                    <span className="text-sm font-medium text-slate-900 dark:text-white">Landing Page & Pricing</span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 font-light">
                    Lender views pricing plans, selects deployment type (Shared SaaS or Per-Lender AWS), clicks "Get Started"
                  </p>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex justify-center">
                <ChevronDown className="w-6 h-6 text-slate-400" />
              </div>

              {/* Step 2: Stripe Checkout */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg">
                  <svg className="w-8 h-8 sm:w-10 sm:h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 sm:p-6 border-l-4 border-slate-600">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Step 2</span>
                    <span className="text-sm font-medium text-slate-900 dark:text-white">Stripe Checkout</span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 font-light">
                    Secure payment processing. Metadata includes: lender name, email, plan ID, deployment type
                  </p>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex justify-center">
                <ChevronDown className="w-6 h-6 text-slate-400" />
              </div>

              {/* Step 3: Webhook */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg">
                  <svg className="w-8 h-8 sm:w-10 sm:h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1 bg-emerald-50/50 dark:bg-emerald-900/10 rounded-xl p-4 sm:p-6 border-l-4 border-emerald-500">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">Step 3</span>
                    <span className="text-sm font-medium text-slate-900 dark:text-white">Webhook Handler</span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 font-light">
                    Backend receives <code className="bg-emerald-100 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded text-xs">checkout.session.completed</code>. Creates tenant, subscription record, triggers AWS provisioning
                  </p>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex justify-center">
                <ChevronDown className="w-6 h-6 text-slate-400" />
              </div>

              {/* Step 4: AWS Provisioning */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg">
                    <svg className="w-8 h-8 sm:w-10 sm:h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Step 4</span>
                      <span className="text-sm font-medium text-slate-900 dark:text-white">AWS Provisioning (15-25 min)</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="bg-blue-50/50 dark:bg-blue-900/10 rounded-lg p-3 border-l-2 border-blue-500">
                        <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">4a. AWS Account</div>
                        <div className="text-xs text-slate-600 dark:text-slate-400 font-light">AWS Organizations creates dedicated account (3-5 min)</div>
                      </div>
                      <div className="bg-purple-50/50 dark:bg-purple-900/10 rounded-lg p-3 border-l-2 border-purple-500">
                        <div className="text-xs font-semibold text-purple-600 dark:text-purple-400 mb-1">4b. StackSet</div>
                        <div className="text-xs text-slate-600 dark:text-slate-400 font-light">CloudFormation deploys infrastructure (10-15 min)</div>
                      </div>
                      <div className="bg-pink-50/50 dark:bg-pink-900/10 rounded-lg p-3 border-l-2 border-pink-500">
                        <div className="text-xs font-semibold text-pink-600 dark:text-pink-400 mb-1">4c. Admin Setup</div>
                        <div className="text-xs text-slate-600 dark:text-slate-400 font-light">Creates admin user, generates credentials (2 min)</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex justify-center">
                <ChevronDown className="w-6 h-6 text-slate-400" />
              </div>

              {/* Step 5: Success */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg">
                  <svg className="w-8 h-8 sm:w-10 sm:h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1 bg-amber-50/50 dark:bg-amber-900/10 rounded-xl p-4 sm:p-6 border-l-4 border-amber-500">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">Step 5</span>
                    <span className="text-sm font-medium text-slate-900 dark:text-white">Success Page & Email</span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 font-light">
                    Lender redirected to success page with real-time progress. Admin credentials sent via email. Ready to access admin panel.
                  </p>
                </div>
              </div>
            </div>

            {/* Key Features */}
            <div className="mt-12 pt-8 border-t border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-light text-slate-900 dark:text-white mb-6 text-center">Key Features</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-emerald-50/50 dark:bg-emerald-900/10 rounded-lg p-4 border border-emerald-200/50 dark:border-emerald-800/50">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Fully Automated</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 font-light">Zero manual intervention from payment to live infrastructure</p>
                </div>
                <div className="bg-blue-50/50 dark:bg-blue-900/10 rounded-lg p-4 border border-blue-200/50 dark:border-blue-800/50">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-medium text-blue-700 dark:text-blue-300">Real-time Progress</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 font-light">Success page shows live provisioning status with progress bar</p>
                </div>
                <div className="bg-purple-50/50 dark:bg-purple-900/10 rounded-lg p-4 border border-purple-200/50 dark:border-purple-800/50">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    <span className="text-sm font-medium text-purple-700 dark:text-purple-300">Error Handling</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 font-light">Retry logic, timeout protection, email notifications on failure</p>
                </div>
                <div className="bg-pink-50/50 dark:bg-pink-900/10 rounded-lg p-4 border border-pink-200/50 dark:border-pink-800/50">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-5 h-5 text-pink-600 dark:text-pink-400" />
                    <span className="text-sm font-medium text-pink-700 dark:text-pink-300">Direct AWS Billing</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 font-light">Lender pays AWS directly—complete cost transparency</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-32 sm:py-40">
        <div className="mx-auto max-w-2xl text-center">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1 }}
          >
            <h2 className="text-4xl sm:text-5xl font-extralight text-slate-900 dark:text-white tracking-tight mb-6">
              See your business clearly.
            </h2>
            <p className="text-base sm:text-lg text-slate-700 dark:text-slate-300 font-light mb-10 max-w-md mx-auto">
              AI-powered intelligence for lending executives who value clarity over complexity.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button
                size="lg"
                onClick={() => navigate('/admin')}
                className="group bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-100 text-white dark:text-slate-900 px-8 py-6 text-sm font-medium rounded-full shadow-lg hover:shadow-xl transition-all"
              >
                Get Started
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
              <Button
                variant="ghost"
                size="lg"
                onClick={() => navigate('/admin')}
                className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white px-8 py-6 text-sm font-medium rounded-full"
              >
                <Play className="mr-2 h-4 w-4" />
                Watch Demo
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      <Footer />

      {/* Lender Info Modal */}
      <Dialog open={showLenderModal} onOpenChange={(open) => {
        if (!open && !loadingCheckout) {
          setShowLenderModal(false);
          setLenderInfo({ name: '', email: '' });
          setSelectedPlanForModal(null);
        }
      }}>
        <DialogContent className="sm:max-w-[425px] p-0">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="font-light text-2xl">Get Started with Coheus</DialogTitle>
            <DialogDescription className="font-light mt-2">
              Enter your details to proceed to secure checkout with Stripe.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-6 pb-4">
            <div className="grid gap-2">
              <Label htmlFor="name" className="font-light">Company or Full Name *</Label>
              <Input
                id="name"
                placeholder="Acme Lending"
                value={lenderInfo.name}
                onChange={(e) => setLenderInfo({ ...lenderInfo, name: e.target.value })}
                className="font-light"
                disabled={loadingCheckout !== null}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && lenderInfo.name?.trim() && lenderInfo.email?.trim() && !loadingCheckout) {
                    if (selectedPlanForModal) {
                      initiateCheckout(selectedPlanForModal, lenderInfo);
                    }
                  }
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email" className="font-light">Email address *</Label>
              <Input
                id="email"
                type="email"
                placeholder="alex@example.com"
                value={lenderInfo.email}
                onChange={(e) => setLenderInfo({ ...lenderInfo, email: e.target.value })}
                className="font-light"
                disabled={loadingCheckout !== null}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && lenderInfo.name?.trim() && lenderInfo.email?.trim() && !loadingCheckout) {
                    if (selectedPlanForModal) {
                      initiateCheckout(selectedPlanForModal, lenderInfo);
                    }
                  }
                }}
              />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
              * Required fields. Your information will be used to create your account and process payment securely.
            </p>
          </div>
          <DialogFooter className="px-6 pb-6 pt-4">
            <div className="flex flex-col gap-2 w-full">
              <Button 
                disabled={!lenderInfo.name?.trim() || !lenderInfo.email?.trim() || loadingCheckout !== null}
                onClick={() => {
                  if (selectedPlanForModal) {
                    initiateCheckout(selectedPlanForModal, lenderInfo);
                  }
                }}
                className="w-full bg-slate-900 text-white hover:bg-slate-800"
              >
                {loadingCheckout ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    Continue to Payment
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowLenderModal(false);
                  setLenderInfo({ name: '', email: '' });
                  setSelectedPlanForModal(null);
                  setLoadingCheckout(null);
                }}
                className="w-full text-slate-600 hover:text-slate-900"
                disabled={loadingCheckout !== null}
              >
                Cancel
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
