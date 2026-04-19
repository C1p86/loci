import { create } from 'zustand';
import type { AuthMe, Org, Plan, Role, User } from '../lib/types.js';

export interface AuthState {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  user: User | null;
  org: Org | null;
  plan: Plan | null;
  setFromMe: (me: AuthMe) => void;
  clear: () => void;
  role: () => Role | null;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  org: null,
  plan: null,
  setFromMe: (me) => set({ status: 'authenticated', user: me.user, org: me.org, plan: me.plan }),
  clear: () => set({ status: 'unauthenticated', user: null, org: null, plan: null }),
  role: () => get().org?.role ?? null,
}));
