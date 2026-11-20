/**
 * Load test for the x framework request pipeline.
 *
 * Boots a real production-mode app (the same `createApp().fetch` path that
 * `x start` hands every incoming request) over a real socket via `Bun.serve`,
 * then measures:
 *
 *   1. SSR page throughput + latency percentiles (p50/p95/p99)
 *   2. Server-function throughput
 *   3. Rate-limiter behavior under a burst (in-memory store)
 *   4. Crash recovery (#129): kill -9 a real server process mid-run, then
 *      measure restart time and post-restart traffic (see crash-recovery.ts)
 *
 * Usage:
 *   bun scripts/bench/load.ts            # full run
 *   bun scripts/bench/load.ts --concurrency 50 --duration 3
 *
 * Output is a plain-text table plus machine-readable JSON (written to
 * `scripts/bench/results/<unix-ts>.json`).
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../packages/core/src/createApp";
import { createRateLimiter } from "../../packages/core/src/security/rate-limit";
import { registerServerFunctions } from "../../packages/core/src/server-functions";
import { runCrashRecoveryScenario } from "./crash-recovery";
import { loadFor } from "./http-load";
import type { ScenarioResult, SloThresholds } from "./slo";
import {
  DEFAULT_MAX_RESTART_MS,
  DEFAULT_SLOS,
  evaluateRestartSlo,
  evaluateSlo,
  formatViolations,
} from "./slo";

interface BenchArgs {
  concurrency: number;
  durationMs: number;
  route: string;
  /** Enforce SLOs and fail the run (exit 1) on violation. */
  enforceSlo: boolean;
}

