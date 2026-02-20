import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api';
import { CoheusLogo } from '@/components/ui/CoheusLogo';
import { Loader2, ArrowLeft, KeyRound, CheckCircle2, XCircle } from 'lucide-react';

function PasswordStrength({ password }: { password: string }) {
  const getStrength = (pw: string): { label: string; color: string; width: string } => {
    if (!pw) return { label: '', color: '', width: 'w-0' };
    if (pw.length < 8) return { label: 'Too short', color: 'bg-rose-500', width: 'w-1/4' };

    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    if (score <= 2) return { label: 'Weak', color: 'bg-orange-500', width: 'w-1/3' };
    if (score <= 3) return { label: 'Fair', color: 'bg-amber-500', width: 'w-1/2' };
    if (score <= 4) return { label: 'Good', color: 'bg-blue-500', width: 'w-3/4' };
    return { label: 'Strong', color: 'bg-emerald-500', width: 'w-full' };
  };

  const strength = getStrength(password);

  if (!password) return null;

  return (
    <div className="space-y-1">
      <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${strength.color} ${strength.width} rounded-full transition-all duration-300`} />
      </div>
      <p className="text-xs text-muted-foreground">{strength.label}</p>
    </div>
  );
}

export default function ResetPassword() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const emailParam = searchParams.get('email') || sessionStorage.getItem('reset_email') || '';

  // Cognito code-based flow when email is present (no token)
  const isCognitoFlow = !token && !!emailParam;

  const [email, setEmail] = useState(emailParam);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const apiUrl = getApiUrl();

  const hasValidInput = token || isCognitoFlow;

  useEffect(() => {
    if (!hasValidInput) {
      toast({
        title: 'Invalid Link',
        description: 'This password reset link is invalid. Please request a new one.',
        variant: 'destructive',
      });
    }
  }, [hasValidInput, toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const minLength = isCognitoFlow ? 10 : 8;
    if (password.length < minLength) {
      toast({
        title: 'Validation Error',
        description: `Password must be at least ${minLength} characters long.`,
        variant: 'destructive',
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: 'Validation Error',
        description: 'Passwords do not match.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      const body = isCognitoFlow
        ? { email: email.trim(), code: code.trim(), newPassword: password }
        : { token, newPassword: password };

      const response = await fetch(`${apiUrl}/api/auth/password-reset/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Password reset failed');
      }

      setSuccess(true);
      sessionStorage.removeItem('reset_email');
      toast({
        title: 'Password Reset',
        description: 'Your password has been reset successfully.',
      });

      setTimeout(() => navigate('/login'), 3000);
    } catch (error: any) {
      toast({
        title: 'Reset Failed',
        description: error.message || 'Failed to reset password. The code may have expired.',
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
          <CardTitle className="text-2xl font-light">
            {success ? 'Password Reset' : 'Set New Password'}
          </CardTitle>
          <CardDescription className="text-base">
            {success
              ? 'Your password has been updated. Redirecting to login...'
              : 'Enter your new password below.'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {success ? (
            <div className="flex flex-col items-center space-y-6 py-4">
              <div className="h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <Link to="/login" className="w-full">
                <Button className="w-full">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Go to Login
                </Button>
              </Link>
            </div>
          ) : !hasValidInput ? (
            <div className="flex flex-col items-center space-y-6 py-4">
              <div className="h-16 w-16 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                <XCircle className="h-8 w-8 text-rose-600 dark:text-rose-400" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                This password reset link is invalid or has expired.
              </p>
              <div className="flex flex-col gap-2 w-full">
                <Link to="/forgot-password" className="w-full">
                  <Button className="w-full">Request a new link</Button>
                </Link>
                <Link to="/login" className="w-full">
                  <Button variant="ghost" className="w-full">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to login
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {isCognitoFlow && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="reset-email">Email</Label>
                    <Input
                      id="reset-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={!!emailParam || loading}
                      autoComplete="email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reset-code">Verification Code</Label>
                    <Input
                      id="reset-code"
                      type="text"
                      placeholder="Enter the code from your email"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required
                      autoFocus
                      disabled={loading}
                      autoComplete="one-time-code"
                    />
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label htmlFor="password">New Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter new password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                  disabled={loading}
                  autoComplete="new-password"
                  minLength={8}
                />
                <PasswordStrength password={password} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="new-password"
                  minLength={8}
                />
                {confirmPassword && password !== confirmPassword && (
                  <p className="text-xs text-rose-500">Passwords do not match</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={
                  loading ||
                  password.length < (isCognitoFlow ? 10 : 8) ||
                  password !== confirmPassword ||
                  (isCognitoFlow && (!code.trim() || !email.trim()))
                }
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  <>
                    <KeyRound className="mr-2 h-4 w-4" />
                    Reset Password
                  </>
                )}
              </Button>

              <div className="text-center pt-2">
                <Link
                  to="/login"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back to login
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
