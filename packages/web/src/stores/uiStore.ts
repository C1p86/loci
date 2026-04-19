import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiState {
  sidebarCollapsed: boolean;
  logTimestampVisible: boolean;
  logAutoscrollPaused: boolean;
  toggleSidebar: () => void;
  setLogTimestampVisible: (v: boolean) => void;
  setLogAutoscrollPaused: (v: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      logTimestampVisible: true,
      logAutoscrollPaused: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setLogTimestampVisible: (v) => set({ logTimestampVisible: v }),
      setLogAutoscrollPaused: (v) => set({ logAutoscrollPaused: v }),
    }),
    { name: 'xci.ui' },
  ),
);
