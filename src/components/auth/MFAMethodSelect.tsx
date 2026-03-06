import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ShieldCheck, Smartphone, Mail, Loader2 } from 'lucide-react';

interface MFAMethodSelectProps {
  onChooseAuthenticator: () => void;
  onChooseEmail: () => void;
  loading?: boolean;
}

export function MFAMethodSelect({
  onChooseAuthenticator,
  onChooseEmail,
  loading = false,
}: MFAMethodSelectProps) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center space-y-3">
        <div className="h-12 w-12 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
          <ShieldCheck className="h-6 w-6 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-semibold">Set up multi-factor authentication</h3>
          <p className="text-sm text-muted-foreground mt-1">
            MFA is required to continue. Choose a verification method.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Smartphone className="h-5 w-5 mt-0.5 text-blue-600 dark:text-blue-400" />
              <div className="flex-1">
                <p className="font-medium text-sm">Authenticator app</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Recommended. Use Google Authenticator, Authy, or 1Password.
                </p>
                <Button
                  type="button"
                  className="mt-3 w-full"
                  onClick={onChooseAuthenticator}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    'Use Authenticator App'
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 mt-0.5 text-emerald-600 dark:text-emerald-400" />
              <div className="flex-1">
                <p className="font-medium text-sm">Email verification code</p>
                <p className="text-xs text-muted-foreground mt-1">
                  A one-time 6-digit code will be sent to your inbox.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 w-full"
                  onClick={onChooseEmail}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    'Use Email Code'
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

