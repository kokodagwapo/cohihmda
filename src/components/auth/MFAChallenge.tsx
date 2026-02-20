import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from '@/components/ui/input-otp';
import { Loader2, ShieldCheck, ArrowLeft } from 'lucide-react';

interface MFAChallengeProps {
  email: string;
  session: string;
  onVerify: (code: string) => Promise<void>;
  onBack: () => void;
  loading?: boolean;
}

export function MFAChallenge({ email, session, onVerify, onBack, loading = false }: MFAChallengeProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (code.length !== 6) return;
    setError(null);
    try {
      await onVerify(code);
    } catch (err: any) {
      setError(err.message || 'Invalid verification code');
      setCode('');
    }
  }, [code, onVerify]);

  const handleCodeChange = useCallback(
    (value: string) => {
      setCode(value);
      setError(null);
      if (value.length === 6) {
        setTimeout(async () => {
          try {
            await onVerify(value);
          } catch (err: any) {
            setError(err.message || 'Invalid verification code');
            setCode('');
          }
        }, 0);
      }
    },
    [onVerify],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center space-y-3">
        <div className="h-12 w-12 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
          <ShieldCheck className="h-6 w-6 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-semibold">Two-Factor Authentication</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Enter the 6-digit code from your authenticator app
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center space-y-4">
        <InputOTP
          maxLength={6}
          value={code}
          onChange={handleCodeChange}
          disabled={loading}
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

        {error && (
          <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
        )}
      </div>

      <div className="space-y-3">
        <Button
          onClick={handleSubmit}
          className="w-full"
          disabled={loading || code.length !== 6}
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Verifying...
            </>
          ) : (
            'Verify'
          )}
        </Button>

        <Button
          variant="ghost"
          className="w-full"
          onClick={onBack}
          disabled={loading}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to login
        </Button>
      </div>

      <p className="text-xs text-center text-muted-foreground">
        Signing in as {email}
      </p>
    </div>
  );
}
