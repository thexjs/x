/**
 * Shared HTTP load-generation primitives used by both the in-process
 * benchmark (load.ts) and the crash-recovery scenario (crash-recovery.ts),
 * which drives a real child-process server instead of an in-process one.
 *
 * Pulled out of load.ts so crash-recovery.ts can reuse the exact same
 * percentile/latency math without importing load.ts itself — load.ts runs
 * its whole benchmark as a side effect of `main()` at module load, so it
 * must never be imported for its helpers.
 */

export interface LoadOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
}

export interface LoadResult {
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  errors: number;
  count: number;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

export async function loadFor(
  baseUrl: string,
  path: string,
  concurrency: number,
  durationMs: number,
  options: LoadOptions = {},
): Promise<LoadResult> {
  const url = `${baseUrl}${path}`;
  const end = performance.now() + durationMs;
  const latencies: number[] = [];
  let done = 0;
  let errors = 0;
  let inflight = 0;

  await new Promise<void>((resolve) => {
    const worker = async () => {
      while (performance.now() < end) {
        const start = performance.now();
        try {
          const res = await fetch(url, {
            method: options.method,
            headers: options.headers,
            body: options.body,
          });
          if (res.status >= 500) errors += 1;
        } catch {
          errors += 1;
        }
        latencies.push(performance.now() - start);
        done += 1;
      }
      inflight -= 1;
      if (inflight === 0) resolve();
    };

    for (let i = 0; i < concurrency; i += 1) {
      inflight += 1;
      worker();
    }
  });

  const sorted = [...latencies].sort((a, b) => a - b);
  const elapsedSec = durationMs / 1000;
  return {
    rps: Math.round(done / elapsedSec),
    p50: Math.round(percentile(sorted, 50) * 100) / 100,
    p95: Math.round(percentile(sorted, 95) * 100) / 100,
    p99: Math.round(percentile(sorted, 99) * 100) / 100,
    errors,
    count: done,
  };
}

/**
 * Poll `url` until it responds with an ok (< 400) status, or throw once
 * `timeoutMs` has elapsed since `startAt`. Returns the elapsed time in ms
 * measured from `startAt` (not from when polling began), so callers can
 * time a window that started before the first poll (e.g. "time since the
 * process was killed", not "time since we started asking").
 */
export async function waitForHttp(
  url: string,
  timeoutMs: number,
  startAt: number = performance.now(),
): Promise<number> {
  const deadline = startAt + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return performance.now() - startAt;
    } catch {
      // Connection refused / reset while the server isn't listening yet —
      // expected mid-restart, keep polling.
    }
    if (performance.now() >= deadline) {
      throw new Error(`timed out waiting for ${url} to become ready after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * Ask the OS for a free TCP port by briefly binding to port 0, then
 * releasing it. There's a small window where another process could grab the
 * same port before the caller binds it; acceptable for a short-lived bench
 * script, not for production use.
 */
export function pickFreePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  return port;
}
