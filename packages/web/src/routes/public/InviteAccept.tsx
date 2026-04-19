import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button.js';
import { ApiError, apiGet, apiPost } from '../../lib/api.js';
import { useAuthStore } from '../../stores/authStore.js';

interface InvitePreview {
  orgName: string;
  role: string;
  inviterEmail: string;
}

type State = 'loading' | 'ready' | 'error';

export function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const nav = useNavigate();
  const authStatus = useAuthStore((s) => s.status);

  const [state, setState] = useState<State>('loading');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const data = await apiGet<InvitePreview>(`/api/invites/${token}`);
        setPreview(data);
        setState('ready');
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Invalid or expired invite link';
        setErrorMsg(message);
        setState('error');
      }
    }
    void load();
  }, [token]);

  async function accept() {
    if (authStatus !== 'authenticated') {
      nav(`/login?redirect=/invites/${token}`, { replace: true });
      return;
    }
    setAccepting(true);
    try {
      await apiPost(`/api/invites/${token}/accept`);
      nav('/', { replace: true });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to accept invite';
      setErrorMsg(message);
      setAccepting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40">
      <div className="w-full max-w-sm p-8 bg-background rounded-lg border shadow-sm text-center space-y-4">
        {state === 'loading' && <p className="text-muted-foreground">Loading invite...</p>}
        {state === 'error' && (
          <>
            <h1 className="text-xl font-bold text-destructive">Invalid invite</h1>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <a href="/login" className="text-sm text-muted-foreground hover:underline block">
              Back to sign in
            </a>
          </>
        )}
        {state === 'ready' && preview && (
          <>
            <h1 className="text-xl font-bold">You&apos;re invited!</h1>
            <p className="text-sm text-muted-foreground">
              <strong>{preview.inviterEmail}</strong> invited you to join{' '}
              <strong>{preview.orgName}</strong> as <strong>{preview.role}</strong>.
            </p>
            {errorMsg && <p className="text-sm font-medium text-destructive">{errorMsg}</p>}
            <Button onClick={accept} disabled={accepting} className="w-full">
              {accepting ? 'Accepting...' : 'Accept invite'}
            </Button>
            <a href="/login" className="text-sm text-muted-foreground hover:underline block">
              Sign in with a different account
            </a>
          </>
        )}
      </div>
    </div>
  );
}
