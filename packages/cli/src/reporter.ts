/**
 * Reporter abstraction: every CLI command path routes its output through one
 * of these instead of calling `console.log` directly. `humanReporter` wraps
 * `terminal.ts` for a legible, colorized (TTY-aware) experience; `jsonReporter`
 * emits NDJSON (one JSON object per line) on stdout for machine consumption,
 * with errors on stderr, so tools can pipe `x build --json` into `jq`/CI
 * without scraping ANSI.
 */
import { xBanner, xCommand, xDim, xError, xInfo, xSuccess, xWarn } from "./terminal.js";

export type BuildStepStatus = "ok" | "warn" | "error";

export interface BuildStepInfo {
  /** Short machine-readable phase tag, e.g. "static", "server", "islands". */
  step: string;
  status: BuildStepStatus;
  message: string;
  /** Milliseconds elapsed since the build started. */
  durationMs?: number;
}

export interface BuildCompleteInfo {
  durationMs: number;
  outDir: string;
  staticCount: number;
  serverCount: number;
  apiCount: number;
  contentCount: number;
}

export interface DevReadyInfo {
  url: string;
  networkUrl?: string;
  routeCount: number;
  startupMs: number;
}

export interface DevRequestInfo {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

export interface DevRebuildInfo {
  reason: string;
  file?: string;
  durationMs?: number;
}

export interface Reporter {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string, err?: unknown): void;
  /** The decorative `x — fullstack framework for Bun` startup banner (human mode only). */
  banner(): void;
  buildStart(): void;
  buildStep(info: BuildStepInfo): void;
  buildComplete(info: BuildCompleteInfo): void;
  devReady(info: DevReadyInfo): void;
  devRequest(info: DevRequestInfo): void;
  devRebuild(info: DevRebuildInfo): void;
  startReady(info: { url: string }): void;
}

function stepGlyph(status: BuildStepStatus): (message: string) => void {
  if (status === "error") return xError;
  if (status === "warn") return xWarn;
  return xSuccess;
}

export function humanReporter(): Reporter {
  return {
    info: xInfo,
    success: xSuccess,
    warn: xWarn,
    error(message, err) {
      xError(message);
      if (err instanceof Error && err.stack) xDim(err.stack);
    },
    banner: xBanner,

    buildStart() {
      xInfo("build starting...");
    },
    buildStep({ step, status, message, durationMs }) {
      const suffix = durationMs !== undefined ? ` (${durationMs}ms)` : "";
      stepGlyph(status)(`${step}: ${message}${suffix}`);
    },
    buildComplete({ durationMs, outDir, staticCount, serverCount, apiCount, contentCount }) {
      const parts = [`${staticCount} static`, `${serverCount} server`, `${apiCount} api routes`];
      if (contentCount > 0) parts.push(`${contentCount} content`);
      xSuccess(`build complete in ${durationMs}ms: ${parts.join(", ")} -> ${outDir}`);
    },

    devReady({ url, networkUrl, routeCount, startupMs }) {
      xSuccess(`dev server ready in ${startupMs}ms`);
      xCommand("Local", url);
      if (networkUrl) xCommand("Network", networkUrl);
      xDim(`  ${routeCount} route(s)`);
    },
    devRequest({ method, path, status, durationMs }) {
      const glyph = status >= 500 ? xError : status >= 400 ? xWarn : xDim;
      glyph(`  ${method} ${path} ${status} ${durationMs}ms`);
    },
    devRebuild({ reason, file, durationMs }) {
      const suffix = durationMs !== undefined ? ` (${durationMs}ms)` : "";
      xInfo(`rebuilt${file ? ` ${file}` : ""} — ${reason}${suffix}`);
    },

    startReady({ url }) {
      xSuccess(`production server running at ${url}`);
    },
  };
}

// Writes NDJSON directly to the stdio streams rather than through
// `console.log`/`console.error` — see the comment atop terminal.ts for why:
// build commands temporarily patch those globals to capture @thexjs/core's
// own progress lines, and a Reporter call made during that window must not
// recurse into the patch.
function emit(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`);
}

function emitError(event: Record<string, unknown>): void {
  process.stderr.write(`${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`);
}

export function jsonReporter(): Reporter {
  return {
    info(message) {
      emit({ event: "info", message });
    },
    success(message) {
      emit({ event: "info", message });
    },
    warn(message) {
      emitError({ event: "warn", message });
    },
    error(message, err) {
      const stack = err instanceof Error ? err.stack : undefined;
      emitError({ event: "error", message, ...(stack ? { stack } : {}) });
    },
    banner() {
      // No decorative UI in JSON mode.
    },

    buildStart() {
      emit({ event: "build:start" });
    },
    buildStep({ step, status, message, durationMs }) {
      if (status === "error") {
        emitError({ event: "build:step", step, status, message, durationMs });
        return;
      }
      emit({ event: "build:step", step, status, message, durationMs });
    },
    buildComplete({ durationMs, outDir, staticCount, serverCount, apiCount, contentCount }) {
      emit({
        event: "build:complete",
        durationMs,
        outDir,
        staticCount,
        serverCount,
        apiCount,
        contentCount,
      });
    },

    devReady({ url, networkUrl, routeCount, startupMs }) {
      emit({ event: "dev:ready", url, networkUrl, routeCount, startupMs });
    },
    devRequest({ method, path, status, durationMs }) {
      emit({ event: "dev:request", method, path, status, durationMs });
    },
    devRebuild({ reason, file, durationMs }) {
      emit({ event: "dev:rebuild", reason, file, durationMs });
    },

    startReady({ url }) {
      emit({ event: "start:ready", url });
    },
  };
}
