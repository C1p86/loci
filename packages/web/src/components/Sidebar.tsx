import { Activity, AlertCircle, CheckCircle2, ListOrdered, Plug, Settings } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { cn } from '../lib/utils.js';
import { useUiStore } from '../stores/uiStore.js';

const LINKS = [
  { to: '/agents', label: 'Agents', icon: Activity },
  { to: '/tasks', label: 'Tasks', icon: CheckCircle2 },
  { to: '/history', label: 'History', icon: ListOrdered },
  { to: '/settings/org', label: 'Org', icon: Settings },
  { to: '/settings/plugins', label: 'Plugins', icon: Plug },
  { to: '/dlq', label: 'DLQ', icon: AlertCircle },
] as const;

export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  return (
    <aside className={cn('border-r bg-muted/40 transition-all', collapsed ? 'w-14' : 'w-48')}>
      <nav className="flex flex-col p-2 gap-1">
        {LINKS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
