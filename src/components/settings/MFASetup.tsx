import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from '@/components/ui/input-otp';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import {
  Loader2,
  ShieldCheck,
  QrCode,
  Copy,
  Check,
  AlertTriangle,
  MailCheck,
} from 'lucide-react';

type SetupStep = 'idle' | 'loading-qr' | 'scan' | 'verify' | 'done';

export function MFASetup() {
  const { toast } = useToast();
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [mfaMethod, setMfaMethod] = useState<'totp' | 'email' | null>(null);
  const [mfaAvailable, setMfaAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [setupStep, setSetupStep] = useState<SetupStep>('idle');
  const [secret, setSecret] = useState('');
  const [qrCodeUri, setQrCodeUri] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  useEffect(() => {
    checkMfaStatus();
  }, []);

  const checkMfaStatus = async () => {
    try {
      const response = await api.request<{
        mfaEnabled: boolean;
        mfaMethod: 'totp' | 'email' | null;
        available: boolean;
      }>(
        '/api/auth/mfa/status',
      );
      setMfaEnabled(response.mfaEnabled);
      setMfaMethod(response.mfaMethod || null);
      setMfaAvailable(response.available);
    } catch {
      setMfaAvailable(false);
    } finally {
      setLoading(false);
    }
  };

  const startSetup = async () => {
    setSetupStep('loading-qr');
    try {
      // The backend needs the Cognito access token. For now we pass a placeholder
      // since the MFA setup route requires it. In the full flow, the access token
      // would be stored after login. For setup, we call the endpoint which will
      // use the session's cognito context.
      const cognitoAccessToken = localStorage.getItem('cognito_access_token') || '';

      const response = await api.request<{ secret: string; qrCodeUri: string }>(
        '/api/auth/mfa/setup',
        {
          method: 'POST',
          body: JSON.stringify({ cognitoAccessToken }),
        },
      );
      setSecret(response.secret);
      setQrCodeUri(response.qrCodeUri);
      setSetupStep('scan');
    } catch (error: any) {
      toast({
        title: 'Setup Failed',
        description: error.message || 'Could not start MFA setup',
        variant: 'destructive',
      });
      setSetupStep('idle');
    }
  };

  const handleVerify = useCallback(async (code: string) => {
    if (code.length !== 6) return;
    setVerifyLoading(true);
    try {
      const cognitoAccessToken = localStorage.getItem('cognito_access_token') || '';
      await api.request('/api/auth/mfa/setup/confirm', {
        method: 'POST',
        body: JSON.stringify({ cognitoAccessToken, code }),
      });
      setMfaEnabled(true);
      setMfaMethod('totp');
      setSetupStep('done');
      toast({ title: 'MFA Enabled', description: 'Two-factor authentication is now active.' });
    } catch (error: any) {
      toast({
        title: 'Verification Failed',
        description: error.message || 'Invalid code. Please try again.',
        variant: 'destructive',
      });
      setVerifyCode('');
    } finally {
      setVerifyLoading(false);
    }
  }, [toast]);

  const startEmailSetup = async () => {
    try {
      await api.request('/api/auth/mfa/email/setup', {
        method: 'POST',
        body: JSON.stringify({
          cognitoAccessToken: localStorage.getItem('cognito_access_token') || undefined,
        }),
      });
      setMfaEnabled(true);
      setMfaMethod('email');
      setSetupStep('done');
      toast({ title: 'Email MFA Enabled', description: 'Email OTP will be required on your next sign-in.' });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to start email MFA setup',
        variant: 'destructive',
      });
    }
  };

  const copySecret = () => {
    navigator.clipboard.writeText(secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!mfaAvailable) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Two-Factor Authentication
          {mfaEnabled !== null && (
            <Badge variant={mfaEnabled ? 'default' : 'secondary'} className="ml-auto">
              {mfaEnabled ? 'Enabled' : 'Disabled'}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          MFA is required for all non-SSO users. You can use an authenticator app or email verification codes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Idle / Enabled state */}
        {(setupStep === 'idle' || setupStep === 'done') && (
          <div className="space-y-4">
            {mfaEnabled ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  <div className="text-sm text-emerald-700 dark:text-emerald-300">
                    Your account is protected with MFA.
                    {mfaMethod ? ` Current method: ${mfaMethod === 'totp' ? 'Authenticator app' : 'Email code'}.` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {mfaMethod !== 'totp' && (
                    <Button variant="outline" onClick={startSetup}>
                      <QrCode className="mr-2 h-4 w-4" />
                      Switch to Authenticator App
                    </Button>
                  )}
                  {mfaMethod !== 'email' && (
                    <Button variant="outline" onClick={startEmailSetup}>
                      <MailCheck className="mr-2 h-4 w-4" />
                      Switch to Email Code
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div className="text-sm text-amber-700 dark:text-amber-300">
                    Your account is not protected with two-factor authentication. We recommend enabling it.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={startSetup}>
                    <QrCode className="mr-2 h-4 w-4" />
                    Use Authenticator App
                  </Button>
                  <Button variant="outline" onClick={startEmailSetup}>
                    <MailCheck className="mr-2 h-4 w-4" />
                    Use Email Code
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Loading QR */}
        {setupStep === 'loading-qr' && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Scan QR code */}
        {setupStep === 'scan' && (
          <div className="space-y-6">
            <div className="space-y-3">
              <p className="text-sm font-medium">
                Step 1: Scan this QR code with your authenticator app
              </p>
              <p className="text-xs text-muted-foreground">
                Use Google Authenticator, Authy, 1Password, or any TOTP-compatible app.
              </p>
            </div>

            <div className="flex flex-col items-center space-y-4">
              {/* QR code rendered using a public API (no extra dependency) */}
              <div className="p-4 bg-white rounded-xl border shadow-sm">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrCodeUri)}`}
                  alt="MFA QR Code"
                  width={200}
                  height={200}
                  className="rounded"
                />
              </div>

              <div className="text-center space-y-2">
                <p className="text-xs text-muted-foreground">
                  Can't scan? Enter this code manually:
                </p>
                <div className="flex items-center gap-2">
                  <code className="px-3 py-1.5 bg-muted rounded text-xs font-mono tracking-wider select-all">
                    {secret}
                  </code>
                  <Button variant="ghost" size="sm" onClick={copySecret} className="h-8 w-8 p-0">
                    {copiedSecret ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            </div>

            <Button className="w-full" onClick={() => setSetupStep('verify')}>
              I've scanned the code
            </Button>
          </div>
        )}

        {/* Verify */}
        {setupStep === 'verify' && (
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Step 2: Enter the 6-digit code from your authenticator app
              </p>
              <p className="text-xs text-muted-foreground">
                This verifies that MFA is set up correctly.
              </p>
            </div>

            <div className="flex flex-col items-center space-y-4">
              <InputOTP
                maxLength={6}
                value={verifyCode}
                onChange={(val) => {
                  setVerifyCode(val);
                  if (val.length === 6) handleVerify(val);
                }}
                disabled={verifyLoading}
                autoFocus
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

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setSetupStep('scan');
                  setVerifyCode('');
                }}
                disabled={verifyLoading}
              >
                Back
              </Button>
              <Button
                className="flex-1"
                onClick={() => handleVerify(verifyCode)}
                disabled={verifyLoading || verifyCode.length !== 6}
              >
                {verifyLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify & Enable'
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
