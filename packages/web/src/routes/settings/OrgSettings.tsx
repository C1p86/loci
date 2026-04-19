import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DisabledWithTooltip } from '../../components/DisabledWithTooltip.js';
import { RoleGate } from '../../components/RoleGate.js';
import { UsageWidget } from '../../components/UsageWidget.js';
import { Button } from '../../components/ui/button.js';
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
import { useCreateInvite, useInvites, useRevokeInvite } from '../../hooks/useInvites.js';
import { useChangeMemberRole, useMembers, useRemoveMember } from '../../hooks/useOrg.js';
import { apiDelete } from '../../lib/api.js';
import { useAuthStore } from '../../stores/authStore.js';

export function OrgSettings() {
  const me = useAuthStore((s) => s.user);
  const myRole = useAuthStore((s) => s.org?.role);
  const orgId = useAuthStore((s) => s.org?.id);
  const clearAuth = useAuthStore((s) => s.clear);
  const nav = useNavigate();
  const { data: members } = useMembers();
  const { data: invites } = useInvites();
  const changeRole = useChangeMemberRole();
  const remove = useRemoveMember();
  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'viewer'>('member');

  async function leaveOrg() {
    const myMember = (members ?? []).find((m) => m.userId === me?.id);
    if (!myMember) return;
    await apiDelete(`/api/orgs/${orgId}/members/${myMember.id}`);
    clearAuth();
    nav('/login');
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-2xl font-semibold">Org settings</h1>
      <UsageWidget />

      <section>
        <h2 className="text-lg font-medium mb-2">Members</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(members ?? []).map((m) => {
              const isMe = m.userId === me?.id;
              return (
                <TableRow key={m.id}>
                  <TableCell>
                    {m.email}
                    {isMe && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                  </TableCell>
                  <TableCell>
                    {m.role === 'owner' ? (
                      <span>owner</span>
                    ) : (
                      // biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA
                      <RoleGate role="owner" tooltip="Only the Owner can change roles">
                        <select
                          value={m.role}
                          onChange={(e) =>
                            changeRole.mutate({
                              memberId: m.id,
                              role: e.target.value as 'member' | 'viewer',
                            })
                          }
                          disabled={changeRole.isPending}
                        >
                          <option value="member">member</option>
                          <option value="viewer">viewer</option>
                        </select>
                      </RoleGate>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(m.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {m.role !== 'owner' && !isMe && (
                      // biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA
                      <RoleGate role="owner" tooltip="Only the Owner can remove members">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => remove.mutate({ memberId: m.id })}
                        >
                          Remove
                        </Button>
                      </RoleGate>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Invite new member</h2>
        <form
          className="flex gap-3 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            createInvite.mutate({ email, role }, { onSuccess: () => setEmail('') });
          }}
        >
          <div>
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="invite-role">Role</Label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as 'member' | 'viewer')}
              className="border rounded px-2 py-1 h-10"
            >
              <option value="member">member</option>
              <option value="viewer">viewer</option>
            </select>
          </div>
          {/* biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA */}
          <RoleGate role="member" tooltip="Viewers cannot invite members">
            <Button type="submit" disabled={createInvite.isPending}>
              {createInvite.isPending ? 'Sending…' : 'Send invite'}
            </Button>
          </RoleGate>
        </form>
        {createInvite.error && (
          <p className="text-destructive mt-2">{(createInvite.error as Error).message}</p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Pending invites</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(invites ?? [])
              .filter((i) => !i.acceptedAt && !i.revokedAt)
              .map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>{inv.email}</TableCell>
                  <TableCell>{inv.role}</TableCell>
                  <TableCell>{new Date(inv.expiresAt).toLocaleDateString()}</TableCell>
                  <TableCell>pending</TableCell>
                  <TableCell>
                    {/* biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA */}
                    <RoleGate role="member" tooltip="Viewers cannot revoke invites">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => revokeInvite.mutate({ inviteId: inv.id })}
                      >
                        Revoke
                      </Button>
                    </RoleGate>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Leave org</h2>
        {myRole === 'owner' ? (
          <DisabledWithTooltip reason="Transfer ownership before leaving (not yet supported — contact support).">
            <Button variant="destructive" disabled>
              Leave org
            </Button>
          </DisabledWithTooltip>
        ) : (
          <Button variant="destructive" onClick={leaveOrg}>
            Leave org
          </Button>
        )}
      </section>
    </div>
  );
}
