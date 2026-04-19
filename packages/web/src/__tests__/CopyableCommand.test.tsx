import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Component doesn't exist yet — this test is RED
vi.mock('../stores/authStore.js', () => ({
  useAuthStore: vi.fn(() => null),
}));

describe('CopyableCommand', () => {
  beforeEach(() => {
    // Mock clipboard API
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  it('renders the command text', async () => {
    const { CopyableCommand } = await import('../components/CopyableCommand.js');
    render(<CopyableCommand command="xci --agent wss://example.com --token abc123" />);
    expect(screen.getByText('xci --agent wss://example.com --token abc123')).toBeInTheDocument();
  });

  it('renders copy button with accessible label', async () => {
    const { CopyableCommand } = await import('../components/CopyableCommand.js');
    render(<CopyableCommand command="xci --agent wss://example.com --token abc123" />);
    expect(screen.getByRole('button', { name: /copy command/i })).toBeInTheDocument();
  });

  it('calls navigator.clipboard.writeText with the exact command on click', async () => {
    const user = userEvent.setup();
    const { CopyableCommand } = await import('../components/CopyableCommand.js');
    const cmd = 'xci --agent wss://example.com --token abc123';
    render(<CopyableCommand command={cmd} />);
    const btn = screen.getByRole('button', { name: /copy command/i });
    await user.click(btn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(cmd);
  });

  it('renders optional label when provided', async () => {
    const { CopyableCommand } = await import('../components/CopyableCommand.js');
    render(
      <CopyableCommand command="xci --agent wss://example.com --token abc123" label="Run this:" />,
    );
    expect(screen.getByText('Run this:')).toBeInTheDocument();
  });
});
