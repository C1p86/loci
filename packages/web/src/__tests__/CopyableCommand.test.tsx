import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyableCommand } from '../components/CopyableCommand.js';

vi.mock('../stores/authStore.js', () => ({
  useAuthStore: vi.fn(() => null),
}));

// Set up clipboard mock at module level so it is in place before any render.
// happy-dom's navigator.clipboard may be undefined; define it via getter so it
// is always the same mock object regardless of when the component reads it.
const writeTextMock = vi.fn().mockResolvedValue(undefined);
try {
  Object.defineProperty(navigator, 'clipboard', {
    get() {
      return { writeText: writeTextMock };
    },
    configurable: true,
  });
} catch {
  // biome-ignore lint/suspicious/noExplicitAny: test-only global mutation
  (navigator as any).clipboard = { writeText: writeTextMock };
}

describe('CopyableCommand', () => {
  beforeEach(() => {
    writeTextMock.mockClear();
  });

  it('renders the command text', () => {
    render(<CopyableCommand command="xci --agent wss://example.com --token abc123" />);
    expect(screen.getByText('xci --agent wss://example.com --token abc123')).toBeInTheDocument();
  });

  it('renders copy button with accessible label', () => {
    render(<CopyableCommand command="xci --agent wss://example.com --token abc123" />);
    expect(screen.getByRole('button', { name: /copy command/i })).toBeInTheDocument();
  });

  it('calls navigator.clipboard.writeText with the exact command on click', async () => {
    const cmd = 'xci --agent wss://example.com --token abc123';
    render(<CopyableCommand command={cmd} />);
    const btn = screen.getByRole('button', { name: /copy command/i });
    fireEvent.click(btn);
    // Flush the async copy() handler microtasks
    await new Promise((r) => setTimeout(r, 50));
    expect(writeTextMock).toHaveBeenCalledWith(cmd);
  });

  it('renders optional label when provided', () => {
    render(
      <CopyableCommand command="xci --agent wss://example.com --token abc123" label="Run this:" />,
    );
    expect(screen.getByText('Run this:')).toBeInTheDocument();
  });
});
