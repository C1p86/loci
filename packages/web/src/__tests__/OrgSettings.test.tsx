import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../stores/authStore.js';
import { useAuthStore } from '../stores/authStore.js';

// ---------------------------------------------------------------------------
// Mock auth store
// ---------------------------------------------------------------------------
vi.mock('../stores/authStore.js', () => ({
  useAuthStore: vi.fn(),
}));

type SelectorFn = (state: AuthState) => unknown;

function mockAuthAs(role: 'owner' | 'member' | 'viewer', userId = 'user-1') {
  vi.mocked(useAuthStore).mockImplementation((selector: SelectorFn) => {
    const state = {
      user: { id: userId, email: 'me@example.com' },
      org: { id: 'org-1', role, name: 'Test Org', slug: 'test-org' },
    } as unknown as AuthState;
    return selector(state);
  });
}

// ---------------------------------------------------------------------------
// Mock hooks
// ---------------------------------------------------------------------------
const mockMutate = vi.fn();

vi.mock('../hooks/useOrg.js', () => ({
  useMembers: vi.fn(),
  useChangeMemberRole: vi.fn(),
  useRemoveMember: vi.fn(),
}));

vi.mock('../hooks/useInvites.js', () => ({
  useInvites: vi.fn(),
  useCreateInvite: vi.fn(),
  useRevokeInvite: vi.fn(),
}));

