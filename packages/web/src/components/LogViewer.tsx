import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, Clock, Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLogWebSocket } from '../hooks/useLogWebSocket.js';
import type { RunState } from '../lib/types.js';
import { useAuthStore } from '../stores/authStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { Button } from './ui/button.js';

const TERMINAL_STATES: RunState[] = ['succeeded', 'failed', 'cancelled', 'timed_out', 'orphaned'];

interface LogViewerProps {
  runId: string;
  initialState: RunState;
}

export function LogViewer({ runId, initialState }: LogViewerProps) {
  const orgId = useAuthStore((s) => s.org?.id);
  const timestampVisible = useUiStore((s) => s.logTimestampVisible);
  const setTimestampVisible = useUiStore((s) => s.setLogTimestampVisible);
  const autoscrollPaused = useUiStore((s) => s.logAutoscrollPaused);
  const setAutoscrollPaused = useUiStore((s) => s.setLogAutoscrollPaused);

  const enabled = !TERMINAL_STATES.includes(initialState);

  const { chunks, endState, exitCode } = useLogWebSocket({ orgId, runId, enabled });

  const qc = useQueryClient();

  // Invalidate run detail query when WS signals run ended
  useEffect(() => {
    if (endState) {
      qc.invalidateQueries({ queryKey: ['runs', 'detail', orgId, runId] });
    }
  }, [endState, orgId, runId, qc]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [newSinceScroll, setNewSinceScroll] = useState(0);

  // IntersectionObserver: detect when user scrolls up (SC-3)
  useEffect(() => {
    if (!bottomRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting ?? true;
        setAutoscrollPaused(!visible);
        if (visible) setNewSinceScroll(0);
      },
      { root: containerRef.current, rootMargin: '0px', threshold: 0.01 },
    );
    observer.observe(bottomRef.current);
    return () => observer.disconnect();
  }, [setAutoscrollPaused]);

  // Auto-scroll on new chunks when not paused
  useEffect(() => {
    if (!autoscrollPaused && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
    } else if (autoscrollPaused) {
      setNewSinceScroll((n) => n + 1);
    }
    // chunks.length is the dependency — fires when a new chunk arrives
  }, [chunks.length, autoscrollPaused]);

  function resumeAutoscroll() {
    setAutoscrollPaused(false);
    setNewSinceScroll(0);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  return (
    <div className="flex flex-col border rounded-md bg-black text-slate-100">
      {/* Header toolbar */}
      <div className="flex items-center justify-between p-2 border-b border-white/10">
        <div className="text-sm text-slate-400">{chunks.length} line(s)</div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setTimestampVisible(!timestampVisible)}
            title="Toggle timestamps"
            className="text-slate-200"
          >
            <Clock className="h-4 w-4 mr-1" />
            {timestampVisible ? 'Hide ts' : 'Show ts'}
          </Button>
          {/* Download raw log — browser handles attachment; no fetch-to-blob (threat model) */}
          <a
            href={`/api/orgs/${orgId}/runs/${runId}/logs.log`}
            download
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="sm" variant="ghost" className="text-slate-200">
              <Download className="h-4 w-4 mr-1" /> Download raw
            </Button>
          </a>
        </div>
      </div>

      {/* Autoscroll paused banner (SC-3) */}
      {autoscrollPaused && (
        <button
          type="button"
          onClick={resumeAutoscroll}
          className="py-1 text-sm bg-amber-500/20 border-y border-amber-500/40 text-amber-200 hover:bg-amber-500/30 w-full text-center"
        >
          Autoscroll paused — {newSinceScroll} new line(s). Click to resume.
        </button>
      )}

      {/* Log content area — role="log" for accessibility */}
      <div
        ref={containerRef}
        className="overflow-auto max-h-[65vh] min-h-[300px] p-2 font-mono text-xs"
        role="log"
        aria-live="polite"
        aria-label="Run log output"
      >
        {/* All chunks rendered in a single pre for performance; chunk data via {text} — XSS-safe (T-13-04-01) */}
        <pre className="whitespace-pre-wrap break-words m-0">
          {chunks.map((c) => (
            <span key={c.seq} className={c.stream === 'stderr' ? 'text-red-300' : ''}>
              {timestampVisible && <span className="text-slate-500 select-none">[{c.ts}] </span>}
              {/* NEVER dangerouslySetInnerHTML — c.data rendered as text node (T-13-04-01) */}
              {c.data}
              {!c.data.endsWith('\n') ? '\n' : ''}
            </span>
          ))}
        </pre>
        {/* Bottom sentinel — IntersectionObserver target */}
        <div ref={bottomRef} style={{ height: 1 }} aria-hidden="true" />
      </div>

      {/* End-state banner */}
      {endState && (
        <div className="p-2 border-t border-white/10 text-sm flex items-center gap-2">
          <span>Run finished:</span>
          <span className="font-semibold">{endState}</span>
          {exitCode != null && <span className="text-slate-400">(exit {exitCode})</span>}
          <Button
            size="sm"
            variant="ghost"
            className="ml-2 text-slate-200"
            onClick={resumeAutoscroll}
          >
            <ArrowDown className="h-4 w-4" /> Jump to end
          </Button>
        </div>
      )}
    </div>
  );
}
