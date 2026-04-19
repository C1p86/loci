import { cn } from '../lib/utils.js';
import { useWsStore } from '../stores/wsStore.js';

const STYLES = {
  connected: { dot: 'bg-green-500', label: 'Connected' },
  reconnecting: { dot: 'bg-yellow-500', label: 'Reconnecting...' },
  disconnected: { dot: 'bg-red-500', label: 'Disconnected' },
} as const;

export function WsIndicator() {
  const status = useWsStore((s) => s.status);
  const { dot, label } = STYLES[status];
  return (
    <div
      className="flex items-center gap-2 text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <span className={cn('h-2 w-2 rounded-full', dot)} />
      <span>{label}</span>
    </div>
  );
}
