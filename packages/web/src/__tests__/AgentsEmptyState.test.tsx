import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../stores/authStore.js';
import { useAuthStore } from '../stores/authStore.js';

// Mock auth store
vi.mock('../stores/authStore.js', () => ({
  useAuthStore: vi.fn(),
}));

type SelectorFn = (state: AuthState) => unknown;

function mockOrgId(id: string) {
  vi.mocked(useAuthStore).mockImplementation((selector: SelectorFn) => {
    const state = { org: { id, role: 'member' } } as unknown as AuthState;
    return selector(state);
  });
}

// Mock useCreateRegistrationToken hook
const mockMutate = vi.fn();
let mockMutationState = {
  mutate: mockMutate,
  isPending: false,
  data: undefined as { ok: true; token: string; expiresAt: string } | undefined,
  error: null as Error | null,
};

vi.mock('../hooks/useRegistrationToken.js', () => ({
  useCreateRegistrationToken: () => mockMutationState,
}));

describe('AgentsEmptyState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrgId('org-1');
    mockMutationState = {
      mutate: mockMutate,
      isPending: false,
      data: undefined,
      error: null,
    };
    // Mock window.location.origin
    Object.defineProperty(window, 'location', {
      value: { origin: 'https://app.example.com' },
      writable: true,
      configurable: true,
    });
  });

  it('renders empty state message', async () => {
    const { AgentsEmptyState } = await import('../routes/agents/AgentsEmptyState.js');
    render(<AgentsEmptyState />);
    expect(screen.getByText(/no agents registered yet/i)).toBeInTheDocument();
  });

  it('renders Generate registration token button', async () => {
    const { AgentsEmptyState } = await import('../routes/agents/AgentsEmptyState.js');
    render(<AgentsEmptyState />);
    expect(screen.getByRole('button', { name: /generate registration token/i })).toBeInTheDocument();
  });

  it('calls mutate when Generate button clicked', async () => {
    const user = userEvent.setup();
    const { AgentsEmptyState } = await import('../routes/agents/AgentsEmptyState.js');
    render(<AgentsEmptyState />);
    const btn = screen.getByRole('button', { name: /generate registration token/i });
    await user.click(btn);
    expect(mockMutate).toHaveBeenCalled();
  });

  it('shows CopyableCommand with xci command once token is returned', async () => {
    mockMutationState = {
      ...mockMutationState,
      data: { ok: true, token: 'SECRET-TOKEN-123', expiresAt: '2026-04-19T00:00:00Z' },
    };
    const { AgentsEmptyState } = await import('../routes/agents/AgentsEmptyState.js');
    render(<AgentsEmptyState />);
    await waitFor(() => {
      expect(
        screen.getByText(/xci --agent https:\/\/app\.example\.com --token SECRET-TOKEN-123/),
      ).toBeInTheDocument();
    });
  });

  it('does NOT write token to localStorage or sessionStorage', async () => {
    mockMutationState = {
      ...mockMutationState,
      data: { ok: true, token: 'SECRET-TOKEN-STORE-CHECK', expiresAt: '2026-04-19T00:00:00Z' },
    };
    const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem');
    const { AgentsEmptyState } = await import('../routes/agents/AgentsEmptyState.js');
    const { unmount } = render(<AgentsEmptyState />);
    unmount();
    // Token must never be written to any storage
    const tokenCalls = localStorageSpy.mock.calls.filter(([, v]) =>
      String(v).includes('SECRET-TOKEN-STORE-CHECK'),
    );
    expect(tokenCalls).toHaveLength(0);
  });

  it('hides Generate button and shows command when token exists', async () => {
    mockMutationState = {
      ...mockMutationState,
      data: { ok: true, token: 'MY-TOKEN', expiresAt: '2026-04-19T00:00:00Z' },
    };
    const { AgentsEmptyState } = await import('../routes/agents/AgentsEmptyState.js');
    render(<AgentsEmptyState />);
    expect(screen.queryByRole('button', { name: /generate registration token/i })).toBeNull();
  });
});
