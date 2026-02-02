import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, LogIn, Shield, CheckCircle2, XCircle, Building2, KeyRound } from 'lucide-react';
import { CoheusLogo } from '@/components/ui/CoheusLogo';

export const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { login, loadTenants, tenants, isAuthenticated, user } = useAuth();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedTenant, setSelectedTenant] = useState<string>('__auto__');
  const [loading, setLoading] = useState(false);
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline' | 'not-configured'>('checking');
  const [showTenantSelect, setShowTenantSelect] = useState(false);
  
  // SSO state
  const [ssoInfo, setSsoInfo] = useState<{
    available: boolean;
    checking: boolean;
    tenantSlug?: string;
    tenantName?: string;
    idpName?: string;
    allowPassword: boolean;
  }>({ available: false, checking: false, allowPassword: true });
  const [ssoConfigured, setSsoConfigured] = useState(false);

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
    if (!apiUrl || apiUrl === '') {
      return '/api/health';
    }
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
          // Load available tenants
          loadTenants();
          // Check if SSO is configured
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
  const lookupSsoByEmail = useCallback(async (emailValue: string) => {
    if (!emailValue.includes('@') || !ssoConfigured) {
      setSsoInfo({ available: false, checking: false, allowPassword: true });
      return;
    }

    setSsoInfo(prev => ({ ...prev, checking: true }));

    try {
      const response = await fetch(`${apiUrl}/api/auth/cognito/lookup-tenant?email=${encodeURIComponent(emailValue)}`);
      if (response.ok) {
        const data = await response.json();
        setSsoInfo({
          available: data.sso_available === true,
          checking: false,
          tenantSlug: data.tenant_slug,
          tenantName: data.tenant_name,
          idpName: data.idp_name,
          allowPassword: data.allow_password !== false,
        });
      } else {
        setSsoInfo({ available: false, checking: false, allowPassword: true });
      }
    } catch (err) {
      console.debug('[Login] SSO lookup failed:', err);
      setSsoInfo({ available: false, checking: false, allowPassword: true });
    }
  }, [apiUrl, ssoConfigured]);

  // Debounced email change handler for SSO lookup
  useEffect(() => {
    const timer = setTimeout(() => {
      if (email && email.includes('@')) {
        lookupSsoByEmail(email);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [email, lookupSsoByEmail]);

  // Handle SSO sign-in
  const handleSsoSignIn = () => {
    const params = new URLSearchParams();
    if (ssoInfo.tenantSlug) {
      params.set('tenant', ssoInfo.tenantSlug);
    }
    if (ssoInfo.idpName) {
      params.set('idp', ssoInfo.idpName);
    }
    const returnTo = new URLSearchParams(window.location.search).get('returnTo');
    if (returnTo) {
      params.set('returnUrl', returnTo);
    }
    
    // Redirect to Cognito authorize endpoint
    window.location.href = `${apiUrl}/api/auth/cognito/authorize?${params.toString()}`;
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast({
        title: 'Validation Error',
        description: 'Please enter both email/username and password',
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
      setServerStatus('checking');
      
      // Pass tenant slug if selected (__auto__ means auto-detect / super admin)
      await login(email.trim(), password, selectedTenant === '__auto__' ? undefined : selectedTenant);
      
      setServerStatus('online');
      
      toast({
        title: 'Welcome!',
        description: 'Successfully signed in',
      });

      // Redirect based on user type
      const returnTo = new URLSearchParams(window.location.search).get('returnTo') || '/insights';
      navigate(returnTo);
      
    } catch (error: any) {
      const errorMsg = error.message?.toLowerCase() || '';
      
      if (errorMsg.includes('connection') || 
          errorMsg.includes('failed to fetch') ||
          errorMsg.includes('networkerror')) {
        setServerStatus('offline');
      } else {
        setServerStatus('online');
      }

      let errorMessage = 'Sign in failed';
      let errorDescription = error.message || 'Invalid credentials';
      
      if (errorMsg.includes('invalid') || errorMsg.includes('401')) {
        errorMessage = 'Invalid Credentials';
        errorDescription = 'The email/username or password is incorrect.';
      } else if (errorMsg.includes('disabled') || errorMsg.includes('inactive')) {
        errorMessage = 'Account Disabled';
        errorDescription = 'Your account has been disabled. Please contact your administrator.';
      } else if (errorMsg.includes('connection') || errorMsg.includes('unavailable')) {
        errorMessage = 'Connection Error';
        errorDescription = 'Unable to connect to server.';
      }
      
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
          <CardTitle className="text-2xl font-light">Welcome</CardTitle>
          <CardDescription className="text-base">
            Sign in to access your dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignIn} className="space-y-4">
            {/* Tenant Selection (optional) */}
            {tenants.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="tenant">Organization</Label>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowTenantSelect(!showTenantSelect)}
                  >
                    {showTenantSelect ? 'Hide' : 'Select organization'}
                  </button>
                </div>
                {showTenantSelect && (
                  <Select value={selectedTenant} onValueChange={setSelectedTenant}>
                    <SelectTrigger>
                      <SelectValue placeholder="Auto-detect (or Cohi admin)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">
                        <span className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-amber-500" />
                          Auto-detect / Cohi Admin
                        </span>
                      </SelectItem>
                      {tenants.map((tenant) => (
                        <SelectItem key={tenant.slug} value={tenant.slug}>
                          <span className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-blue-500" />
                            {tenant.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email or Username</Label>
              <Input
                id="email"
                type="text"
                placeholder="Enter your email or username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                disabled={loading}
                autoComplete="username"
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
                autoComplete="current-password"
              />
            </div>
            
            {/* Password Sign In Button - hidden if SSO-only mode */}
            {ssoInfo.allowPassword && (
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
            )}

            {/* SSO Divider and Button */}
            {ssoConfigured && (
              <>
                {ssoInfo.allowPassword && (
                  <div className="relative my-4">
                    <Separator />
                    <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-slate-900 px-2 text-xs text-slate-500">
                      or
                    </span>
                  </div>
                )}

                {ssoInfo.available ? (
                  <Button
                    type="button"
                    variant={ssoInfo.allowPassword ? "outline" : "default"}
                    className="w-full"
                    onClick={handleSsoSignIn}
                    disabled={loading}
                  >
                    <KeyRound className="mr-2 h-4 w-4" />
                    {ssoInfo.tenantName 
                      ? `Sign in with ${ssoInfo.tenantName} SSO`
                      : 'Sign in with SSO'
                    }
                  </Button>
                ) : ssoInfo.checking ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled
                  >
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Checking SSO availability...
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={handleSsoSignIn}
                    disabled={loading}
                  >
                    <KeyRound className="mr-2 h-4 w-4" />
                    Sign in with SSO
                  </Button>
                )}
              </>
            )}
          </form>
          
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

          {/* Dev Mode Hint */}
          {process.env.NODE_ENV === 'development' && (
            <div className="mt-4 p-3 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs text-muted-foreground">
              <p className="font-medium mb-1">Local Dev Accounts:</p>
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
