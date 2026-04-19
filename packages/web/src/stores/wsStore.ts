import { create } from 'zustand';

type WsStatus = 'connected' | 'reconnecting' | 'disconnected';

interface WsState {
  status: WsStatus;
  activeRunSubs: Map<string, WebSocket>;
  setStatus: (s: WsStatus) => void;
  registerSub: (runId: string, ws: WebSocket) => void;
  unregisterSub: (runId: string) => void;
}

export const useWsStore = create<WsState>((set) => ({
  status: 'disconnected',
  activeRunSubs: new Map(),
  setStatus: (status) => set({ status }),
  registerSub: (runId, ws) =>
    set((s) => {
      s.activeRunSubs.set(runId, ws);
      return { activeRunSubs: new Map(s.activeRunSubs) };
    }),
  unregisterSub: (runId) =>
    set((s) => {
      s.activeRunSubs.delete(runId);
      return { activeRunSubs: new Map(s.activeRunSubs) };
    }),
}));
