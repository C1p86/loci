import { useUsage } from '../hooks/useUsage.js';

function StatBar({ label, current, max }: { label: string; current: number; max: number }) {
  const pct = Math.min(100, (current / max) * 100);
  const danger = pct >= 100;
  return (
    <div className="flex-1 min-w-40">
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span className={danger ? 'text-destructive font-medium' : ''}>
          {current}/{max}
        </span>
      </div>
      <div className="h-2 bg-muted rounded overflow-hidden">
        <div
          className={`h-full ${danger ? 'bg-destructive' : 'bg-primary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function UsageWidget() {
  const { data } = useUsage();
  if (!data) return null;
  return (
    <div className="border rounded p-4 bg-card">
      <h3 className="font-medium mb-3">Usage</h3>
      <div className="flex flex-wrap gap-6">
        <StatBar label="Agents" current={data.agents.current} max={data.agents.max} />
        <StatBar
          label="Concurrent tasks"
          current={data.concurrent.current}
          max={data.concurrent.max}
        />
        <div className="flex flex-col justify-end">
          <div className="text-sm text-muted-foreground">Log retention</div>
          <div className="text-sm">{data.retentionDays} days</div>
        </div>
      </div>
    </div>
  );
}
