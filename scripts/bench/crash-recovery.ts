/**
 * Crash-recovery scenario for the load test (#129).
 *
 * The issue asks to "inject a crash (kill -9 the server process), assert
 * the process restarts and serves traffic within a bound ... before the
 * next request round."
 *
 * Scope decision (see PR description for the full reasoning): this repo has
 * no process supervisor of its own. `x start` just spawns `bun
 * <serverEntry>` and exits when that child exits (packages/cli/src/index.ts,
 * cmdStart) — restart-on-crash is explicitly the deploy platform's job
 * (DEPLOY.md: "a process manager restarting one process (systemd, pm2, your
 * platform's own supervisor)"). So there is nothing in-repo to kill -9 and
 * watch "restart itself".
 *
 * Rather than silently narrowing this to just "time to first request" (which
 * wouldn't exercise a crash at all), this scenario adds a tiny supervisor
 * *for the test itself* that plays the role DEPLOY.md assigns to
 * systemd/pm2/the platform: spawn the server, and when it exits
 * unexpectedly, spawn a fresh one. That lets the test actually do what the
 * issue describes — kill -9 mid-run, then assert traffic resumes within a
 * bound — without inventing a production restart feature that isn't part of
 * this framework's deploy model.
 */

import { join } from "node:path";
import { type LoadResult, loadFor, pickFreePort, waitForHttp } from "./http-load";

export interface CrashRecoveryOptions {
  /** Fixture pages dir to boot the worker app against (shared with load.ts's other scenarios). */
  pagesDir: string;
  /** Fixture api dir to boot the worker app against. */
  apiDir: string;
  /** Route to poll for readiness and to load-test once traffic resumes. */
  route: string;
  /** Duration of the post-restart load round, in ms. */
  postRestartDurationMs: number;
  /** Concurrency for the post-restart load round. */
  postRestartConcurrency: number;
  /** Max time to wait for the worker to become ready, in ms (both the initial boot and the post-crash restart). */
  readyTimeoutMs: number;
}

export interface CrashRecoveryOutcome {
  /** Time from the kill -9 to the respawned process serving its first successful request, in ms. */
  restartMs: number;
  /** Load generated against the server once it has resumed serving traffic. */
  postRestart: LoadResult;
}

const WORKER_ENTRY = join(import.meta.dir, "crash-recovery-worker.ts");

function spawnWorker(port: number, opts: CrashRecoveryOptions): Bun.Subprocess {
  return Bun.spawn({
    cmd: ["bun", WORKER_ENTRY],
    env: {
      ...process.env,
      PORT: String(port),
      BENCH_PAGES_DIR: opts.pagesDir,
      BENCH_API_DIR: opts.apiDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function killAndWait(proc: Bun.Subprocess): Promise<void> {
  if (proc.killed || proc.exitCode !== null) return;
  // SIGKILL, not SIGTERM: a hard kill with no chance for the graceful
  // shutdown path (packages/cli's SIGTERM/SIGINT handling) to run. That
  // graceful path is already covered elsewhere (cli.test.ts); this scenario
  // is specifically about surviving a crash that path never gets to see.
  proc.kill("SIGKILL");
  await proc.exited;
}

export async function runCrashRecoveryScenario(
  opts: CrashRecoveryOptions,
): Promise<CrashRecoveryOutcome> {
  const port = pickFreePort();
  const baseUrl = `http://localhost:${port}`;
  const url = `${baseUrl}${opts.route}`;

  let proc = spawnWorker(port, opts);
  try {
    await waitForHttp(url, opts.readyTimeoutMs);

    // Confirm it's actually serving before we crash it, so a failure to
    // restart isn't confused with a failure to ever have started.
    const baseline = await fetch(url);
    if (!baseline.ok) {
      throw new Error(`crash-recovery: baseline request to ${url} failed (${baseline.status})`);
    }

    const crashedAt = performance.now();
    await killAndWait(proc);

    // Respawn — standing in for the process supervisor a real deployment
    // runs (see module docstring). Measuring from `crashedAt` means
    // restartMs captures the full outage window: detect-death + spawn +
    // boot + first successful response.
    proc = spawnWorker(port, opts);
    const restartMs = await waitForHttp(url, opts.readyTimeoutMs, crashedAt);

    const postRestart = await loadFor(
      baseUrl,
      opts.route,
      opts.postRestartConcurrency,
      opts.postRestartDurationMs,
    );

    return { restartMs, postRestart };
  } finally {
    await killAndWait(proc);
  }
}
