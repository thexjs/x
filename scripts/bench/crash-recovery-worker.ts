/**
 * Child-process entry for the crash-recovery scenario (#129).
 *
 * crash-recovery.ts spawns this as a real OS process (not an in-process
 * `Bun.serve`, unlike load.ts's other scenarios) specifically so it can be
 * `kill -9`'d and observed coming back — an in-process server can't model a
 * hard crash of the process that's serving it.
 *
 * Reads its config from env vars rather than argv so the parent can reuse
 * the exact same fixture app (pages/api dirs) load.ts already wrote to disk.
 */

import { createApp } from "../../packages/core/src/createApp";

const pagesDir = process.env.BENCH_PAGES_DIR;
const apiDir = process.env.BENCH_API_DIR;
const port = Number(process.env.PORT);

if (!pagesDir || !apiDir || !port) {
  console.error("crash-recovery-worker: missing BENCH_PAGES_DIR, BENCH_API_DIR, or PORT env var");
  process.exit(1);
}

const app = await createApp({
  pagesDir,
  apiDir,
  development: false,
  security: { headers: false },
  observability: { logging: false },
});

Bun.serve({ ...app, port });

// Signals readiness to the parent via stdout; the parent actually confirms
// readiness by polling HTTP (more reliable than racing stdout buffering),
// but this line is useful when debugging a run by hand.
console.log(`crash-recovery-worker: listening on ${port} (pid ${process.pid})`);
