// src/tui/ansi.ts
//
// Zero-dependency ANSI escape code helpers for TUI rendering.
// Works on modern terminals (Windows Terminal, iTerm2, GNOME Terminal, etc.)

export const ESC = '\x1b[';

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

export const cursor = {
  hide: `${ESC}?25l`,
  show: `${ESC}?25h`,
  moveTo: (row: number, col: number) => `${ESC}${row};${col}H`,
  moveUp: (n = 1) => `${ESC}${n}A`,
  moveDown: (n = 1) => `${ESC}${n}B`,
  saveCursor: `${ESC}s`,
  restoreCursor: `${ESC}u`,
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export const screen = {
  clear: `${ESC}2J${ESC}1;1H`,
  clearLine: `${ESC}2K`,
  clearDown: `${ESC}J`,
  altBuffer: `${ESC}?1049h`,
  mainBuffer: `${ESC}?1049l`,
};

// ---------------------------------------------------------------------------
// Colors (using basic 16 colors for max compatibility)
// ---------------------------------------------------------------------------

export const color = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  italic: `${ESC}3m`,
  underline: `${ESC}4m`,
  inverse: `${ESC}7m`,

  // Foreground
  black: `${ESC}30m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`,
  gray: `${ESC}90m`,

  // Background
  bgBlack: `${ESC}40m`,
  bgRed: `${ESC}41m`,
  bgGreen: `${ESC}42m`,
  bgYellow: `${ESC}43m`,
  bgBlue: `${ESC}44m`,
  bgMagenta: `${ESC}45m`,
  bgCyan: `${ESC}46m`,
  bgWhite: `${ESC}47m`,
};

// ---------------------------------------------------------------------------
// Box drawing (Unicode)
// ---------------------------------------------------------------------------

export const box = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  teeDown: '┬',
  teeUp: '┴',
  teeRight: '├',
  teeLeft: '┤',
  cross: '┼',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get terminal dimensions, with safe defaults. */
export function termSize(): { cols: number; rows: number } {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

/** Check whether stdout is an interactive TTY (not piped). */
export function isTTY(): boolean {
  return process.stdout.isTTY === true;
}

/** Strip ANSI escape codes from a string (for length calculations). */
export function stripAnsi(s: string): string {
  // biome-ignore lint: regex is intentionally complex for ANSI stripping
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, '');
}

/** Truncate a string to maxLen visible characters, appending '…' if truncated. */
export function truncate(s: string, maxLen: number): string {
  const visible = stripAnsi(s);
  if (visible.length <= maxLen) return s;
  // For simplicity, truncate the raw string (works when ANSI codes are at start/end)
  return visible.slice(0, maxLen - 1) + '…';
}

/** Pad/truncate a string to exactly `width` visible characters. */
export function fitWidth(s: string, width: number): string {
  const visible = stripAnsi(s);
  if (visible.length === width) return s;
  if (visible.length > width) return truncate(s, width);
  return s + ' '.repeat(width - visible.length);
}

/** Draw a horizontal line of given width. */
export function hLine(width: number): string {
  return box.horizontal.repeat(width);
}

/** Write directly to stdout without newline. */
export function write(s: string): void {
  process.stdout.write(s);
}
