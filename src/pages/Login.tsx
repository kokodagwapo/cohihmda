import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl, api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, LogIn, CheckCircle2, XCircle, KeyRound, ArrowLeft, ArrowRight, ShieldCheck } from 'lucide-react';
import { CoheusLogo } from '@/components/ui/CoheusLogo';
import { MFAChallenge } from '@/components/auth/MFAChallenge';
import { MFAMethodSelect } from '@/components/auth/MFAMethodSelect';
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from '@/components/ui/input-otp';

type LoginStep = 'email' | 'password' | 'new-password' | 'mfa' | 'mfa-method-select' | 'mfa-setup' | 'sso-redirect';

export const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { login, completeMfaLogin, loadTenants, isAuthenticated, user } = useAuth();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline' | 'not-configured'>('checking');
  const [mfaSession, setMfaSession] = useState<string | null>(null);
  const [mfaChallengeName, setMfaChallengeName] = useState<'SOFTWARE_TOKEN_MFA' | 'EMAIL_OTP' | 'SMS_MFA'>('SOFTWARE_TOKEN_MFA');
  const [challengeSession, setChallengeSession] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [cognitoAccessToken, setCognitoAccessToken] = useState<string | null>(null);
  const [mfaSetupSecret, setMfaSetupSecret] = useState('');
  const [mfaSetupQrUri, setMfaSetupQrUri] = useState('');
  const [mfaSetupCode, setMfaSetupCode] = useState('');
  
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
      await login(email.trim(), password, ssoInfo.tenantSlug);
      setServerStatus('online');

      toast({ title: 'Welcome!', description: 'Successfully signed in' });

      const returnTo = new URLSearchParams(window.location.search).get('returnTo') || '/insights';
      navigate(returnTo);
    } catch (error: any) {
      // Handle MFA challenge
      if (error.mfaRequired) {
        setServerStatus('online');
        setMfaSession(error.session);
        setMfaChallengeName(error.challengeName || 'SOFTWARE_TOKEN_MFA');
        setStep('mfa');
        return;
      }

      // Handle forced password change (first login with temp password)
      if (error.newPasswordRequired) {
        setServerStatus('online');
        setChallengeSession(error.session);
        setStep('new-password');
        return;
      }

      if (error.mfaSetupRequired) {
        setServerStatus('online');
        setChallengeSession(error.session || null);
        setCognitoAccessToken(error.cognitoAccessToken || null);
        if (error.cognitoAccessToken) {
          localStorage.setItem('cognito_access_token', error.cognitoAccessToken);
        }
        setStep('mfa-method-select');
        return;
      }

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

  const handleBack = () => {
    setStep('email');
    setPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setMfaSession(null);
    setMfaChallengeName('SOFTWARE_TOKEN_MFA');
    setChallengeSession(null);
    setCognitoAccessToken(null);
    setMfaSetupSecret('');
    setMfaSetupQrUri('');
    setMfaSetupCode('');
    setSsoInfo({ available: false, allowPassword: true });
  };

  const handleNewPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeSession || newPassword.length < 10 || newPassword !== confirmNewPassword) return;

    setLoading(true);
    try {
      const response = await api.request<{
        user?: any;
        token?: string;
        refreshToken?: string;
        cognitoAccessToken?: string;
        mfaRequired?: boolean;
        mfaSetupRequired?: boolean;
        challengeName?: string;
        session?: string;
        email?: string;
      }>('/api/auth/new-password', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          session: challengeSession,
          newPassword,
          tenantSlug: ssoInfo.tenantSlug,
        }),
      });

      // After password change, Cognito may require MFA setup
      if (response.mfaSetupRequired || response.challengeName === 'MFA_SETUP') {
        setChallengeSession(response.session || null);
        setCognitoAccessToken(response.cognitoAccessToken || null);
        if (response.cognitoAccessToken) {
          localStorage.setItem('cognito_access_token', response.cognitoAccessToken);
        }
        setStep('mfa-method-select');
        toast({ title: 'Password Updated', description: 'MFA setup is required to continue.' });
        return;
      }

      // Or MFA verification if already enrolled
      if (response.mfaRequired) {
        setMfaSession(response.session || null);
        setMfaChallengeName((response.challengeName as 'SOFTWARE_TOKEN_MFA' | 'EMAIL_OTP' | 'SMS_MFA') || 'SOFTWARE_TOKEN_MFA');
        setStep('mfa');
        toast({ title: 'Password Updated', description: 'Enter your MFA code to continue.' });
        return;
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to set new password',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleMfaVerify = useCallback(async (code: string) => {
    if (!mfaSession) return;
    setLoading(true);
    try {
      await completeMfaLogin(email.trim(), mfaSession, code, ssoInfo.tenantSlug, mfaChallengeName);
      toast({ title: 'Welcome!', description: 'Successfully signed in' });
      const returnTo = new URLSearchParams(window.location.search).get('returnTo') || '/insights';
      navigate(returnTo);
    } finally {
      setLoading(false);
    }
  }, [mfaSession, email, completeMfaLogin, navigate, toast, ssoInfo.tenantSlug, mfaChallengeName]);

  const handleChooseEmailMfa = useCallback(async () => {
    setLoading(true);
    try {
      await api.request('/api/auth/mfa/email/setup', {
        method: 'POST',
        body: JSON.stringify({
          cognitoAccessToken: cognitoAccessToken || localStorage.getItem('cognito_access_token') || undefined,
        }),
      });

      await login(email.trim(), newPassword || password, ssoInfo.tenantSlug);
      toast({ title: 'Email MFA enabled', description: 'Enter the email code from Cognito to continue.' });
    } catch (error: any) {
      if (error?.mfaRequired) {
        setMfaSession(error.session);
        setMfaChallengeName(error.challengeName || 'EMAIL_OTP');
        setStep('mfa');
        return;
      }
      toast({
        title: 'Error',
        description: error.message || 'Failed to enable email MFA',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [email, cognitoAccessToken, ssoInfo.tenantSlug, toast, login, newPassword, password]);

  const handleChooseAuthenticatorMfa = useCallback(async () => {
    const accessToken = cognitoAccessToken || localStorage.getItem('cognito_access_token');
    if (!accessToken) {
      toast({
        title: 'Missing session',
        description: 'Please sign in again to continue MFA setup.',
        variant: 'destructive',
      });
      setStep('password');
      return;
    }

    setLoading(true);
    try {
      const response = await api.request<{ secret: string; qrCodeUri: string }>('/api/auth/mfa/setup', {
        method: 'POST',
        body: JSON.stringify({ cognitoAccessToken: accessToken }),
      });
      setMfaSetupSecret(response.secret);
      setMfaSetupQrUri(response.qrCodeUri);
      setStep('mfa-setup');
    } catch (error: any) {
      toast({
        title: 'MFA Setup Failed',
        description: error.message || 'Could not start authenticator setup',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [cognitoAccessToken, toast]);

  const handleVerifyAuthenticatorSetup = useCallback(async () => {
    if (mfaSetupCode.length !== 6) return;
    const accessToken = cognitoAccessToken || localStorage.getItem('cognito_access_token');
    if (!accessToken) return;

    setLoading(true);
    try {
      await api.request('/api/auth/mfa/setup/confirm', {
        method: 'POST',
        body: JSON.stringify({
          cognitoAccessToken: accessToken,
          code: mfaSetupCode,
          tenantSlug: ssoInfo.tenantSlug,
        }),
      });

      // Re-authenticate to complete sign in after mandatory setup.
      await login(email.trim(), newPassword || password, ssoInfo.tenantSlug);
      toast({ title: 'Welcome!', description: 'MFA enabled and sign-in completed.' });
      const returnTo = new URLSearchParams(window.location.search).get('returnTo') || '/insights';
      navigate(returnTo);
    } catch (error: any) {
      if (error?.mfaRequired) {
        setMfaSession(error.session);
        setMfaChallengeName(error.challengeName || 'SOFTWARE_TOKEN_MFA');
        setStep('mfa');
        return;
      }
      toast({
        title: 'Verification Failed',
        description: error.message || 'Invalid code. Please try again.',
        variant: 'destructive',
      });
      setMfaSetupCode('');
    } finally {
      setLoading(false);
    }
  }, [mfaSetupCode, cognitoAccessToken, ssoInfo.tenantSlug, login, email, newPassword, password, toast, navigate]);

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
            {step === 'new-password' && 'Please set a new password to continue'}
            {step === 'mfa' && 'Verify your identity'}
            {step === 'mfa-method-select' && 'Choose your MFA method'}
            {step === 'mfa-setup' && 'Set up your authenticator app'}
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

          {/* ── New Password (first login with temp password) ──── */}
          {step === 'new-password' && (
            <form onSubmit={handleNewPasswordSubmit} className="space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                <KeyRound className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  Welcome! You need to set a permanent password before continuing.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="Minimum 10 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoFocus
                  disabled={loading}
                  autoComplete="new-password"
                  minLength={10}
                />
                {newPassword && newPassword.length < 10 && (
                  <p className="text-xs text-muted-foreground">At least 10 characters with uppercase, lowercase, numbers, and symbols</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-new-password">Confirm Password</Label>
                <Input
                  id="confirm-new-password"
                  type="password"
                  placeholder="Confirm your password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="new-password"
                  minLength={10}
                />
                {confirmNewPassword && newPassword !== confirmNewPassword && (
                  <p className="text-xs text-rose-500">Passwords do not match</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={loading || newPassword.length < 10 || newPassword !== confirmNewPassword}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Setting password...
                  </>
                ) : (
                  <>
                    <KeyRound className="mr-2 h-4 w-4" />
                    Set Password & Continue
                  </>
                )}
              </Button>

              <Button variant="ghost" className="w-full" onClick={handleBack} disabled={loading}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to login
              </Button>
            </form>
          )}

          {/* ── MFA Method selection (mandatory) */}
          {step === 'mfa-method-select' && (
            <MFAMethodSelect
              loading={loading}
              onChooseAuthenticator={() => void handleChooseAuthenticatorMfa()}
              onChooseEmail={() => void handleChooseEmailMfa()}
            />
          )}

          {/* ── Authenticator setup */}
          {step === 'mfa-setup' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <p className="text-sm font-medium">Step 1: Scan this QR code</p>
                <p className="text-xs text-muted-foreground">
                  Use Google Authenticator, Authy, 1Password, or another TOTP app.
                </p>
              </div>

              <div className="flex flex-col items-center space-y-4">
                <div className="p-4 bg-white rounded-xl border shadow-sm">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(mfaSetupQrUri)}`}
                    alt="MFA QR Code"
                    width={200}
                    height={200}
                    className="rounded"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Can&apos;t scan? Use this setup key: <code className="font-mono">{mfaSetupSecret}</code>
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Step 2: Enter a 6-digit code from your app</p>
                <div className="flex justify-center">
                  <InputOTP
                    maxLength={6}
                    value={mfaSetupCode}
                    onChange={setMfaSetupCode}
                    disabled={loading}
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                    </InputOTPGroup>
                    <InputOTPSeparator />
                    <InputOTPGroup>
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              </div>

              <div className="space-y-3">
                <Button
                  className="w-full"
                  onClick={() => void handleVerifyAuthenticatorSetup()}
                  disabled={loading || mfaSetupCode.length !== 6}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Verify & Continue
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => setStep('mfa-method-select')}
                  disabled={loading}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Choose another method
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 3: MFA Challenge ────────────────────────────── */}
          {step === 'mfa' && mfaSession && (
            <MFAChallenge
              email={email}
              session={mfaSession}
              challengeName={mfaChallengeName}
              onVerify={handleMfaVerify}
              onBack={handleBack}
              loading={loading}
            />
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
