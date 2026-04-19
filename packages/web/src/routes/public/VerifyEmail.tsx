import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, apiPost } from '../../lib/api.js';

type State = 'pending' | 'success' | 'error';

export function VerifyEmail() {
  const { token } = useParams<{ token: string }>();
  const nav = useNavigate();
  const [state, setState] = useState<State>('pending');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    async function verify() {
      try {
        await apiPost('/api/auth/verify-email', { token });
        setState('success');
        setTimeout(() => nav('/login', { replace: true }), 2000);
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : 'Verification failed. The link may have expired.';
        setErrorMsg(message);
        setState('error');
      }
    }
    void verify();
  }, [token, nav]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40">
      <div className="w-full max-w-sm p-8 bg-background rounded-lg border shadow-sm text-center space-y-4">
        {state === 'pending' && <p className="text-muted-foreground">Verifying your email...</p>}
        {state === 'success' && (
          <>
            <h1 className="text-xl font-bold text-green-600">Email verified!</h1>
            <p className="text-sm text-muted-foreground">Redirecting to sign in...</p>
          </>
        )}
        {state === 'error' && (
          <>
            <h1 className="text-xl font-bold text-destructive">Verification failed</h1>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <a href="/login" className="text-sm text-muted-foreground hover:underline block">
              Back to sign in
            </a>
          </>
        )}
      </div>
    </div>
  );
}
