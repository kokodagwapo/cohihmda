import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { api, getApiUrl } from '@/lib/api';
import { Loader2, LogIn, Shield, CheckCircle2, XCircle } from 'lucide-react';
import { CoheusLogo } from '@/components/ui/CoheusLogo';

export const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline' | 'not-configured'>('checking');

  // Check if backend is configured
  const apiUrl = getApiUrl();
  // Empty string is valid for CloudFront (uses same origin proxy via /api/*)
  // For CloudFront, empty string means "use same origin" which is correct
  const isBackendConfigured = apiUrl !== null && apiUrl !== undefined;
  
  // Helper to get the full health check URL
  const getHealthUrl = () => {
    if (!apiUrl || apiUrl === '') {
      // CloudFront: use same origin with /api/health
      return '/api/health';
    }
    return `${apiUrl}/health`;
  };

  // Check server status on mount and periodically
  useEffect(() => {
    const checkServer = async () => {
      // If no API URL is configured, show not-configured state
      if (!isBackendConfigured) {
        setServerStatus('not-configured');
        return;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000); // Reduced timeout for faster feedback
        
        const healthUrl = getHealthUrl();
        const response = await fetch(healthUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: controller.signal,
          cache: 'no-cache', // Always check fresh
        });
        
        clearTimeout(timeout);
        
        // Any response (200 or 503) means server is running
        if (response.ok || response.status === 503) {
          setServerStatus('online');
        } else {
          setServerStatus('offline');
        }
      } catch (error: any) {
        // Only set offline if it's a real connection error
        if (error.name === 'AbortError' || error.name === 'TypeError') {
          setServerStatus('offline');
        }
      }
    };
    
    // Check immediately
    checkServer();
    // Re-check every 15 seconds (more frequent for better UX)
    const interval = setInterval(checkServer, 15000);
    return () => clearInterval(interval);
  }, [apiUrl, isBackendConfigured]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Basic validation
    if (!email || !password) {
      toast({
        title: 'Validation Error',
        description: 'Please enter both email and password',
        variant: 'destructive',
      });
      return;
    }
    
    // Check if backend is configured before trying to login
    // Note: Empty string is valid for CloudFront (uses same origin /api/* proxy)
    if (!isBackendConfigured) {
      toast({
        title: 'Backend Not Configured',
        description: 'Backend is deployed on AWS Elastic Beanstalk and proxied through CloudFront. If you see this error, the backend may be starting up. Please wait a moment and try again.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    // Pre-flight health check - non-blocking, just for user feedback
    // We don't block login if this fails, as the actual API call will handle errors
    const healthCheckPromise = (async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        
        const healthUrl = getHealthUrl();
        const response = await fetch(healthUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: controller.signal,
        });
        
        clearTimeout(timeout);
        
        // Any response (even 503) means server is running
        if (response.ok || response.status === 503) {
          console.log('Server health check: OK');
        }
      } catch (error: any) {
        // Silently fail - don't block login
        console.warn('Health check: Server may be unavailable, but proceeding with login');
      }
    })();
    
    // Don't await - let it run in background
    healthCheckPromise.catch(() => {});

    try {
      // Update server status before attempting login
      setServerStatus('checking');
      
      const data = await api.signIn(email.trim(), password);
      
      // Login successful - update status
      setServerStatus('online');
      
      toast({
        title: 'Welcome back!',
        description: `Signed in as ${data.user.email}`,
      });

      // Redirect to admin or previous page
      const returnTo = new URLSearchParams(window.location.search).get('returnTo') || '/admin';
      navigate(returnTo);
    } catch (error: any) {
      // Update server status based on error type
      const errorMsg = error.message?.toLowerCase() || '';
      if (errorMsg.includes('connection') || 
          errorMsg.includes('server') ||
          errorMsg.includes('failed to fetch') ||
          errorMsg.includes('networkerror') ||
          errorMsg.includes('econnrefused') ||
          errorMsg.includes('unable to connect')) {
        setServerStatus('offline');
      } else if (errorMsg.includes('503') || errorMsg.includes('service temporarily unavailable')) {
        // Server is running but degraded
        setServerStatus('online');
      }
      // Provide user-friendly error messages
      let errorMessage = 'Sign in failed';
      let errorDescription = error.message || 'Invalid email or password';
      
      // Check for specific error types with improved detection (reuse errorMsg from above)
      if (errorMsg.includes('cors') || errorMsg.includes('not allowed by cors')) {
        errorMessage = 'Connection Error';
        errorDescription = 'Unable to connect to the backend server. Please try again or contact support if the issue persists.';
      } else if (errorMsg.includes('connection') || 
          errorMsg.includes('server') ||
          errorMsg.includes('failed to fetch') ||
          errorMsg.includes('networkerror') ||
          errorMsg.includes('econnrefused') ||
          errorMsg.includes('unable to connect')) {
        errorMessage = 'Connection Error';
        errorDescription = 'Unable to connect to server. Please check your network connection and ensure the backend is accessible.';
      } else if (errorMsg.includes('invalid') || 
                 errorMsg.includes('credentials') ||
                 errorMsg.includes('401') ||
                 errorMsg.includes('unauthorized')) {
        errorMessage = 'Invalid Credentials';
        errorDescription = 'The email or password you entered is incorrect. Please try again.';
      } else if (errorMsg.includes('timeout') ||
                 errorMsg.includes('503') ||
                 errorMsg.includes('service unavailable')) {
        errorMessage = 'Service Unavailable';
        errorDescription = 'The server is temporarily unavailable. This may be due to database connection issues. Please try again in a moment.';
      } else if (errorMsg.includes('database connection') ||
                 errorMsg.includes('database error')) {
        errorMessage = 'Database Error';
        errorDescription = 'Unable to connect to database. Please check server logs and database configuration.';
      } else if (errorMsg.includes('500') || errorMsg.includes('internal server error')) {
        errorMessage = 'Server Error';
        errorDescription = 'An internal server error occurred. Please try again in a moment.';
      }
      
      console.error('Sign-in error:', error);
      
      toast({
        title: errorMessage,
        description: errorDescription,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
      <Card className="w-full max-w-md shadow-xl border-0">
        <CardHeader className="space-y-4 text-center pb-6">
          <div className="flex justify-center mb-4">
            <CoheusLogo className="h-12 w-auto" />
          </div>
          <CardTitle className="text-2xl font-light">Welcome Back</CardTitle>
          <CardDescription className="text-base">
            Sign in to access Ailethia Admin Settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignIn} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleSignIn(e);
                  }
                }}
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <LogIn className="mr-2 h-4 w-4" />
                  Sign In
                </>
              )}
            </Button>
          </form>
          
          <div className="mt-6 pt-6 border-t border-border">
            <div className="text-xs text-muted-foreground text-center space-y-2">
              <p className="flex items-center justify-center gap-2">
                <Shield className="h-3 w-3" />
                Secure authentication via backend API
              </p>
              <div className="flex items-center justify-center gap-2">
                {serverStatus === 'checking' && (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Checking server connection...</span>
                  </>
                )}
                {serverStatus === 'online' && (
                  <>
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                    <span className="text-emerald-600 dark:text-emerald-400">Server connected</span>
                  </>
                )}
                {serverStatus === 'offline' && (
                  <>
                    <XCircle className="h-3 w-3 text-rose-500" />
                    <span className="text-rose-600 dark:text-rose-400">Server unavailable - please check your connection</span>
                  </>
                )}
                {serverStatus === 'not-configured' && (
                  <>
                    <XCircle className="h-3 w-3 text-amber-500" />
                    <span className="text-amber-600 dark:text-amber-400">Backend not configured</span>
                  </>
                )}
              </div>
              {serverStatus === 'not-configured' && (
                <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 text-left">
                  <p className="text-blue-800 dark:text-blue-200 font-medium mb-2">ℹ️ Backend Configuration</p>
                  <p className="text-blue-700 dark:text-blue-300 mb-2">
                    Backend is deployed on AWS Elastic Beanstalk and proxied through CloudFront.
                  </p>
                  <div className="text-blue-700 dark:text-blue-300 space-y-1">
                    <p>• <strong>Frontend:</strong> CloudFront (HTTPS)</p>
                    <p>• <strong>API:</strong> CloudFront → Elastic Beanstalk (HTTP)</p>
                    <p>• <strong>Database:</strong> AWS RDS PostgreSQL</p>
                  </div>
                  <p className="text-blue-600 dark:text-blue-400 mt-3 text-xs">
                    If you're seeing this message, CloudFront may still be deploying. Please wait 5-15 minutes.
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;

