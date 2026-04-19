import { act, render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogChunk, RunState } from '../lib/types.js';

// ---------------------------------------------------------------------------
// Mock useLogWebSocket
// ---------------------------------------------------------------------------
const mockChunks: LogChunk[] = [];
let mockEndState: RunState | null = null;
let mockExitCode: number | null = null;

vi.mock('../hooks/useLogWebSocket.js', () => ({
  useLogWebSocket: () => ({
    chunks: mockChunks,
    endState: mockEndState,
    exitCode: mockExitCode,
  }),
}));

// ---------------------------------------------------------------------------
// Mock useAuthStore
// ---------------------------------------------------------------------------
vi.mock('../stores/authStore.js', () => ({
  useAuthStore: vi.fn((selector: (s: { org: { id: string } }) => unknown) =>
    selector({ org: { id: 'org-test' } }),
  ),
}));

// ---------------------------------------------------------------------------
// Mock useQueryClient (TanStack Query)
// ---------------------------------------------------------------------------
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Mock uiStore
// ---------------------------------------------------------------------------
let tsVisible = true;
let autoscrollPaused = false;

vi.mock('../stores/uiStore.js', () => ({
  useUiStore: vi.fn((selector: (s: {
    logTimestampVisible: boolean;
    logAutoscrollPaused: boolean;
    setLogTimestampVisible: (v: boolean) => void;
    setLogAutoscrollPaused: (v: boolean) => void;
  }) => unknown) =>
    selector({
      logTimestampVisible: tsVisible,
      logAutoscrollPaused: autoscrollPaused,
      setLogTimestampVisible: (v: boolean) => { tsVisible = v; },
      setLogAutoscrollPaused: (v: boolean) => { autoscrollPaused = v; },
    }),
  ),
}));

// ---------------------------------------------------------------------------
// Mock IntersectionObserver
// ---------------------------------------------------------------------------
let ioCallback: IntersectionObserverCallback | null = null;

const mockObserve = vi.fn();
const mockDisconnect = vi.fn();

vi.stubGlobal('IntersectionObserver', class {
  constructor(cb: IntersectionObserverCallback) {
    ioCallback = cb;
  }
  observe = mockObserve;
  disconnect = mockDisconnect;
});

// Trigger intersection change helper
function triggerIntersection(isIntersecting: boolean) {
  if (ioCallback) {
    ioCallback(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LogViewer', () => {
  beforeEach(async () => {
    // Reset mutable mock state
    mockChunks.splice(0, mockChunks.length);
    mockEndState = null;
    mockExitCode = null;
    tsVisible = true;
    autoscrollPaused = false;
    ioCallback = null;
    mockObserve.mockClear();
    mockDisconnect.mockClear();
  });

  async function renderLogViewer(runId = 'run-1', initialState: RunState = 'running') {
    const { LogViewer } = await import('../components/LogViewer.js');
    return render(<LogViewer runId={runId} initialState={initialState} />);
  }

  it('1. renders without crashing', async () => {
    const { container } = await renderLogViewer();
    expect(container).toBeInTheDocument();
  });

  it('2. XSS: chunk data with <script> renders as literal text, not HTML', async () => {
    mockChunks.push({
      seq: 1,
      stream: 'stdout',
      ts: '2026-04-18T00:00:00Z',
      data: '<script>alert(1)</script>',
    });
    const { container } = await renderLogViewer();

    // The literal text should be present
    expect(screen.getByRole('log').textContent).toContain('<script>alert(1)</script>');
    // But NO actual <script> element should exist in DOM
    expect(container.querySelector('script')).toBeNull();
  });

  it('3. timestamps visible by default; shows [ts] prefix', async () => {
    tsVisible = true;
    mockChunks.push({
      seq: 1,
      stream: 'stdout',
      ts: '2026-04-18T12:00:00Z',
      data: 'hello\n',
    });
    await renderLogViewer();
    expect(screen.getByRole('log').textContent).toContain('2026-04-18T12:00:00Z');
  });

  it('4. timestamps hidden when logTimestampVisible=false', async () => {
    tsVisible = false;
    mockChunks.push({
      seq: 1,
      stream: 'stdout',
      ts: '2026-04-18T12:00:00Z',
      data: 'hello\n',
    });
    await renderLogViewer();
    expect(screen.getByRole('log').textContent).not.toContain('2026-04-18T12:00:00Z');
  });

  it('5. autoscroll paused banner appears when autoscrollPaused=true', async () => {
    autoscrollPaused = true;
    await renderLogViewer();
    expect(screen.getByText(/Autoscroll paused/i)).toBeInTheDocument();
  });

  it('6. autoscroll paused banner NOT shown when autoscrollPaused=false', async () => {
    autoscrollPaused = false;
    await renderLogViewer();
    expect(screen.queryByText(/Autoscroll paused/i)).not.toBeInTheDocument();
  });

  it('7. clicking resume banner resets autoscroll (calls setLogAutoscrollPaused(false))', async () => {
    autoscrollPaused = true;
    const setAutoscrollPaused = vi.fn();
    const { useUiStore } = await import('../stores/uiStore.js');
    vi.mocked(useUiStore).mockImplementation((selector) =>
      selector({
        logTimestampVisible: true,
        logAutoscrollPaused: true,
        setLogTimestampVisible: vi.fn(),
        setLogAutoscrollPaused: setAutoscrollPaused,
      }),
    );

    const { LogViewer } = await import('../components/LogViewer.js');
    render(<LogViewer runId="run-1" initialState="running" />);

    const banner = screen.getByText(/Autoscroll paused/i);
    fireEvent.click(banner);
    expect(setAutoscrollPaused).toHaveBeenCalledWith(false);
  });

  it('8. download button is an <a download> with correct href', async () => {
    const { container } = await renderLogViewer('run-xyz');
    const link = container.querySelector('a[download]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/api/orgs/org-test/runs/run-xyz/logs.log');
  });

  it('9. stderr chunks rendered with red color class', async () => {
    mockChunks.push({
      seq: 1,
      stream: 'stderr',
      ts: '2026-04-18T00:00:00Z',
      data: 'error line\n',
    });
    const { container } = await renderLogViewer();
    const stderrSpan = container.querySelector('.text-red-300');
    expect(stderrSpan).not.toBeNull();
  });

  it('10. end-state banner appears when endState is set', async () => {
    mockEndState = 'succeeded';
    mockExitCode = 0;
    await renderLogViewer('run-1', 'succeeded');
    expect(screen.getByText(/Run finished/i)).toBeInTheDocument();
    expect(screen.getByText(/succeeded/i)).toBeInTheDocument();
  });
});
