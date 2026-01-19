import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2, AlertCircle, Copy, ExternalLink, Mail, Server, Cloud, Settings } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';
import { Navigation } from '@/components/layout/Navigation';
import { Footer } from '@/components/layout/Footer';

interface ProvisioningStatus {
  status: string;
  provisioningStatus: string | null;
  progress: number;
  estimatedTimeRemaining: number | null;
  errorMessage: string | null;
  infrastructureUrl: string | null;
  adminUrl: string | null;
  deploymentType: string;
  adminCredentials?: {
    username: string;
    password: string;
  };
}

export const SubscriptionSuccess = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const { toast } = useToast();
  const [status, setStatus] = useState<ProvisioningStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedPassword, setCopiedPassword] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      toast({
        title: 'Invalid Session',
        description: 'No checkout session ID provided',
        variant: 'destructive',
      });
      navigate('/');
      return;
    }

    const fetchStatus = async (): Promise<ProvisioningStatus | null> => {
      try {
        const response = await api.request<ProvisioningStatus>(`/api/subscriptions/provisioning-status/${sessionId}`);
        setStatus(response);
        setLoading(false);
        return response;
      } catch (error: any) {
        console.error('Error fetching provisioning status:', error);
        toast({
          title: 'Error',
          description: 'Failed to load provisioning status',
          variant: 'destructive',
        });
        setLoading(false);
        return null;
      }
    };

    fetchStatus();

    // Poll for status updates if provisioning is in progress
    const interval = setInterval(async () => {
      const newStatus = await fetchStatus();
      // Stop polling if provisioning is complete or failed
      if (newStatus?.status === 'active' && newStatus.provisioningStatus === 'completed') {
        clearInterval(interval);
      } else if (newStatus?.status === 'failed') {
        clearInterval(interval);
      }
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(interval);
  }, [sessionId, navigate, toast]);

  const copyPassword = () => {
    if (status?.adminCredentials?.password) {
      navigator.clipboard.writeText(status.adminCredentials.password);
      setCopiedPassword(true);
      toast({
        title: 'Copied',
        description: 'Password copied to clipboard',
      });
      setTimeout(() => setCopiedPassword(false), 2000);
    }
  };

  const formatTimeRemaining = (seconds: number | null): string => {
    if (!seconds || seconds <= 0) return 'Almost done!';
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 1) return 'Less than a minute';
    return `~${minutes} minute${minutes !== 1 ? 's' : ''}`;
  };

  const getStatusIcon = () => {
    if (status?.status === 'active' && status.provisioningStatus === 'completed') {
      return <CheckCircle2 className="h-8 w-8 text-emerald-600" />;
    }
    if (status?.status === 'failed') {
      return <AlertCircle className="h-8 w-8 text-red-600" />;
    }
    return <Loader2 className="h-8 w-8 animate-spin text-blue-600" />;
  };

  const getStatusColor = () => {
    if (status?.status === 'active' && status.provisioningStatus === 'completed') {
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
    }
    if (status?.status === 'failed') {
      return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
    }
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50/30 via-white to-blue-50/20 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/50">
      <Navigation />
      
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12 max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-6"
        >
          {/* Success Header */}
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
              className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/40 mb-4"
            >
              <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
            </motion.div>
            <h1 className="text-3xl sm:text-4xl font-extralight text-slate-900 dark:text-white tracking-tight mb-2">
              Payment Successful!
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-400 font-light">
              Your subscription is active. {status?.deploymentType === 'per_lender_aws' && 'We\'re setting up your dedicated infrastructure.'}
            </p>
          </div>

          {loading ? (
            <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-lg">
              <CardContent className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              </CardContent>
            </Card>
          ) : status ? (
            <>
              {/* Provisioning Status (for per-lender AWS) */}
              {status.deploymentType === 'per_lender_aws' && (
                <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-lg">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {getStatusIcon()}
                        <div>
                          <CardTitle className="text-lg font-light text-slate-900 dark:text-white tracking-tight">
                            Infrastructure Provisioning
                          </CardTitle>
                          <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                            {status.status === 'active' && status.provisioningStatus === 'completed'
                              ? 'Your dedicated AWS infrastructure is ready'
                              : status.status === 'failed'
                              ? 'Provisioning encountered an error'
                              : 'Setting up your dedicated AWS account and infrastructure'}
                          </CardDescription>
                        </div>
                      </div>
                      <Badge className={getStatusColor()}>
                        {status.status === 'active' && status.provisioningStatus === 'completed'
                          ? 'Complete'
                          : status.status === 'failed'
                          ? 'Failed'
                          : 'In Progress'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Progress Bar */}
                    {status.status !== 'failed' && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-600 dark:text-slate-400 font-light">
                            Progress
                          </span>
                          <span className="text-slate-900 dark:text-white font-light">
                            {status.progress}%
                          </span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${status.progress}%` }}
                            transition={{ duration: 0.5 }}
                            className="h-full bg-gradient-to-r from-blue-500 to-emerald-500"
                          />
                        </div>
                        {status.estimatedTimeRemaining !== null && status.estimatedTimeRemaining > 0 && (
                          <p className="text-xs text-slate-500 dark:text-slate-500 font-light">
                            Estimated time remaining: {formatTimeRemaining(status.estimatedTimeRemaining)}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Provisioning Steps */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                          (status.provisioningStatus === 'account_creation' || 
                           status.provisioningStatus === 'stack_deployment' ||
                           status.provisioningStatus === 'admin_setup' ||
                           status.provisioningStatus === 'completed')
                            ? 'bg-emerald-100 dark:bg-emerald-900/40'
                            : 'bg-slate-200 dark:bg-slate-700'
                        }`}>
                          {(status.provisioningStatus === 'stack_deployment' ||
                            status.provisioningStatus === 'admin_setup' ||
                            status.provisioningStatus === 'completed') ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          ) : status.provisioningStatus === 'account_creation' ? (
                            <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
                          ) : (
                            <div className="w-2 h-2 rounded-full bg-slate-400" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-light text-slate-900 dark:text-white">
                            AWS Account Creation
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                            Creating dedicated AWS account via Organizations
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                          (status.provisioningStatus === 'stack_deployment' ||
                           status.provisioningStatus === 'admin_setup' ||
                           status.provisioningStatus === 'completed')
                            ? 'bg-emerald-100 dark:bg-emerald-900/40'
                            : 'bg-slate-200 dark:bg-slate-700'
                        }`}>
                          {(status.provisioningStatus === 'admin_setup' ||
                            status.provisioningStatus === 'completed') ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          ) : status.provisioningStatus === 'stack_deployment' ? (
                            <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
                          ) : (
                            <div className="w-2 h-2 rounded-full bg-slate-400" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-light text-slate-900 dark:text-white">
                            Infrastructure Deployment
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                            Deploying S3, CloudFront, Elastic Beanstalk, RDS
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                          status.provisioningStatus === 'completed'
                            ? 'bg-emerald-100 dark:bg-emerald-900/40'
                            : 'bg-slate-200 dark:bg-slate-700'
                        }`}>
                          {status.provisioningStatus === 'completed' ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          ) : status.provisioningStatus === 'admin_setup' ? (
                            <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
                          ) : (
                            <div className="w-2 h-2 rounded-full bg-slate-400" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-light text-slate-900 dark:text-white">
                            Admin Setup
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                            Creating admin user and credentials
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Error Message */}
                    {status.status === 'failed' && status.errorMessage && (
                      <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <p className="text-sm text-red-700 dark:text-red-300 font-light">
                          {status.errorMessage}
                        </p>
                        <p className="text-xs text-red-600 dark:text-red-400 mt-2 font-light">
                          Our team has been notified and will contact you shortly.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Admin Credentials (when ready) */}
              {status.status === 'active' && status.provisioningStatus === 'completed' && status.adminCredentials && (
                <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-lg">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                        <Settings className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <CardTitle className="text-lg font-light text-slate-900 dark:text-white tracking-tight">
                          Admin Access
                        </CardTitle>
                        <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                          Your admin credentials have been sent to your email
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {status.adminUrl && (
                      <div>
                        <Label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 block">
                          Admin URL
                        </Label>
                        <div className="flex items-center gap-2">
                          <Input
                            value={status.adminUrl}
                            readOnly
                            className="font-mono text-sm"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => window.open(status.adminUrl!, '_blank')}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}

                    <div>
                      <Label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 block">
                        Username
                      </Label>
                      <Input
                        value={status.adminCredentials.username}
                        readOnly
                        className="font-mono text-sm"
                      />
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 block">
                        Temporary Password
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="password"
                          value={status.adminCredentials.password}
                          readOnly
                          className="font-mono text-sm"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={copyPassword}
                        >
                          {copiedPassword ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-light">
                        Please change this password after first login
                      </p>
                    </div>

                    <div className="flex gap-3 pt-2">
                      {status.adminUrl && (
                        <Button
                          onClick={() => window.open(status.adminUrl!, '_blank')}
                          className="flex-1"
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Access Admin Panel
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Shared SaaS Success (no provisioning needed) */}
              {status.deploymentType === 'cloud' && (
                <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-lg">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                        <Cloud className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div>
                        <CardTitle className="text-lg font-light text-slate-900 dark:text-white tracking-tight">
                          Ready to Use
                        </CardTitle>
                        <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                          Your subscription is active. You can start using the platform immediately.
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Button
                      onClick={() => navigate('/admin')}
                      className="w-full"
                    >
                      Go to Admin Panel
                      <ExternalLink className="ml-2 h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Next Steps */}
              <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-lg">
                <CardHeader>
                  <CardTitle className="text-lg font-light text-slate-900 dark:text-white tracking-tight">
                    What's Next?
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 mt-0.5">
                      <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-light text-slate-900 dark:text-white">
                        Check your email
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                        We've sent you a welcome email with setup instructions and credentials
                      </p>
                    </div>
                  </div>
                  {status.deploymentType === 'per_lender_aws' && status.status !== 'active' && (
                    <div className="flex items-start gap-3">
                      <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 mt-0.5">
                        <Server className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      </div>
                      <div>
                        <p className="text-sm font-light text-slate-900 dark:text-white">
                          Infrastructure provisioning
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                          Your dedicated AWS infrastructure is being set up. This typically takes 15-25 minutes.
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <div className="p-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 mt-0.5">
                      <Settings className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <p className="text-sm font-light text-slate-900 dark:text-white">
                        Configure your LOS connection
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                        Once your admin panel is ready, connect your Loan Origination System
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-lg">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <AlertCircle className="h-12 w-12 text-slate-400 mb-4" />
                <p className="text-sm text-slate-600 dark:text-slate-400 font-light">
                  Unable to load subscription status
                </p>
              </CardContent>
            </Card>
          )}
        </motion.div>
      </div>

      <Footer />
    </div>
  );
};
