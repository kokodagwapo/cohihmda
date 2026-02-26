import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getApiUrl } from '@/lib/api';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

export default function Unsubscribe() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'invalid'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      setMessage('Missing unsubscribe link.');
      return;
    }

    const base = getApiUrl();
    const url = base ? `${base}/api/email/unsubscribe/${token}` : `/api/email/unsubscribe/${token}`;

    fetch(url, { method: 'GET', credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setStatus('success');
          setMessage(data.message || 'You have been unsubscribed from the Cohi Daily Brief.');
        } else if (data.alreadyUnsubscribed) {
          setStatus('success');
          setMessage('You are already unsubscribed.');
        } else {
          setStatus('error');
          setMessage(data.error || 'Could not process unsubscribe.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Something went wrong. Please try again or manage preferences after signing in.');
      });
  }, [token]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full rounded-xl border border-border bg-card p-8 shadow-sm text-center">
        {status === 'loading' && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Processing unsubscribe…</p>
          </>
        )}
        {(status === 'success' || status === 'invalid') && (
          <>
            <CheckCircle className="h-12 w-12 text-green-600 dark:text-green-500 mx-auto mb-4" />
            <h1 className="text-xl font-semibold mb-2">
              {status === 'invalid' ? 'Invalid link' : 'You’re unsubscribed'}
            </h1>
            <p className="text-muted-foreground mb-6">
              {status === 'invalid' ? 'This unsubscribe link is missing or invalid.' : message}
            </p>
            <Link
              to="/login"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Sign in to Cohi
            </Link>
            <p className="mt-4 text-sm text-muted-foreground">
              You can change email preferences anytime under{' '}
              <Link to="/settings?tab=notifications" className="text-primary underline">
                Settings → Notifications
              </Link>{' '}
              after signing in.
            </p>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
            <p className="text-muted-foreground mb-6">{message}</p>
            <Link
              to="/login"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Sign in to manage preferences
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
