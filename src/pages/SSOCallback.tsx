/**
 * SSO Callback Page
 * Handles the OAuth callback from Cognito after successful authentication
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { CoheusLogo } from '@/components/ui/CoheusLogo';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api';

type CallbackState = 'processing' | 'success' | 'error';

export const SSOCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuthFromToken } = useAuth();
  
  const [state, setState] = useState<CallbackState>('processing');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Get authorization code and state from URL
        const code = searchParams.get('code');
        const stateParam = searchParams.get('state');
        const error = searchParams.get('error');
        const errorDescription = searchParams.get('error_description');

        // Handle OAuth errors
        if (error) {
          throw new Error(errorDescription || error);
        }

        if (!code) {
          throw new Error('No authorization code received');
        }

        // Exchange code for tokens via backend
        const apiUrl = getApiUrl();
        const response = await fetch(`${apiUrl}/api/auth/cognito/callback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code,
            state: stateParam,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Authentication failed');
        }

        const data = await response.json();

        // Set auth state
        if (data.token && data.user) {
          // Update auth context (this stores the token in localStorage as 'auth_token' and sets API client)
          if (setAuthFromToken) {
            setAuthFromToken(data.token, data.user);
          }

          setState('success');

          // Redirect after brief success message
          setTimeout(() => {
            const returnUrl = data.returnUrl || '/insights';
            navigate(returnUrl, { replace: true });
          }, 1000);
        } else {
          throw new Error('Invalid response from server');
        }
      } catch (err: any) {
        console.error('[SSOCallback] Error:', err);
        setState('error');
        setErrorMessage(err.message || 'Authentication failed');
      }
    };

    handleCallback();
  }, [searchParams, navigate, setAuthFromToken]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
      <Card className="w-full max-w-md shadow-xl border-0">
        <CardContent className="p-8">
          <div className="flex flex-col items-center space-y-6">
            <CoheusLogo className="h-12 w-auto" />
            
            {state === 'processing' && (
              <>
                <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
                <div className="text-center">
                  <h2 className="text-xl font-medium text-slate-900 dark:text-white">
                    Completing sign in...
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                    Please wait while we verify your credentials
                  </p>
                </div>
              </>
            )}

            {state === 'success' && (
              <>
                <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                <div className="text-center">
                  <h2 className="text-xl font-medium text-slate-900 dark:text-white">
                    Sign in successful!
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                    Redirecting to your dashboard...
                  </p>
                </div>
              </>
            )}

            {state === 'error' && (
              <>
                <XCircle className="h-12 w-12 text-rose-500" />
                <div className="text-center">
                  <h2 className="text-xl font-medium text-slate-900 dark:text-white">
                    Sign in failed
                  </h2>
                  <p className="text-sm text-rose-600 dark:text-rose-400 mt-2">
                    {errorMessage}
                  </p>
                  <button
                    onClick={() => navigate('/login')}
                    className="mt-4 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    Return to login
                  </button>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SSOCallback;
