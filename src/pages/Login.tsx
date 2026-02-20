import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, LogIn, CheckCircle2, XCircle, KeyRound, ArrowLeft, ArrowRight } from 'lucide-react';
import { CoheusLogo } from '@/components/ui/CoheusLogo';

type LoginStep = 'email' | 'password' | 'sso-redirect';

export const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { login, loadTenants, isAuthenticated, user } = useAuth();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline' | 'not-configured'>('checking');
  
  // Two-step login flow
  const [step, setStep] = useState<LoginStep>('email');
  const [ssoConfigured, setSsoConfigured] = useState(false);
  const [ssoInfo, setSsoInfo] = useState<{
    available: boolean;
    tenantSlug?: string;
    tenantName?: string;
    idpName?: string;
    allowPassword: boolean;
  }>({ available: false, allowPassword: true });

  const passwordRef = useRef<HTMLInputElement>(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      const returnTo = new URLSearchParams(window.location.search).get('returnTo') || '/insights';
      navigate(returnTo);
    }
  }, [isAuthenticated, user, navigate]);

  // Check if backend is configured
  const apiUrl = getApiUrl();
  const isBackendConfigured = apiUrl !== null && apiUrl !== undefined;
  
  const getHealthUrl = () => {
    if (!apiUrl || apiUrl === '') return '/api/health';
    return `${apiUrl}/health`;
  };

  // Check server status, load tenants, and check SSO config on mount
  useEffect(() => {
    const checkServer = async () => {
      if (!isBackendConfigured) {
        setServerStatus('not-configured');
        return;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        
        const response = await fetch(getHealthUrl(), {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: controller.signal,
          cache: 'no-cache',
        });
        
        clearTimeout(timeout);
        
        if (response.ok || response.status === 503) {
          setServerStatus('online');
          loadTenants();
          checkSsoConfig();
        } else {
          setServerStatus('offline');
        }
      } catch (error: any) {
        if (error.name === 'AbortError' || error.name === 'TypeError') {
          setServerStatus('offline');
        }
      }
    };
    
    checkServer();
    const interval = setInterval(checkServer, 15000);
    return () => clearInterval(interval);
  }, [apiUrl, isBackendConfigured, loadTenants]);

  // Check if Cognito SSO is configured
  const checkSsoConfig = async () => {
    try {
      const response = await fetch(`${apiUrl}/api/auth/cognito/config`);
      if (response.ok) {
        const data = await response.json();
        setSsoConfigured(data.isConfigured === true);
      }
    } catch (err) {
      console.debug('[Login] SSO config check failed:', err);
    }
  };

  // Lookup SSO availability by email domain
  const lookupSso = useCallback(async (emailValue: string): Promise<typeof ssoInfo> => {
    const noSso = { available: false, allowPassword: true };

    if (!emailValue.includes('@') || !ssoConfigured) {
      return noSso;
    }

    try {
      const response = await fetch(`${apiUrl}/api/auth/cognito/lookup-tenant?email=${encodeURIComponent(emailValue)}`);
      if (response.ok) {
        const data = await response.json();
        return {
          available: data.sso_available === true,
          tenantSlug: data.tenant_slug,
          tenantName: data.tenant_name,
          idpName: data.idp_name,
          allowPassword: data.allow_password !== false,
        };
      }
    } catch (err) {
      console.debug('[Login] SSO lookup failed:', err);
    }

    return noSso;
  }, [apiUrl, ssoConfigured]);

  // Handle SSO redirect
  const handleSsoRedirect = useCallback((info: typeof ssoInfo) => {
    const params = new URLSearchParams();
    if (info.tenantSlug) params.set('tenant', info.tenantSlug);
    if (info.idpName) params.set('idp', info.idpName);
    const returnTo = new URLSearchParams(window.location.search).get('returnTo');
    if (returnTo) params.set('returnUrl', returnTo);
    
    window.location.href = `${apiUrl}/api/auth/cognito/authorize?${params.toString()}`;
  }, [apiUrl]);

  // Step 1: User submits email → check SSO, then decide next step
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter your email address',
        variant: 'destructive',
      });
      return;
    }

    if (!isBackendConfigured) {
      toast({
        title: 'Backend Not Configured',
        description: 'Please wait for the backend to start.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      const result = await lookupSso(email.trim());
      setSsoInfo(result);

      if (result.available && !result.allowPassword) {
        // SSO-only: redirect immediately (no password fallback)
        setStep('sso-redirect');
        handleSsoRedirect(result);
      } else {
        // No SSO, or hybrid mode (SSO + password allowed): show password field
        // User can still click "Sign in with SSO" button if SSO is available
        setStep('password');
        setTimeout(() => passwordRef.current?.focus(), 100);
      }
    } catch (err) {
      // If lookup fails, fall back to password
      setStep('password');
      setTimeout(() => passwordRef.current?.focus(), 100);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Password submit
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password) {
      toast({
        title: 'Validation Error',
        description: 'Please enter your password',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      setServerStatus('checking');
      await login(email.trim(), password);
      setServerStatus('online');

      toast({ title: 'Welcome!', description: 'Successfully signed in' });

      const returnTo = new URLSearchParams(window.location.search).get('returnTo') || '/insights';
      navigate(returnTo);
    } catch (error: any) {
      const errorMsg = error.message?.toLowerCase() || '';

      if (errorMsg.includes('connection') || errorMsg.includes('failed to fetch') || errorMsg.includes('networkerror')) {
        setServerStatus('offline');
      } else {
        setServerStatus('online');
      }

      let errorMessage = 'Sign in failed';
      let errorDescription = error.message || 'Invalid credentials';

      if (errorMsg.includes('invalid') || errorMsg.includes('401')) {
        errorMessage = 'Invalid Credentials';
        errorDescription = 'The email or password is incorrect.';
      } else if (errorMsg.includes('disabled') || errorMsg.includes('inactive')) {
        errorMessage = 'Account Disabled';
        errorDescription = 'Your account has been disabled. Please contact your administrator.';
      } else if (errorMsg.includes('connection') || errorMsg.includes('unavailable')) {
        errorMessage = 'Connection Error';
        errorDescription = 'Unable to connect to server.';
      }

      toast({ title: errorMessage, description: errorDescription, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Go back to email step
  const handleBack = () => {
    setStep('email');
    setPassword('');
    setSsoInfo({ available: false, allowPassword: true });
  };

  // Dev bypass: log in as superadmin without entering credentials
  const handleBypassSuperadmin = async () => {
    if (!isBackendConfigured) {
      toast({ title: 'Backend not configured', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      await login('superadmin', 'super123');
      toast({ title: 'Welcome!', description: 'Signed in as superadmin' });
      const returnTo = new URLSearchParams(window.location.search).get('returnTo') || '/insights';
      navigate(returnTo);
    } catch (err: any) {
      toast({ title: 'Bypass failed', description: err.message || 'Check backend and seed (superadmin / super123)', variant: 'destructive' });
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
          <CardTitle className="text-2xl font-light">Welcome</CardTitle>
          <CardDescription className="text-base">
            {step === 'email' && 'Sign in to access your dashboard'}
            {step === 'password' && 'Enter your password to continue'}
            {step === 'sso-redirect' && 'Redirecting to your organization\'s login...'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* ── Step 1: Email ──────────────────────────────────────── */}
          {step === 'email' && (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="text"
                  placeholder="Enter your email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  disabled={loading}
                  autoComplete="username"
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading || serverStatus === 'offline'}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          )}

          {/* ── Step 2: Password (with optional SSO) ──────────────── */}
          {step === 'password' && (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              {/* Show the email with a back button */}
              <div className="space-y-2">
                <Label>Email</Label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Change email"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <div className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-md text-sm text-slate-700 dark:text-slate-300 truncate">
                    {email}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  ref={passwordRef}
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="current-password"
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
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

              <div className="text-center">
                <a
                  href="/forgot-password"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Forgot password?
                </a>
              </div>

              {/* SSO option in hybrid mode */}
              {ssoInfo.available && (
                <>
                  <div className="relative my-2">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-white dark:bg-slate-900 px-2 text-slate-500">or</span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => handleSsoRedirect(ssoInfo)}
                    disabled={loading}
                  >
                    <KeyRound className="mr-2 h-4 w-4" />
                    {ssoInfo.tenantName
                      ? `Sign in with ${ssoInfo.tenantName} SSO`
                      : 'Sign in with SSO'}
                  </Button>
                </>
              )}
            </form>
          )}

          {/* ── SSO Redirect (loading state) ──────────────────────── */}
          {step === 'sso-redirect' && (
            <div className="flex flex-col items-center space-y-4 py-8">
              <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Redirecting to {ssoInfo.tenantName || 'your organization'}...
              </p>
              <button
                type="button"
                onClick={handleBack}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 mt-2"
              >
                Cancel and go back
              </button>
            </div>
          )}

          {/* Server Status */}
          <div className="mt-6 pt-6 border-t border-border">
            <div className="text-xs text-muted-foreground text-center space-y-2">
              <div className="flex items-center justify-center gap-2">
                {serverStatus === 'checking' && (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Checking server...</span>
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
                    <span className="text-rose-600 dark:text-rose-400">Server unavailable</span>
                  </>
                )}
                {serverStatus === 'not-configured' && (
                  <>
                    <XCircle className="h-3 w-3 text-amber-500" />
                    <span className="text-amber-600 dark:text-amber-400">Waiting for backend...</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Dev Mode Hint + Bypass */}
          {process.env.NODE_ENV === 'development' && (
            <div className="mt-4 p-3 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs text-muted-foreground space-y-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={handleBypassSuperadmin}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Login as superadmin (bypass)
              </Button>
              <p className="font-medium mb-1">Or use:</p>
              <ul className="space-y-1">
                <li><code>superadmin / super123</code> - Super Admin</li>
                <li><code>admin@acme.local / admin123</code> - Tenant Admin</li>
                <li><code>user@acme.local / user123</code> - Regular User</li>
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
