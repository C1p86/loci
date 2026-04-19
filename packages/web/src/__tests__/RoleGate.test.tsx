import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleGate } from '../components/RoleGate.js';
import type { Role } from '../lib/types.js';
import type { AuthState } from '../stores/authStore.js';
import { useAuthStore } from '../stores/authStore.js';

// Mock the auth store
vi.mock('../stores/authStore.js', () => ({
  useAuthStore: vi.fn(),
}));

type SelectorFn = (state: AuthState) => unknown;

function mockRole(role: Role) {
  vi.mocked(useAuthStore).mockImplementation((selector: SelectorFn) => {
    const state = { org: { role } } as unknown as AuthState;
    return selector(state);
  });
}

// Typed wrappers so `role` prop is clearly the RoleGate business-role prop, not ARIA.
const MemberGated = ({ children }: { children: React.ReactNode }) => (
  <RoleGate role={'member' as Role}>{children}</RoleGate>
);
const OwnerGated = ({ children }: { children: React.ReactNode }) => (
  <RoleGate role={'owner' as Role}>{children}</RoleGate>
);

describe('RoleGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('viewer role (insufficient)', () => {
    beforeEach(() => mockRole('viewer'));

    it('renders children in DOM (disabled-not-hidden — D-11)', () => {
      render(
        <MemberGated>
          <button type="button">Save</button>
        </MemberGated>,
      );
      // Button MUST be in the DOM — never hidden
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });

    it('wraps children with opacity-60 class (visual disabled state)', () => {
      render(
        <MemberGated>
          <button type="button">Save</button>
        </MemberGated>,
      );
      const wrapper = screen.getByRole('button', { name: 'Save' }).parentElement;
      expect(wrapper).toHaveClass('opacity-60');
    });

    it('renders custom fallback when provided', () => {
      render(
        <RoleGate role={'member' as Role} fallback={<span>No permission</span>}>
          <button type="button">Save</button>
        </RoleGate>,
      );
      expect(screen.getByText('No permission')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    });
  });

  describe('member role (sufficient for member-gated action)', () => {
    beforeEach(() => mockRole('member'));

    it('renders children directly without wrapper', () => {
      render(
        <MemberGated>
          <button type="button">Save</button>
        </MemberGated>,
      );
      const button = screen.getByRole('button', { name: 'Save' });
      expect(button).toBeInTheDocument();
      // Button parent should NOT be the disabled wrapper span
      expect(button.parentElement).not.toHaveClass('opacity-60');
    });
  });

  describe('owner role (sufficient for owner-gated action)', () => {
    beforeEach(() => mockRole('owner'));

    it('renders children for owner accessing owner-gated action', () => {
      render(
        <OwnerGated>
          <button type="button">Delete org</button>
        </OwnerGated>,
      );
      expect(screen.getByRole('button', { name: 'Delete org' })).toBeInTheDocument();
    });
  });

  describe('member attempting owner-gated action', () => {
    beforeEach(() => mockRole('member'));

    it('renders children disabled (not hidden) when member lacks owner role', () => {
      render(
        <OwnerGated>
          <button type="button">Delete org</button>
        </OwnerGated>,
      );
      // Must still be in DOM
      expect(screen.getByRole('button', { name: 'Delete org' })).toBeInTheDocument();
      const wrapper = screen.getByRole('button', { name: 'Delete org' }).parentElement;
      expect(wrapper).toHaveClass('opacity-60');
    });
  });
});