vi.mock('../hooks/useUsage.js', () => ({
  useUsage: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module references (populated in beforeAll to avoid cold-start timeout)
// ---------------------------------------------------------------------------
// biome-ignore lint/suspicious/noExplicitAny: test module refs
let useMembersMock: any;
// biome-ignore lint/suspicious/noExplicitAny: test module refs
let useChangeMemberRoleMock: any;
// biome-ignore lint/suspicious/noExplicitAny: test module refs
let useRemoveMemberMock: any;
// biome-ignore lint/suspicious/noExplicitAny: test module refs
let useInvitesMock: any;
// biome-ignore lint/suspicious/noExplicitAny: test module refs
let useCreateInviteMock: any;
// biome-ignore lint/suspicious/noExplicitAny: test module refs
let useRevokeInviteMock: any;
// biome-ignore lint/suspicious/noExplicitAny: test module refs
let useUsageMock: any;
// biome-ignore lint/suspicious/noExplicitAny: test module refs
let OrgSettingsComponent: any;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrgSettings', () => {
  beforeAll(async () => {
    const orgHooks = await import('../hooks/useOrg.js');
    const inviteHooks = await import('../hooks/useInvites.js');
    const usageHooks = await import('../hooks/useUsage.js');
    const route = await import('../routes/settings/OrgSettings.js');

    useMembersMock = vi.mocked(orgHooks.useMembers);
    useChangeMemberRoleMock = vi.mocked(orgHooks.useChangeMemberRole);
    useRemoveMemberMock = vi.mocked(orgHooks.useRemoveMember);
    useInvitesMock = vi.mocked(inviteHooks.useInvites);
    useCreateInviteMock = vi.mocked(inviteHooks.useCreateInvite);
    useRevokeInviteMock = vi.mocked(inviteHooks.useRevokeInvite);
    useUsageMock = vi.mocked(usageHooks.useUsage);
    OrgSettingsComponent = route.OrgSettings;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthAs('owner');

    useMembersMock.mockReturnValue({ data: [] });
    useChangeMemberRoleMock.mockReturnValue({ mutate: mockMutate, isPending: false });
    useRemoveMemberMock.mockReturnValue({ mutate: mockMutate, isPending: false });
    useInvitesMock.mockReturnValue({ data: [] });
    useCreateInviteMock.mockReturnValue({ mutate: mockMutate, isPending: false, error: null });
    useRevokeInviteMock.mockReturnValue({ mutate: mockMutate, isPending: false });
    useUsageMock.mockReturnValue({ data: undefined });
  });

  function renderOrgSettings() {
    return render(
      <MemoryRouter>
        <OrgSettingsComponent />
      </MemoryRouter>,
    );
  }

  it('1. renders page heading "Org settings"', () => {
    renderOrgSettings();
    expect(screen.getByText('Org settings')).toBeInTheDocument();
  });

  it('2. renders Members section heading', () => {
    renderOrgSettings();
    expect(screen.getByText('Members')).toBeInTheDocument();
  });

  it('3. renders member rows with email and role', () => {
    useMembersMock.mockReturnValue({
      data: [
        {
          id: 'mem-1',
          userId: 'user-2',
          email: 'alice@example.com',
          role: 'member',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    });

    renderOrgSettings();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('4. Owner can see role change dropdown for non-owner members', () => {
    useMembersMock.mockReturnValue({
      data: [
        {
          id: 'mem-1',
          userId: 'user-2',
          email: 'alice@example.com',
          role: 'member',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    });

    renderOrgSettings();
    const selects = screen.getAllByRole('combobox');
    const roleSelect = selects.find(
      (s) => s.tagName === 'SELECT' && (s as HTMLSelectElement).value === 'member',
    );
    expect(roleSelect).toBeInTheDocument();
    // biome-ignore lint/style/noNonNullAssertion: roleSelect asserted defined on previous line
    const parent = roleSelect!.closest('span.pointer-events-none');
    expect(parent).toBeNull();
  });

  it('5. Viewer sees role change dropdown disabled (RoleGate wrapped)', () => {
    mockAuthAs('viewer');
    useMembersMock.mockReturnValue({
      data: [
        {
          id: 'mem-1',
          userId: 'user-2',
          email: 'alice@example.com',
          role: 'member',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    });

    renderOrgSettings();
    const disabledWrapper = document.querySelector('.opacity-60');
    expect(disabledWrapper).not.toBeNull();
  });

  it('6. Send invite button disabled for Viewer', () => {
    mockAuthAs('viewer');
    renderOrgSettings();
    const inviteBtn = screen.getByRole('button', { name: /send invite/i });
    const wrapper = inviteBtn.closest('.pointer-events-none');
    expect(wrapper).not.toBeNull();
  });

  it('7. Owner can submit invite form', async () => {
    const user = userEvent.setup();
    renderOrgSettings();

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'newuser@example.com');
    const btn = screen.getByRole('button', { name: /send invite/i });
    await user.click(btn);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalled();
    });
  });

  it('8. Pending invites show revoke button', () => {
    useInvitesMock.mockReturnValue({
      data: [
        {
          id: 'inv-1',
          email: 'pending@example.com',
          role: 'member',
          createdAt: '2026-04-01T00:00:00Z',
          expiresAt: '2026-05-01T00:00:00Z',
          acceptedAt: null,
          revokedAt: null,
        },
      ],
    });

    renderOrgSettings();
    expect(screen.getByText('pending@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revoke/i })).toBeInTheDocument();
  });

  it('9. UsageWidget renders when usage data available', () => {
    useUsageMock.mockReturnValue({
      data: {
        agents: { current: 3, max: 5 },
        concurrent: { current: 1, max: 5 },
        retentionDays: 30,
      },
    });

    renderOrgSettings();
    expect(screen.getByText('Usage')).toBeInTheDocument();
    expect(screen.getByText('3/5')).toBeInTheDocument();
    expect(screen.getByText('30 days')).toBeInTheDocument();
  });

  it('10. Leave org button disabled for Owner with tooltip context', () => {
    mockAuthAs('owner');
    renderOrgSettings();
    const leaveBtn = screen.getByRole('button', { name: /leave org/i });
    expect(leaveBtn).toBeDisabled();
  });

  it('11. Leave org button enabled for Member (non-owner)', () => {
    mockAuthAs('member');
    renderOrgSettings();
    const leaveBtn = screen.getByRole('button', { name: /leave org/i });
    expect(leaveBtn).not.toBeDisabled();
  });

  it('12. Accepted/revoked invites do not appear in pending list', () => {
    useInvitesMock.mockReturnValue({
      data: [
        {
          id: 'inv-1',
          email: 'accepted@example.com',
          role: 'member',
          createdAt: '2026-04-01T00:00:00Z',
          expiresAt: '2026-05-01T00:00:00Z',
          acceptedAt: '2026-04-05T00:00:00Z',
          revokedAt: null,
        },
        {
          id: 'inv-2',
          email: 'pending@example.com',
          role: 'viewer',
          createdAt: '2026-04-10T00:00:00Z',
          expiresAt: '2026-05-10T00:00:00Z',
          acceptedAt: null,
          revokedAt: null,
        },
      ],
    });

    renderOrgSettings();
    expect(screen.queryByText('accepted@example.com')).toBeNull();
    expect(screen.getByText('pending@example.com')).toBeInTheDocument();
  });
});
