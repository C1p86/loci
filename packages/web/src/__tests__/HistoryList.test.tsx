import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunSummary, Task } from '../lib/types.js';

// ---------------------------------------------------------------------------
// Mock useRunHistory — using a stable factory that reads shared state each call
// ---------------------------------------------------------------------------
let mockRuns: RunSummary[] = [];
let mockNextCursor: string | undefined;
let mockIsLoading = false;
let mockError: Error | null = null;

vi.mock('../hooks/useRunHistory.js', () => {
  const fn = vi.fn();
  return { useRunHistory: fn };
});

// ---------------------------------------------------------------------------
// Mock useTasks
// ---------------------------------------------------------------------------
const mockTasks: Task[] = [
  {
    id: 'task-1',
    name: 'Build App',
    description: '',
    slug: 'build-app',
    expose_badge: false,
    labelRequirements: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

vi.mock('../hooks/useTasks.js', () => ({
  useTasks: vi.fn(() => ({ data: mockTasks })),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HistoryList', () => {
  beforeEach(async () => {
    // Reset shared state
    mockRuns = [];
    mockNextCursor = undefined;
    mockIsLoading = false;
    mockError = null;

    // Re-set the useRunHistory mock implementation each test so it reads current state
    const { useRunHistory } = await import('../hooks/useRunHistory.js');
    vi.mocked(useRunHistory).mockImplementation(
      () =>
        ({
          data: { runs: mockRuns, nextCursor: mockNextCursor },
          isLoading: mockIsLoading,
          error: mockError,
        }) as ReturnType<typeof useRunHistory>,
    );
  });

  async function renderHistory() {
    const { HistoryList } = await import('../routes/history/HistoryList.js');
    return render(
      <MemoryRouter>
        <HistoryList />
      </MemoryRouter>,
    );
  }

  it('1. renders page heading', async () => {
    await renderHistory();
    expect(screen.getByText('History')).toBeInTheDocument();
  });

  it('2. renders state filter checkboxes for all run states', async () => {
    await renderHistory();
    const states = [
      'queued',
      'dispatched',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'timed_out',
      'orphaned',
    ];
    for (const s of states) {
      expect(screen.getByLabelText(s, { exact: false })).toBeInTheDocument();
    }
  });

  it('3. renders task dropdown with All tasks + known task', async () => {
    await renderHistory();
    expect(screen.getByDisplayValue('All tasks')).toBeInTheDocument();
    expect(screen.getByText('Build App')).toBeInTheDocument();
  });

  it('4. shows loading state', async () => {
    const { useRunHistory } = await import('../hooks/useRunHistory.js');
    vi.mocked(useRunHistory).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof useRunHistory>);
    await renderHistory();
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('5. shows error message when query fails', async () => {
    const { useRunHistory } = await import('../hooks/useRunHistory.js');
    vi.mocked(useRunHistory).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('fetch failed'),
    } as unknown as ReturnType<typeof useRunHistory>);
    await renderHistory();
    expect(screen.getByText(/fetch failed/i)).toBeInTheDocument();
  });

  it('6. renders run rows with link to /runs/:id', async () => {
    mockRuns = [
      {
        id: 'run-00000001',
        taskId: 'task-1',
        state: 'succeeded',
        exitCode: 0,
        queuedAt: '2026-04-18T10:00:00Z',
        startedAt: '2026-04-18T10:00:01Z',
        finishedAt: '2026-04-18T10:01:00Z',
        triggerSource: 'manual',
      },
    ];

    // Re-apply mock with updated mockRuns
    const { useRunHistory } = await import('../hooks/useRunHistory.js');
    vi.mocked(useRunHistory).mockImplementation(
      () =>
        ({
          data: { runs: mockRuns, nextCursor: undefined },
          isLoading: false,
          error: null,
        }) as ReturnType<typeof useRunHistory>,
    );

    await renderHistory();
    const link = screen.getByRole('link', { name: /00000001/i });
    expect(link).toHaveAttribute('href', '/runs/run-00000001');
  });

  it('7. Next button enabled when nextCursor present', async () => {
    const { useRunHistory } = await import('../hooks/useRunHistory.js');
    vi.mocked(useRunHistory).mockImplementation(
      () =>
        ({
          data: {
            runs: [
              {
                id: 'run-abc123',
                taskId: 'task-1',
                state: 'failed' as const,
                exitCode: 1,
                queuedAt: '2026-04-18T10:00:00Z',
                startedAt: null,
                finishedAt: null,
                triggerSource: 'webhook' as const,
              },
            ],
            nextCursor: 'cursor-xyz',
          },
          isLoading: false,
          error: null,
        }) as ReturnType<typeof useRunHistory>,
    );

    await renderHistory();
    const nextBtn = screen.getByRole('button', { name: /Next/i });
    expect(nextBtn).not.toBeDisabled();
  });

  it('8. Previous button disabled on first page', async () => {
    await renderHistory();
    const prevBtn = screen.getByRole('button', { name: /Previous/i });
    expect(prevBtn).toBeDisabled();
  });

  it('9. state filter checkbox toggles update filters passed to useRunHistory', async () => {
    const { useRunHistory } = await import('../hooks/useRunHistory.js');
    const mockHook = vi.mocked(useRunHistory);
    await renderHistory();

    const succeededCheckbox = screen.getByLabelText('succeeded', { exact: false });
    fireEvent.click(succeededCheckbox);

    // Should have been called with filters including states=['succeeded']
    await waitFor(() => {
      const calls = mockHook.mock.calls;
      const lastCall = calls[calls.length - 1]!;
      expect(lastCall[0].states).toContain('succeeded');
    });
  });

  it('10. date from/to inputs are rendered', async () => {
    await renderHistory();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
  });
});
