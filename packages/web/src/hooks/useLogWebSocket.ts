import { useEffect, useRef, useState } from 'react';
import type { LogChunk, RunState } from '../lib/types.js';
import { useWsStore } from '../stores/wsStore.js';

const MAX_CHUNKS = 50_000;
const BACKOFFS = [1000, 2000, 4000, 8000, 16000, 30000];

interface Args {
  orgId: string | undefined;
  runId: string | undefined;
  enabled: boolean;
}

export function useLogWebSocket({ orgId, runId, enabled }: Args) {
  const [chunks, setChunks] = useState<LogChunk[]>([]);
  const [endState, setEndState] = useState<RunState | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const setStatus = useWsStore((s) => s.setStatus);

  const lastSeenSeqRef = useRef(-1);
  const backoffIdxRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled || !orgId || !runId) {
      setStatus('disconnected');
      return;
    }

    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws/orgs/${orgId}/runs/${runId}/logs`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        if (!mountedRef.current) return;
        backoffIdxRef.current = 0;
        setStatus('connected');
        const sinceSeq = lastSeenSeqRef.current >= 0 ? lastSeenSeqRef.current + 1 : 0;
        ws.send(JSON.stringify({ type: 'subscribe', sinceSeq }));
      });

      ws.addEventListener('message', (ev: MessageEvent) => {
        if (!mountedRef.current) return;
        let msg: unknown;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (typeof msg !== 'object' || msg === null || !('type' in msg)) return;
        const m = msg as { type: string; [k: string]: unknown };

        if (m.type === 'chunk') {
          const chunk = m as unknown as LogChunk;
          lastSeenSeqRef.current = Math.max(lastSeenSeqRef.current, chunk.seq);
          setChunks((prev) => {
            const next =
              prev.length >= MAX_CHUNKS ? prev.slice(prev.length - MAX_CHUNKS + 1) : prev;
            return [...next, chunk];
          });
        } else if (m.type === 'gap') {
          const markerSeq = Number(m.toSeq);
          lastSeenSeqRef.current = Math.max(lastSeenSeqRef.current, markerSeq);
          setChunks((prev) => [
            ...prev,
            {
              seq: markerSeq,
              stream: 'stderr' as const,
              ts: new Date().toISOString(),
              data: `[gap: ${m.fromSeq}–${m.toSeq} missed due to backpressure]`,
            },
          ]);
        } else if (m.type === 'end') {
          setEndState(m.state as RunState);
          setExitCode(typeof m.exitCode === 'number' ? m.exitCode : null);
        }
        // catchup_complete — no-op
      });

      ws.addEventListener('close', (ev: CloseEvent) => {
        if (!mountedRef.current) return;
        wsRef.current = null;
        // Terminal close codes: do not reconnect
        if (ev.code === 1000 || ev.code === 4001 || ev.code === 4004 || ev.code === 4008) {
          setStatus('disconnected');
          return;
        }
        setStatus('reconnecting');
        const delay = BACKOFFS[Math.min(backoffIdxRef.current, BACKOFFS.length - 1)] ?? 30000;
        backoffIdxRef.current += 1;
        reconnectTimerRef.current = window.setTimeout(() => {
          if (mountedRef.current) connect();
        }, delay);
      });

      ws.addEventListener('error', () => {
        // close event will fire next — handled there
      });
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current != null) window.clearTimeout(reconnectTimerRef.current);
      // readyState: 0=CONNECTING, 1=OPEN — both allow close(); 2=CLOSING, 3=CLOSED do not
      if (wsRef.current && wsRef.current.readyState < 2) {
        wsRef.current.close(1000, 'unmount');
      }
      setStatus('disconnected');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, runId, enabled, setStatus]);

  return { chunks, endState, exitCode };
}
