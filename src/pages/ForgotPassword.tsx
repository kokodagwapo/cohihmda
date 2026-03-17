import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api';
import { CoheusLogo } from '@/components/ui/CoheusLogo';
import { Loader2, ArrowLeft, Mail, CheckCircle2, KeyRound } from 'lucide-react';

export default function ForgotPassword() {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [useCognitoFlow, setUseCognitoFlow] = useState(false);
  const [accountReset, setAccountReset] = useState(false);
  const apiUrl = getApiUrl();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter your email address.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${apiUrl}/api/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Request failed');
      }

      const data = await response.json().catch(() => ({}));
      if (data.accountReset) {
        setAccountReset(true);
        setUseCognitoFlow(false);
        sessionStorage.removeItem('reset_email');
      } else if (data.useCognito) {
        setAccountReset(false);
        setUseCognitoFlow(true);
        sessionStorage.setItem('reset_email', email.trim());
      } else {
        setAccountReset(false);
        setUseCognitoFlow(false);
        sessionStorage.removeItem('reset_email');
      }

      setSubmitted(true);
    } catch {
      // Always show success to avoid revealing if account exists
      setUseCognitoFlow(false);
      setAccountReset(false);
      sessionStorage.removeItem('reset_email');
      setSubmitted(true);
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
            {submitted ? 'Check Your Email' : 'Forgot Password'}
          </CardTitle>
          <CardDescription className="text-base">
            {submitted
              ? 'If an account exists with that email, you will receive reset instructions.'
              : 'Enter your email address to reset your password.'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {submitted ? (
            <div className="flex flex-col items-center space-y-6 py-4">
              <div className="h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  {accountReset ? (
                    <>
                      We sent new login instructions to <span className="font-medium text-foreground">{email}</span>.
                      Use the temporary password in that email to sign in, then set a new password.
                    </>
                  ) : useCognitoFlow ? (
                    <>
                      We sent a verification code to <span className="font-medium text-foreground">{email}</span>.
                      Enter it on the next screen to set a new password.
                    </>
                  ) : (
                    <>
                      If an account exists for <span className="font-medium text-foreground">{email}</span>,
                      a password reset link has been sent.
                    </>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Didn't receive an email? Check your spam folder or try again.
                </p>
                {accountReset && (
                  <Link to="/login" className="w-full">
                    <Button className="w-full">
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Go to Login
                    </Button>
                  </Link>
                )}
                {useCognitoFlow && !accountReset && (
                  <Link to={`/reset-password?email=${encodeURIComponent(email)}`} className="w-full">
                    <Button className="w-full">
                      <KeyRound className="mr-2 h-4 w-4" />
                      Enter Reset Code
                    </Button>
                  </Link>
                )}
              </div>
              <div className="flex flex-col gap-2 w-full">
                <Button
                  variant="outline"
                  onClick={() => setSubmitted(false)}
                  className="w-full"
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Try a different email
                </Button>
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
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  disabled={loading}
                  autoComplete="email"
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
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
