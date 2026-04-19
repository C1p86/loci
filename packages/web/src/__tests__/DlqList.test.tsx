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
// Mock hooks
// ---------------------------------------------------------------------------
const mockRetryMutate = vi.fn();

vi.mock('../hooks/useDlq.js', () => ({
  useDlq: vi.fn(),
  useDlqRetry: vi.fn(),
}));

const sampleEntries = [
  {
    id: 'dlq-entry-00000001',
    pluginName: 'github',
    deliveryId: 'delivery-abc',
    failureReason: 'signature_invalid',
    scrubbedBody: { event: 'push', ref: 'refs/heads/main' },
    scrubbedHeaders: { 'x-github-event': 'push' },
    httpStatus: 400,
    receivedAt: '2026-04-18T10:00:00Z',
    retriedAt: null,
    retryResult: null,
  },
  {
    id: 'dlq-entry-00000002',
    pluginName: 'perforce',
    deliveryId: null,
    failureReason: 'parse_failed',
    scrubbedBody: { raw: '[scrubbed]' },
    scrubbedHeaders: {},
    httpStatus: null,
    receivedAt: '2026-04-18T11:00:00Z',
    retriedAt: '2026-04-18T11:05:00Z',
    retryResult: 'failed_same_reason',
  },
];

// ---------------------------------------------------------------------------
// Module references (populated in beforeAll to avoid cold-start timeout)
// ---------------------------------------------------------------------------
// biome-ignore lint/suspicious/noExplicitAny: test module refs
let useDlqMock: any;
// biome-ignore lint/suspicious/noExplicitAny: test module refs
let useDlqRetryMock: any;
// biome-ignore lint/suspicious/noExplicitAny: test module refs
let DlqListComponent: any;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DlqList', () => {
  beforeAll(async () => {
    // Pre-warm module registry to avoid first-test cold-start timeout
    const hooks = await import('../hooks/useDlq.js');
    const route = await import('../routes/dlq/DlqList.js');
    useDlqMock = vi.mocked(hooks.useDlq);
    useDlqRetryMock = vi.mocked(hooks.useDlqRetry);
    DlqListComponent = route.DlqList;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthAs('member');

    useDlqMock.mockReturnValue({
      data: { ok: true, entries: sampleEntries, nextCursor: undefined },
      isLoading: false,
      error: null,
    });

    useDlqRetryMock.mockReturnValue({
      mutate: mockRetryMutate,
      isPending: false,
    });
  });

  function renderDlqList() {
    return render(
      <MemoryRouter>
        <DlqListComponent />
      </MemoryRouter>,
    );
  }

  it('1. renders page heading "Dead Letter Queue"', () => {
    renderDlqList();
    expect(screen.getByText('Dead Letter Queue')).toBeInTheDocument();
  });

  it('2. renders both DLQ entry failure reasons', () => {
    renderDlqList();
    expect(screen.getAllByText('signature_invalid').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('parse_failed').length).toBeGreaterThanOrEqual(1);
  });

  it('3. clicking a row opens dialog with scrubbed headers as pre/JSON', async () => {
    const user = userEvent.setup();
    renderDlqList();
    const rows = screen.getAllByRole('row');
    await user.click(rows[1]);

    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      const preElements = document.querySelectorAll('pre');
      const hasHeaderJson = Array.from(preElements).some((el) =>
        el.textContent?.includes('x-github-event'),
      );
      expect(hasHeaderJson).toBe(true);
    });
  });

  it('4. scrubbed body rendered as <pre> text (no innerHTML injection)', async () => {
    useDlqMock.mockReturnValue({
      data: {
        ok: true,
        entries: [
          {
            ...sampleEntries[0],
            scrubbedBody: { malicious: '<script>alert(1)</script>' },
          },
        ],
        nextCursor: undefined,
      },
      isLoading: false,
      error: null,
    });

    const user = userEvent.setup();
    renderDlqList();
    const rows = screen.getAllByRole('row');
    await user.click(rows[1]);

    await waitFor(() => {
      const scripts = document.querySelectorAll('script');
      const injectedScript = Array.from(scripts).find((s) => s.textContent?.includes('alert(1)'));
      expect(injectedScript).toBeUndefined();
      const preElements = document.querySelectorAll('pre');
      const hasLiteralText = Array.from(preElements).some((el) =>
        el.textContent?.includes('<script>alert(1)</script>'),
      );
      expect(hasLiteralText).toBe(true);
    });
  });

  it('5. Viewer sees Retry button wrapped disabled', async () => {
    mockAuthAs('viewer');
    const user = userEvent.setup();
    renderDlqList();
    const rows = screen.getAllByRole('row');
    await user.click(rows[1]);

    await waitFor(() => {
      const retryBtn = screen.getByRole('button', { name: /retry/i });
      expect(retryBtn.closest('.pointer-events-none')).not.toBeNull();
    });
  });

  it('6. Member can click Retry; mutation called with correct dlqId', async () => {
    const user = userEvent.setup();
    renderDlqList();
    const rows = screen.getAllByRole('row');
    await user.click(rows[1]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    await user.click(retryBtn);

    await waitFor(() => {
      expect(mockRetryMutate).toHaveBeenCalledWith(
        { dlqId: 'dlq-entry-00000001' },
        expect.any(Object),
      );
    });
  });

  it('7. retry result badge renders for entry with retryResult', () => {
    renderDlqList();
    expect(screen.getAllByText('failed_same_reason').length).toBeGreaterThanOrEqual(1);
  });

  it('8. shows loading state', () => {
    useDlqMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    renderDlqList();
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });
});
