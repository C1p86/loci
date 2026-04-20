import { useEffect, useState } from 'react';
import { CopyableCommand } from '../../components/CopyableCommand.js';
import { RoleGate } from '../../components/RoleGate.js';
import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import {
  useCreateWebhookToken,
  useRevokeWebhookToken,
  useWebhookTokens,
} from '../../hooks/useWebhookTokens.js';
import type { WebhookTokenRow } from '../../lib/types.js';

function TokenSection({
  plugin,
  tokens,
}: {
  plugin: 'github' | 'perforce';
  tokens: WebhookTokenRow[];
}) {
  const create = useCreateWebhookToken();
  const revoke = useRevokeWebhookToken();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState('');

  // T-13-05-02: clear secret on unmount
  useEffect(() => {
    return () => {
      setSecret('');
    };
  }, []);

  function reset() {
    setSecret('');
    create.reset();
    setOpen(false);
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium capitalize">{plugin}</h2>
        {/* biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA */}
        <RoleGate role="member" tooltip="Viewers cannot create webhook tokens">
          <Button onClick={() => setOpen(true)}>New token</Button>
        </RoleGate>
      </div>
      {tokens.length === 0 && <p className="text-sm text-muted-foreground">No tokens yet.</p>}
      {tokens.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Plugin secret</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{new Date(t.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>{t.hasPluginSecret ? 'yes' : 'no'}</TableCell>
                <TableCell>
                  {t.revokedAt ? (
                    <span className="text-muted-foreground">revoked</span>
                  ) : (
                    <span className="text-green-600">active</span>
                  )}
                </TableCell>
                <TableCell>
                  {!t.revokedAt && (
                    // biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA
                    <RoleGate role="member" tooltip="Viewers cannot revoke tokens">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => revoke.mutate({ id: t.id })}
                      >
                        Revoke
                      </Button>
                    </RoleGate>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) reset();
          setOpen(v);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New {plugin} webhook token</DialogTitle>
          </DialogHeader>
          {!create.data && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate({
                  pluginName: plugin,
                  pluginSecret: plugin === 'github' ? secret || undefined : undefined,
                });
              }}
            >
              {plugin === 'github' && (
                <div className="mb-3">
                  <Label htmlFor="ghs">
                    GitHub webhook secret (optional but strongly recommended)
                  </Label>
                  {/* T-13-05-02: type=password + autocomplete=off */}
                  <Input
                    id="ghs"
                    type="password"
                    autoComplete="off"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Paste the secret you'll set on the GitHub webhook. It will be encrypted
                    server-side and shown as metadata only from now on.
                  </p>
                </div>
              )}
              {plugin === 'perforce' && (
                <p className="text-sm text-muted-foreground">
                  Perforce tokens don't use HMAC — the token is the sole authentication factor. It
                  will be revealed ONCE.
                </p>
              )}
              {create.error && (
                <p className="text-destructive text-sm">{(create.error as Error).message}</p>
              )}
              <DialogFooter>
                <Button variant="outline" type="button" onClick={reset}>
                  Cancel
                </Button>
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? 'Creating…' : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          )}
          {/* T-13-05-01: plaintext token held ONLY in mutation result state */}
          {create.data && (
            <div className="space-y-3">
              <p className="text-sm">
                Token created. <strong>Copy both values now — the token is shown only once.</strong>
              </p>
              <CopyableCommand command={create.data.plaintext} label="Plaintext token:" />
              <CopyableCommand
                command={create.data.endpointUrl}
                label="Endpoint URL (configure this in the webhook sender):"
              />
              {plugin === 'perforce' && (
                <CopyableCommand
                  command={`xci agent-emit-perforce-trigger ${create.data.endpointUrl} ${create.data.plaintext}`}
                  label="Run on the Perforce server to emit the trigger script (Node-free):"
                />
              )}
              <DialogFooter>
                <Button onClick={reset}>Done</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function PluginSettings() {
  const { data: tokens } = useWebhookTokens();
  const github = (tokens ?? []).filter((t) => t.pluginName === 'github');
  const perforce = (tokens ?? []).filter((t) => t.pluginName === 'perforce');
  return (
    <div className="space-y-8 max-w-5xl">
      <h1 className="text-2xl font-semibold">Plugin settings</h1>
      <TokenSection plugin="github" tokens={github} />
      <TokenSection plugin="perforce" tokens={perforce} />
    </div>
  );
}
