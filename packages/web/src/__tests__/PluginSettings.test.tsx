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

function mockAuthAs(role: 'owner' | 'member' | 'viewer') {
  vi.mocked(useAuthStore).mockImplementation((selector: SelectorFn) => {
    const state = {
      user: { id: 'user-1', email: 'me@example.com' },
      org: { id: 'org-1', role, name: 'Test Org', slug: 'test-org' },
    } as unknown as AuthState;
    return selector(state);
  });
}

// ---------------------------------------------------------------------------
// Mock hooks — declared before vi.mock calls so hoisting works
// ---------------------------------------------------------------------------
const mockMutate = vi.fn();
const mockReset = vi.fn();

vi.mock('../hooks/useWebhookTokens.js', () => ({
  useWebhookTokens: vi.fn(),
  useCreateWebhookToken: vi.fn(),
  useRevokeWebhookToken: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module references (populated in beforeAll)
// ---------------------------------------------------------------------------
// biome-ignore lint/suspicious/noExplicitAny: test module refs
let useWebhookTokensMock: any;
// biome-ignore lint/suspicious/noExplicitAny: test module refs
let useCreateWebhookTokenMock: any;
// biome-ignore lint/suspicious/noExplicitAny: test module refs
let useRevokeWebhookTokenMock: any;
// biome-ignore lint/suspicious/noExplicitAny: test module refs
let PluginSettingsComponent: any;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginSettings', () => {
  beforeAll(async () => {
    // Pre-warm module registry to avoid first-test cold-start timeout
    const hooks = await import('../hooks/useWebhookTokens.js');
    const route = await import('../routes/settings/PluginSettings.js');
    useWebhookTokensMock = vi.mocked(hooks.useWebhookTokens);
    useCreateWebhookTokenMock = vi.mocked(hooks.useCreateWebhookToken);
    useRevokeWebhookTokenMock = vi.mocked(hooks.useRevokeWebhookToken);
    PluginSettingsComponent = route.PluginSettings;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthAs('member');

    useWebhookTokensMock.mockReturnValue({
      data: [
        {
          id: 'tok-1',
          pluginName: 'github',
          hasPluginSecret: true,
          createdAt: '2026-04-01T00:00:00Z',
          revokedAt: null,
        },
        {
          id: 'tok-2',
          pluginName: 'perforce',
          hasPluginSecret: false,
          createdAt: '2026-04-02T00:00:00Z',
          revokedAt: null,
        },
      ],
    });

    useCreateWebhookTokenMock.mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      data: undefined,
      error: null,
      reset: mockReset,
    });

    useRevokeWebhookTokenMock.mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    });
  });

  function renderPluginSettings() {
    return render(
      <MemoryRouter>
        <PluginSettingsComponent />
      </MemoryRouter>,
    );
  }

  it('1. renders Plugin settings heading', () => {
    renderPluginSettings();
    expect(screen.getByText('Plugin settings')).toBeInTheDocument();
  });

  it('2. renders GitHub section heading', () => {
    renderPluginSettings();
    expect(screen.getByRole('heading', { name: /github/i, level: 2 })).toBeInTheDocument();
  });

  it('3. renders Perforce section heading', () => {
    renderPluginSettings();
    expect(screen.getByRole('heading', { name: /perforce/i, level: 2 })).toBeInTheDocument();
  });

  it('4. renders existing github token row with revoke button', () => {
    renderPluginSettings();
    const revokeButtons = screen.getAllByRole('button', { name: /revoke/i });
    expect(revokeButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('5. Viewer sees "New token" button wrapped disabled', () => {
    mockAuthAs('viewer');
    renderPluginSettings();
    const newTokenBtns = screen.getAllByRole('button', { name: /new token/i });
    const anyDisabledWrapped = newTokenBtns.some(
      (btn) => btn.closest('.pointer-events-none') !== null,
    );
    expect(anyDisabledWrapped).toBe(true);
  });

  it('6. Member sees "New token" button not disabled-wrapped', () => {
    renderPluginSettings();
    const newTokenBtns = screen.getAllByRole('button', { name: /new token/i });
    const anyDisabledWrapped = newTokenBtns.some(
      (btn) => btn.closest('.pointer-events-none') !== null,
    );
    expect(anyDisabledWrapped).toBe(false);
  });

  it('7. Opening github dialog shows password input for secret', async () => {
    const user = userEvent.setup();
    renderPluginSettings();
    const newTokenBtns = screen.getAllByRole('button', { name: /new token/i });
    await user.click(newTokenBtns[0]);

    await waitFor(() => {
      const passwordInputs = document.querySelectorAll('input[type="password"]');
      expect(passwordInputs.length).toBeGreaterThan(0);
    });
  });

  it('8. GitHub secret input has autocomplete=off', async () => {
    const user = userEvent.setup();
    renderPluginSettings();
    const newTokenBtns = screen.getAllByRole('button', { name: /new token/i });
    await user.click(newTokenBtns[0]);

    await waitFor(() => {
      const passwordInput = document.querySelector('input[type="password"]');
      expect(passwordInput).not.toBeNull();
      // biome-ignore lint/style/noNonNullAssertion: passwordInput asserted non-null on previous line
      expect(passwordInput!.getAttribute('autocomplete')).toBe('off');
    });
  });

  it('9. After token creation, plaintext token shown in DOM', async () => {
    useCreateWebhookTokenMock.mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      data: {
        ok: true,
        tokenId: 'tok-new',
        plaintextToken: 'PLAINTEXT-SUPER-SECRET-TOKEN',
        endpointUrl: 'https://xci.example.com/hooks/github/org-1',
      },
      error: null,
      reset: mockReset,
    });

    const user = userEvent.setup();
    renderPluginSettings();
    const newTokenBtns = screen.getAllByRole('button', { name: /new token/i });
    await user.click(newTokenBtns[0]);

    await waitFor(() => {
      expect(screen.getByText('PLAINTEXT-SUPER-SECRET-TOKEN')).toBeInTheDocument();
    });
  });

  it('10. Perforce section shows xci agent-emit-perforce-trigger command after creation', async () => {
    useCreateWebhookTokenMock.mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      data: {
        ok: true,
        tokenId: 'tok-pf',
        plaintextToken: 'PERFORCE-TOKEN-XYZ',
        endpointUrl: 'https://xci.example.com/hooks/perforce/org-1',
      },
      error: null,
      reset: mockReset,
    });

    const user = userEvent.setup();
    renderPluginSettings();
    const newTokenBtns = screen.getAllByRole('button', { name: /new token/i });
    await user.click(newTokenBtns[1]);

    await waitFor(() => {
      expect(
        screen.getByText(/xci agent-emit-perforce-trigger.*PERFORCE-TOKEN-XYZ/),
      ).toBeInTheDocument();
    });
  });

  it('11. Plaintext token NOT in localStorage after dialog close', async () => {
    useCreateWebhookTokenMock.mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      data: {
        ok: true,
        tokenId: 'tok-persist-check',
        plaintextToken: 'SHOULD-NOT-PERSIST-TOKEN',
        endpointUrl: 'https://xci.example.com/hooks/github/org-1',
      },
      error: null,
      reset: mockReset,
    });

    const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem');
    const user = userEvent.setup();
    const { unmount } = renderPluginSettings();

    const newTokenBtns = screen.getAllByRole('button', { name: /new token/i });
    await user.click(newTokenBtns[0]);

    await waitFor(() => {
      expect(screen.getByText('SHOULD-NOT-PERSIST-TOKEN')).toBeInTheDocument();
    });

    unmount();

    const tokenCalls = localStorageSpy.mock.calls.filter(([, v]) =>
      String(v).includes('SHOULD-NOT-PERSIST-TOKEN'),
    );
    expect(tokenCalls).toHaveLength(0);
  });
});
