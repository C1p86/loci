import { useNavigate } from 'react-router-dom';
import { apiPost } from '../lib/api.js';
import type { Org, User } from '../lib/types.js';
import { useAuthStore } from '../stores/authStore.js';
import { Button } from './ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.js';
import { WsIndicator } from './WsIndicator.js';

export function TopNav({ user, org }: { user: User; org: Org }) {
  const nav = useNavigate();
  const clear = useAuthStore((s) => s.clear);

  async function logout() {
    try {
      await apiPost('/api/auth/logout');
    } catch {
      // ignore errors — clear client state regardless
    }
    clear();
    nav('/login', { replace: true });
  }

  return (
    <header className="flex items-center justify-between h-12 px-4 border-b bg-background">
      <div className="font-semibold">{org.name}</div>
      <div className="flex items-center gap-4">
        <WsIndicator />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              {user.email}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={logout}>Logout</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
