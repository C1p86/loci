// src/tui/picker.ts
//
// Interactive alias picker — shown when xci is run without arguments in a TTY.
// Arrow keys to navigate, Enter to select, q/Esc to quit.

import type { ReadStream } from 'node:tty';
import { color, cursor, screen, write, termSize, fitWidth, stripAnsi } from './ansi.js';
import type { CommandDef, CommandMap } from '../types.js';

export interface PickerEntry {
  alias: string;
  description: string;
  kind: string;
}

function buildEntries(commands: CommandMap): PickerEntry[] {
  const entries: PickerEntry[] = [];
  for (const [alias, def] of commands) {
    entries.push({
      alias,
      description: def.description ?? '',
      kind: def.kind,
    });
  }
  return entries;
}

function renderPicker(entries: PickerEntry[], selected: number): void {
  const { cols, rows } = termSize();
  const maxVisible = Math.min(entries.length, rows - 6); // header(3) + footer(2) + margin(1)
  const aliasMaxLen = Math.max(...entries.map((e) => e.alias.length), 5);

  // Scroll window
  let scrollTop = 0;
  if (selected >= scrollTop + maxVisible) {
    scrollTop = selected - maxVisible + 1;
  }
  if (selected < scrollTop) {
    scrollTop = selected;
  }

  write(cursor.moveTo(1, 1) + screen.clearDown);

  // Header
  write(`${color.bold}${color.cyan}  Available aliases${color.reset}\n`);
  write(`${color.dim}  ↑↓ navigate  ⏎ select  q quit${color.reset}\n\n`);

  // Entries
  const visibleEntries = entries.slice(scrollTop, scrollTop + maxVisible);
  for (let i = 0; i < visibleEntries.length; i++) {
    const entry = visibleEntries[i];
    const idx = scrollTop + i;
    const isSelected = idx === selected;
    const pointer = isSelected ? `${color.cyan}${color.bold}❯ ` : '  ';
    const aliasText = fitWidth(entry.alias, aliasMaxLen);
    const kindTag = `${color.dim}(${entry.kind})${color.reset}`;
    const desc = entry.description ? `${color.dim} — ${entry.description}${color.reset}` : '';

    if (isSelected) {
      write(`${pointer}${color.bold}${aliasText}${color.reset}${desc}  ${kindTag}\n`);
    } else {
      write(`${pointer}${color.reset}${aliasText}${desc}  ${kindTag}\n`);
    }
  }

  // Scroll indicator
  if (entries.length > maxVisible) {
    const above = scrollTop > 0 ? `${color.dim}  ↑ ${scrollTop} more${color.reset}` : '';
    const belowCount = entries.length - scrollTop - maxVisible;
    const below = belowCount > 0 ? `${color.dim}  ↓ ${belowCount} more${color.reset}` : '';
    if (above) write(`${above}\n`);
    if (below) write(`${below}\n`);
  }
}

/**
 * Show an interactive alias picker. Returns the selected alias name,
 * or null if the user quit without selecting.
 */
export function showPicker(commands: CommandMap): Promise<string | null> {
  const entries = buildEntries(commands);
  if (entries.length === 0) {
    write('No aliases defined in commands.yml\n');
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const stdin = process.stdin as ReadStream;
    const wasRaw = stdin.isRaw;

    let selected = 0;

    function cleanup(): void {
      stdin.setRawMode(wasRaw ?? false);
      stdin.removeListener('data', onKey);
      stdin.pause();
      write(cursor.show);
    }

    function onKey(data: Buffer): void {
      const key = data.toString();

      // Escape or q → quit
      if (key === '\x1b' || key === 'q' || key === 'Q') {
        cleanup();
        write('\n');
        resolve(null);
        return;
      }

      // Enter → select
      if (key === '\r' || key === '\n') {
        cleanup();
        write('\n');
        resolve(entries[selected].alias);
        return;
      }

      // Ctrl+C → quit
      if (key === '\x03') {
        cleanup();
        write('\n');
        resolve(null);
        return;
      }

      // Arrow keys (escape sequences)
      if (key === '\x1b[A' || key === 'k') {
        // Up
        selected = Math.max(0, selected - 1);
      } else if (key === '\x1b[B' || key === 'j') {
        // Down
        selected = Math.min(entries.length - 1, selected + 1);
      } else if (key === '\x1b[H' || key === 'g') {
        // Home
        selected = 0;
      } else if (key === '\x1b[F' || key === 'G') {
        // End
        selected = entries.length - 1;
      }

      renderPicker(entries, selected);
    }

    write(cursor.hide);
    renderPicker(entries, selected);

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onKey);
  });
}
