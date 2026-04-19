import { useState } from 'react';
import { RoleGate } from '../../components/RoleGate.js';
import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { useDlq, useDlqRetry } from '../../hooks/useDlq.js';
import type { DlqEntry } from '../../lib/types.js';

function ReasonBadge({ reason }: { reason: string }) {
  return <span className="px-2 py-0.5 rounded bg-muted text-xs">{reason}</span>;
}

function RetryBadge({ result }: { result: string | null }) {
  if (!result) return null;
  const colors: Record<string, string> = {
    succeeded: 'bg-green-100 text-green-800',
    failed_same_reason: 'bg-red-100 text-red-800',
    failed_new_reason: 'bg-amber-100 text-amber-900',
  };
  return <span className={`px-2 py-0.5 rounded text-xs ${colors[result] ?? ''}`}>{result}</span>;
}

export function DlqList() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const { data, isLoading, error } = useDlq(cursor);
  const retry = useDlqRetry();
  const [selected, setSelected] = useState<DlqEntry | null>(null);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Dead Letter Queue</h1>
      {isLoading && <div>Loading…</div>}
      {error && <div className="text-destructive">{(error as Error).message}</div>}
      {data && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>Plugin</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead>Delivery ID</TableHead>
                <TableHead>Retry</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.entries.map((e) => (
                <TableRow
                  key={e.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelected(e)}
                >
                  <TableCell>{new Date(e.receivedAt).toLocaleString()}</TableCell>
                  <TableCell>{e.pluginName}</TableCell>
                  <TableCell>
                    <ReasonBadge reason={e.failureReason} />
                  </TableCell>
                  <TableCell>{e.httpStatus ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{e.deliveryId ?? '—'}</TableCell>
                  <TableCell>
                    <RetryBadge result={e.retryResult} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.nextCursor && (
            <Button onClick={() => setCursor(data.nextCursor)} className="mt-3">
              Load more
            </Button>
          )}
        </>
      )}

      <Dialog
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>DLQ entry {selected?.id.slice(-8)}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <div>
                <strong>Reason:</strong> {selected.failureReason}
              </div>
              <div>
                <strong>HTTP status:</strong> {selected.httpStatus ?? '—'}
              </div>
              <div>
                <strong>Headers (scrubbed):</strong>
                {/* T-13-05-03: JSON.stringify + <pre> — no dangerouslySetInnerHTML */}
                <pre className="mt-1 p-2 rounded bg-muted text-xs overflow-auto max-h-40">
                  {JSON.stringify(selected.scrubbedHeaders, null, 2)}
                </pre>
              </div>
              <div>
                <strong>Body (scrubbed):</strong>
                <pre className="mt-1 p-2 rounded bg-muted text-xs overflow-auto max-h-80">
                  {JSON.stringify(selected.scrubbedBody, null, 2)}
                </pre>
              </div>
              {selected.retryResult && (
                <div className="text-sm text-muted-foreground">
                  Last retry: {selected.retriedAt && new Date(selected.retriedAt).toLocaleString()}{' '}
                  — {selected.retryResult}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Close
            </Button>
            {selected && (
              // biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA
              <RoleGate role="member" tooltip="Viewers cannot retry DLQ entries">
                <Button
                  onClick={() =>
                    retry.mutate({ dlqId: selected.id }, { onSuccess: () => setSelected(null) })
                  }
                  disabled={retry.isPending}
                >
                  {retry.isPending ? 'Retrying…' : 'Retry'}
                </Button>
              </RoleGate>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
