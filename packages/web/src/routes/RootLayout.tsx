import { type LoaderFunctionArgs, Outlet, redirect, useLoaderData } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar.js';
import { TopNav } from '../components/TopNav.js';
import { ApiError, apiGet } from '../lib/api.js';
import type { AuthMe } from '../lib/types.js';
import { useAuthStore } from '../stores/authStore.js';

export async function rootLoader({ request }: LoaderFunctionArgs) {
  try {
    const me = await apiGet<AuthMe>('/api/auth/me');
    useAuthStore.getState().setFromMe(me);
    // Prime CSRF cookie + token for subsequent mutations (@fastify/csrf-protection
    // requires a secret cookie seeded by generateCsrf before any POST/PATCH/DELETE).
    await apiGet<{ csrfToken: string }>('/api/auth/csrf').catch(() => undefined);
    return me;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      const url = new URL(request.url);
      throw redirect(`/login?redirect=${encodeURIComponent(url.pathname + url.search)}`);
    }
    throw err;
  }
}

export function RootLayout() {
  const me = useLoaderData() as AuthMe;
  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <TopNav user={me.user} org={me.org} />
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
