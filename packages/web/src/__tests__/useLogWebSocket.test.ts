import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLogWebSocket } from '../hooks/useLogWebSocket.js';
import { useWsStore } from '../stores/wsStore.js';

// ---------------------------------------------------------------------------
// Minimal WebSocket mock
// ---------------------------------------------------------------------------

type EventHandler = (ev: unknown) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readyState = 0; // CONNECTING
  url: string;

  private handlers: Record<string, EventHandler[]> = {
    open: [],
    message: [],
    close: [],
    error: [],
  };

  send = vi.fn();
  close = vi.fn((code?: number, _reason?: string) => {
    this.readyState = 3;
    this._trigger('close', { code: code ?? 1000, wasClean: code === 1000 });
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(event: string, handler: EventHandler) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  }

  _trigger(event: string, data?: unknown) {
    for (const h of this.handlers[event] ?? []) h(data);
  }

  _open() {
    this.readyState = 1; // OPEN
    this._trigger('open', {});
  }

  _message(data: unknown) {
    this._trigger('message', { data: JSON.stringify(data) });
  }

  _close(code = 1006) {
    this.readyState = 3; // CLOSED
    this._trigger('close', { code, wasClean: code === 1000 });
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.useFakeTimers();
  // Reset wsStore state
  useWsStore.setState({ status: 'disconnected' });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function getWs() {
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  if (!ws) throw new Error('No WebSocket instance found');
  return ws;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLogWebSocket', () => {
  const defaultArgs = { orgId: 'org-1', runId: 'run-abc', enabled: true };

  it('1. sends subscribe frame with sinceSeq=0 on open', async () => {
    const { unmount } = renderHook(() => useLogWebSocket(defaultArgs));

    await act(async () => {
      getWs()._open();
    });

    expect(getWs().send).toHaveBeenCalledWith(JSON.stringify({ type: 'subscribe', sinceSeq: 0 }));
    unmount();
  });

  it('2. chunk frames appended in order by seq', async () => {
    const { result, unmount } = renderHook(() => useLogWebSocket(defaultArgs));

    await act(async () => {
      getWs()._open();
    });
    await act(async () => {
      getWs()._message({
        type: 'chunk',
        seq: 1,
        stream: 'stdout',
        ts: '2026-01-01T00:00:00Z',
        data: 'line 1\n',
      });
      getWs()._message({
        type: 'chunk',
        seq: 2,
        stream: 'stderr',
        ts: '2026-01-01T00:00:01Z',
        data: 'err line\n',
      });
    });

    expect(result.current.chunks).toHaveLength(2);
    expect(result.current.chunks[0]!.seq).toBe(1);
    expect(result.current.chunks[0]!.stream).toBe('stdout');
    expect(result.current.chunks[1]!.seq).toBe(2);
    expect(result.current.chunks[1]!.stream).toBe('stderr');
    unmount();
  });

  it('3. gap frame synthesizes a marker chunk', async () => {
    const { result, unmount } = renderHook(() => useLogWebSocket(defaultArgs));

    await act(async () => {
      getWs()._open();
    });
    await act(async () => {
      getWs()._message({ type: 'gap', fromSeq: 5, toSeq: 10 });
    });

    expect(result.current.chunks).toHaveLength(1);
    expect(result.current.chunks[0]!.data).toContain('gap');
    unmount();
  });

  it('4. end frame sets endState and exitCode', async () => {
    const { result, unmount } = renderHook(() => useLogWebSocket(defaultArgs));

    await act(async () => {
      getWs()._open();
    });
    await act(async () => {
      getWs()._message({ type: 'end', state: 'succeeded', exitCode: 0 });
    });

    expect(result.current.endState).toBe('succeeded');
    expect(result.current.exitCode).toBe(0);
    unmount();
  });

  it('5. reconnects after abnormal close (1006) using backoff, sends sinceSeq = lastSeen+1', async () => {
    const { unmount } = renderHook(() => useLogWebSocket(defaultArgs));

    await act(async () => {
      getWs()._open();
    });
    await act(async () => {
      getWs()._message({
        type: 'chunk',
        seq: 3,
        stream: 'stdout',
        ts: '2026-01-01T00:00:00Z',
        data: 'x\n',
      });
    });

    const firstWs = getWs();

    await act(async () => {
      firstWs._close(1006); // abnormal
    });

    // wsStore status should be reconnecting
    expect(useWsStore.getState().status).toBe('reconnecting');

    // Advance past first backoff delay (1000ms) — triggers reconnect callback
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    // New WS should be created (synchronous timer callback creates it)
    expect(MockWebSocket.instances.length).toBeGreaterThan(1);

    const secondWs = getWs();
    await act(async () => {
      secondWs._open();
    });

    // sinceSeq should be lastSeenSeq + 1 = 3 + 1 = 4
    expect(secondWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'subscribe', sinceSeq: 4 }));

    unmount();
  });

  it('6. terminal close code 1000 does NOT trigger reconnect', async () => {
    const { unmount } = renderHook(() => useLogWebSocket(defaultArgs));

    await act(async () => {
      getWs()._open();
    });
    await act(async () => {
      getWs()._close(1000);
    });

    // Wait well beyond backoff period
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // Still only one WS instance
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(useWsStore.getState().status).toBe('disconnected');
    unmount();
  });

  it('7. unmount closes WS cleanly with code 1000', async () => {
    const { unmount } = renderHook(() => useLogWebSocket(defaultArgs));

    await act(async () => {
      getWs()._open();
    });

    const ws = getWs();
    unmount();

    expect(ws.close).toHaveBeenCalledWith(1000, 'unmount');
  });

  it('8. wsStore status transitions: disconnected → connected on open', async () => {
    expect(useWsStore.getState().status).toBe('disconnected');

    const { unmount } = renderHook(() => useLogWebSocket(defaultArgs));

    await act(async () => {
      getWs()._open();
    });

    expect(useWsStore.getState().status).toBe('connected');
    unmount();
  });

  it('9. terminal close code 4004 does NOT trigger reconnect', async () => {
    const { unmount } = renderHook(() => useLogWebSocket(defaultArgs));

    await act(async () => {
      getWs()._open();
    });
    await act(async () => {
      getWs()._close(4004);
    });

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(useWsStore.getState().status).toBe('disconnected');
    unmount();
  });

  it('10. disabled=false → no WS created', async () => {
    const { unmount } = renderHook(() =>
      useLogWebSocket({ orgId: 'org-1', runId: 'run-abc', enabled: false }),
    );

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(MockWebSocket.instances).toHaveLength(0);
    unmount();
  });
});
