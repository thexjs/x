/**
 * Minimal ANSI styling for x CLI output — no dependencies.
 *
 * Writes go through `process.stdout.write`/`process.stderr.write` directly
 * rather than `console.log`/`console.warn`/`console.error`. This matters
 * because build commands temporarily monkey-patch `console.log`/`console.warn`
 * to capture `@thexjs/core`'s own build-progress lines (see
 * `runBuildCapturingOutput` in index.ts) — if these helpers went through
 * `console.*` too, a Reporter call made while that patch is active would
 * recurse into itself.
 */
const r = "\x1b[0m";
const dim = "\x1b[2m";
const bold = "\x1b[1m";
const amber = "\x1b[38;2;232;149;47m";
const cyan = "\x1b[38;2;61;214;198m";
const green = "\x1b[38;2;78;201;120m";
const red = "\x1b[38;2;248;113;113m";

/**
 * Whether ANSI color codes should be emitted. Checked per-call (not cached at
 * module load) so tests can flip `process.stdout.isTTY` and so piping output
 * to a file/tool mid-process is respected immediately. Colors are disabled
 * when `NO_COLOR` is set (https://no-color.org) or stdout isn't a TTY.
 */
export function colorEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  return Boolean(process.stdout.isTTY);
}

/** Wrap `text` in `code`, or return it unstyled when color output is disabled. */
function style(code: string, text: string): string {
  return colorEnabled() ? `${code}${text}${r}` : text;
}

function writeOut(line: string): void {
  process.stdout.write(`${line}\n`);
}

function writeErr(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function xInfo(message: string): void {
  writeOut(`${style(`${amber}${bold}`, "[x]")} ${message}`);
}

export function xSuccess(message: string): void {
  writeOut(`${style(green, "✓")} ${message}`);
}

export function xWarn(message: string): void {
  writeErr(`${style(amber, "⚠")} ${message}`);
}

export function xError(message: string): void {
  writeErr(`${style(red, "✗")} ${message}`);
}

export function xDim(message: string): void {
  writeOut(style(dim, message));
}

export function xCommand(label: string, command: string): void {
  writeOut(`  ${style(dim, label)}  ${style(cyan, command)}`);
}

export function xBanner(): void {
  writeOut("");
  writeOut(`  ${style(`${amber}${bold}`, "x")} ${style(dim, "— fullstack framework for Bun")}`);
  writeOut("");
}
