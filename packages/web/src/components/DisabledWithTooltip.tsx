import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip.js';

export function DisabledWithTooltip({ children, reason }: { children: ReactNode; reason: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Wrapper span catches hover even when child is disabled */}
          <span className="inline-block cursor-not-allowed">
            <span className="pointer-events-none opacity-60">{children}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
