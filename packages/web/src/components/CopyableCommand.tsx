import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from './ui/button.js';

interface CopyableCommandProps {
  command: string;
  label?: string;
}

/**
 * Displays a command string in a pre/code block with a clipboard copy button.
 * Used in UI-09 agent registration empty state.
 * T-13-03-02: never persists the command to any storage.
 */
export function CopyableCommand({ command, label }: CopyableCommandProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may be blocked in some browser contexts
    }
  }

  return (
    <div className="relative my-2">
      {label && <div className="text-sm text-muted-foreground mb-1">{label}</div>}
      <pre className="rounded-md border bg-muted p-3 pr-12 text-sm overflow-x-auto font-mono">
        {command}
      </pre>
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2"
        onClick={copy}
        aria-label="Copy command"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}