function parseArgs(argv: string[]): BenchArgs {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    concurrency: Number(get("--concurrency") ?? 32),
    durationMs: Number(get("--duration") ?? 5) * 1000,
    route: get("--route") ?? "/about",
    enforceSlo: argv.includes("--slo"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const FIXTURE_DIR = join(import.meta.dir, "../../packages/core/src/__fixtures__/bench");
  const PAGES_DIR = join(FIXTURE_DIR, "pages");
  const API_DIR = join(FIXTURE_DIR, "api");

  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(PAGES_DIR, { recursive: true });
  mkdirSync(API_DIR, { recursive: true });

  // A static page (no loader) — the cheapest SSR path.
  writeFileSync(
    join(PAGES_DIR, "index.tsx"),
    `export const mode = "static";
export default function Home() {
  return <h1>Home</h1>;
}
`,
  );
  // A server-rendered page with a loader that returns JSON — the typical
  // dashboard/SSR path.
  writeFileSync(
    join(PAGES_DIR, "about.tsx"),
    `export const mode = "server";
export async function loader() {
  return { items: Array.from({ length: 10 }, (_, i) => ({ id: i, name: "item" + i })) };
}
export default function About({ loaderData }: { loaderData: { items: Array<{ id: number; name: string }> } }) {
  return (
    <main>
      <h1>About</h1>
      <ul>{loaderData.items.map((it) => <li key={it.id}>{it.name}</li>)}</ul>
    </main>
  );
}
`,
  );
  writeFileSync(
    join(API_DIR, "hello.ts"),
    `export function GET() {
  return Response.json({ hello: "world" });
}
`,
  );

  registerServerFunctions("/hello", [], {
    async say() {
      return { hello: "world" };
    },
  });

  const app = await createApp({
    pagesDir: PAGES_DIR,
    apiDir: API_DIR,
    development: false,
    security: { headers: false },
    observability: { logging: false },
  });

  const server = Bun.serve({ ...app, port: 0 });
  const baseUrl = `http://${server.hostname}:${server.port}`;

  const report: Record<string, unknown> = {
    args,
    startedAt: new Date().toISOString(),
    scenarios: {},
  };

  console.log("\n[x] load test — production-mode request pipeline");
  console.log(
    `    server: ${baseUrl}  concurrency: ${args.concurrency}  duration: ${args.durationMs}ms\n`,
  );

  // 1. SSR page throughput (the default benchmark route).
  const page = await loadFor(baseUrl, args.route, args.concurrency, args.durationMs);
  console.log(`SSR page (GET ${args.route})`);
  console.log(
    `  requests: ${page.count}  rps: ${page.rps}  p50: ${page.p50}ms  p95: ${page.p95}ms  p99: ${page.p99}ms  errors: ${page.errors}`,
  );
  report.scenarios = { ...report.scenarios, page };

  // 2. Server function throughput (POST /__x/actions/hello/say).
  // CSRF origin verification requires a same-origin Origin header, which the
  // request pipeline normally sees from the browser — send it explicitly so
  // the action path is exercised end-to-end (including the CSRF check).
  const serverFn = await loadFor(
    baseUrl,
    "/__x/actions/hello/say",
    args.concurrency,
    args.durationMs,
    {
      method: "POST",
      headers: { origin: baseUrl, "content-type": "application/json" },
      body: "[]",
    },
  );
  console.log("\nServer function (POST /__x/actions/hello/say)");
  console.log(
    `  requests: ${serverFn.count}  rps: ${serverFn.rps}  p50: ${serverFn.p50}ms  p95: ${serverFn.p95}ms  p99: ${serverFn.p99}ms  errors: ${serverFn.errors}`,
  );
  report.scenarios = { ...report.scenarios, serverFn };

  // 3. Rate limiter under burst: limit 10/window, fire 100 rapid requests,
  // expect ~10 allowed and the rest 429.
  const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
  const burstBase = await loadFor(baseUrl, "/about", 1, 500);
  let allowed = 0;
  let rejected = 0;
  for (let i = 0; i < 100; i += 1) {
    const res = await limiter.check(new Request(`${baseUrl}/about`));
    if (res.ok) allowed += 1;
    else rejected += 1;
  }
  limiter.dispose();
  console.log("\nRate limiter burst (limit 10/60s, 100 attempts)");
  console.log(`  allowed: ${allowed}  rejected: ${rejected}`);
  report.scenarios = {
    ...report.scenarios,
    rateLimitBurst: { allowed, rejected },
    burstBaseline: burstBase,
  };

  // 4. Crash recovery (#129): kill -9 a real server process mid-run and
  // measure (a) time from the kill to the respawned process serving its
  // first successful request again, and (b) that traffic resumes cleanly
  // once it has. See crash-recovery.ts's module docstring for why this spawns
  // its own tiny test-only supervisor rather than exercising a restart
  // feature that doesn't exist in this framework's deploy model.
  const crashRecovery = await runCrashRecoveryScenario({
    pagesDir: PAGES_DIR,
    apiDir: API_DIR,
    route: args.route,
    postRestartDurationMs: 1000,
    postRestartConcurrency: 8,
    readyTimeoutMs: 10_000,
  });
  console.log("\nCrash recovery (kill -9 mid-run, then resume traffic)");
  console.log(
    `  restart: ${crashRecovery.restartMs}ms  requests: ${crashRecovery.postRestart.count}  p50: ${crashRecovery.postRestart.p50}ms  p95: ${crashRecovery.postRestart.p95}ms  p99: ${crashRecovery.postRestart.p99}ms  errors: ${crashRecovery.postRestart.errors}`,
  );
  report.scenarios = { ...report.scenarios, crashRecovery };

  server.stop(true);

  const outDir = join(import.meta.dir, "results");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nresults written to ${outPath}`);

  // Exit non-zero if any scenario produced server errors (500s).
  const totalErrors =
    (page.errors ?? 0) + (serverFn.errors ?? 0) + (crashRecovery.postRestart.errors ?? 0);
  if (totalErrors > 0) {
    console.error(`\nFAILED: ${totalErrors} server errors under load`);
    process.exit(1);
  }
  if (rejected !== 90) {
    console.error(`\nFAILED: rate limiter burst rejected ${rejected}, expected ~90`);
    process.exit(1);
  }
  if (args.enforceSlo) {
    const scenarios: ScenarioResult[] = [
      { name: "ssr-page", p95: page.p95, count: page.count, errors: page.errors },
      { name: "server-fn", p95: serverFn.p95, count: serverFn.count, errors: serverFn.errors },
      {
        name: "crash-recovery-post-restart",
        p95: crashRecovery.postRestart.p95,
        count: crashRecovery.postRestart.count,
        errors: crashRecovery.postRestart.errors,
      },
    ];
    const sloResult = evaluateSlo(scenarios, defaultSloThresholds());
    const restartResult = evaluateRestartSlo(
      "crash-recovery",
      crashRecovery.restartMs,
      DEFAULT_MAX_RESTART_MS,
    );
    const violations = [...sloResult.violations, ...restartResult.violations];
    if (violations.length > 0) {
      console.error(formatViolations(violations));
      console.error(`\nFAILED: load-test SLO violation (see BENCHMARKS.md for the contract)`);
      process.exit(1);
    }
    console.log("SLO check passed");
  }
  console.log("\nOK");
}

function defaultSloThresholds(): SloThresholds {
  return { ...DEFAULT_SLOS };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
