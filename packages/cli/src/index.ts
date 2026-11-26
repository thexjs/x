#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import {
  type DetectedOptions,
  detectDefaultOptions,
  detectOptionsFromConfig,
  findConfig,
} from "./config-detect.js";
import { runDoctor } from "./doctor.js";
import { humanReporter, jsonReporter, type Reporter } from "./reporter.js";
import { compileTailwindAsync } from "./tailwind.js";
import { xError, xInfo, xSuccess, xWarn } from "./terminal.js";

export type OutputFormat = "text" | "json";

// Strip leading "run" so `x run dev` / `x run build` / `x run start` all work
// (common muscle memory from `npm run` / `bun run`).
function parseArgv(argv: string[]): {
  command: string | undefined;
  args: string[];
  cwd: string | undefined;
  adapter: string | undefined;
  outDir: string | undefined;
  format: OutputFormat;
  migrateDir: string | undefined;
  migrateSqlite: string | undefined;
  migratePostgres: boolean;
} {
  const rest: string[] = [];
  let cwd: string | undefined;
  let adapter: string | undefined;
  let outDir: string | undefined;
  let format: OutputFormat = "text";
  let migrateDir: string | undefined;
  let migrateSqlite: string | undefined;
  let migratePostgres = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--cwd") {
      cwd = argv[++i];
      continue;
    }
    if (arg.startsWith("--cwd=")) {
      cwd = arg.slice("--cwd=".length);
      continue;
    }
    if (arg === "--adapter") {
      const next = argv[++i];
      if (!next || next.startsWith("--")) {
        xError('"--adapter" requires a name, e.g. "--adapter vercel"');
        process.exit(1);
      }
      adapter = next;
      continue;
    }
    if (arg.startsWith("--adapter=")) {
      const value = arg.slice("--adapter=".length);
      if (!value) {
        xError('"--adapter=" requires a name, e.g. "--adapter=vercel"');
        process.exit(1);
      }
      adapter = value;
      continue;
    }
    if (arg === "--outDir") {
      const next = argv[++i];
      if (!next || next.startsWith("--")) {
        xError('"--outDir" requires a path, e.g. "--outDir dist"');
        process.exit(1);
      }
      outDir = next;
      continue;
    }
    if (arg.startsWith("--outDir=")) {
      const value = arg.slice("--outDir=".length);
      if (!value) {
        xError('"--outDir=" requires a path, e.g. "--outDir=dist"');
        process.exit(1);
      }
      outDir = value;
      continue;
    }
    if (arg === "--json") {
      format = "json";
      continue;
    }
    if (arg === "--format") {
      const next = argv[++i];
      if (next !== "text" && next !== "json") {
        xError(`unknown "--format" value "${next ?? ""}" — expected "text" or "json"`);
        process.exit(1);
      }
      format = next;
      continue;
    }
    if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      if (value !== "text" && value !== "json") {
        xError(`unknown "--format" value "${value}" — expected "text" or "json"`);
        process.exit(1);
      }
      format = value;
      continue;
    }
    if (arg === "--dir") {
      const next = argv[++i];
      if (!next || next.startsWith("--")) {
        xError('"--dir" requires a path, e.g. "--dir src/lib/migrations"');
        process.exit(1);
      }
      migrateDir = next;
      continue;
    }
    if (arg.startsWith("--dir=")) {
      const value = arg.slice("--dir=".length);
      if (!value) {
        xError('"--dir=" requires a path, e.g. "--dir=src/lib/migrations"');
        process.exit(1);
      }
      migrateDir = value;
      continue;
    }
    if (arg === "--sqlite") {
      const next = argv[++i];
      if (!next || next.startsWith("--")) {
        xError('"--sqlite" requires a path, e.g. "--sqlite data/dev.db"');
        process.exit(1);
      }
      migrateSqlite = next;
      continue;
    }
    if (arg.startsWith("--sqlite=")) {
      const value = arg.slice("--sqlite=".length);
      if (!value) {
        xError('"--sqlite=" requires a path, e.g. "--sqlite=data/dev.db"');
        process.exit(1);
      }
      migrateSqlite = value;
      continue;
    }
    if (arg === "--postgres") {
      migratePostgres = true;
      continue;
    }
    rest.push(arg);
  }

  if (rest[0] === "run") rest.shift();

  return {
    command: rest[0],
    args: rest,
    cwd,
    adapter,
    outDir,
    format,
    migrateDir,
    migrateSqlite,
    migratePostgres,
  };
}

export { compileTailwindAsync } from "./tailwind.js";

const {
  command,
  args,
  cwd,
  adapter,
  outDir: outDirFlag,
  format,
  migrateDir: migrateDirFlag,
  migrateSqlite: migrateSqliteFlag,
  migratePostgres: migratePostgresFlag,
} = parseArgv(Bun.argv.slice(2));
const projectDir = cwd ? resolve(process.cwd(), cwd) : process.cwd();
const reporter: Reporter = format === "json" ? jsonReporter() : humanReporter();

/** Count route files under pagesDir/apiDir, mirroring doctor.ts's walk (excludes `_`-prefixed files/dirs). */
function countRoutes(pagesDir: string | undefined, apiDir: string | undefined): number {
  const walk = (dir: string): number => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return 0;
    }
    let count = 0;
    for (const entry of entries) {
      if (entry.startsWith("_") || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) count += walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) count += 1;
    }
    return count;
  };
  let total = pagesDir ? walk(pagesDir) : 0;
  if (apiDir && apiDir !== pagesDir) total += walk(apiDir);
  return total;
}

/** First non-loopback IPv4 address, if any, so a dev-server summary can show a LAN URL. */
function getNetworkUrl(port: number): string | undefined {
  try {
    const interfaces = networkInterfaces();
    for (const iface of Object.values(interfaces)) {
      for (const addr of iface ?? []) {
        if (addr.family === "IPv4" && !addr.internal) {
          return `http://${addr.address}:${port}`;
        }
      }
    }
  } catch {
    // no network interfaces available (sandboxed CI, etc.) — local URL only
  }
  return undefined;
}

async function detectOptions(): Promise<{ options: DetectedOptions; configPath: string | null }> {
  const configPath = findConfig(projectDir);
  if (configPath) {
    try {
      const mod = (await import(configPath)) as { default?: Record<string, unknown> };
      return { options: detectOptionsFromConfig(projectDir, mod.default ?? {}), configPath };
    } catch (err) {
      reporter.warn(`failed to load config: ${String(err)}`);
    }
  }

  return { options: detectDefaultOptions(projectDir), configPath: null };
}

/**
 * Resolve `@thexjs/core` relative to the project, or print the same
 * "node_modules/@thexjs is missing" hint doctor.ts gives and exit, instead of
 * letting `Bun.resolveSync`'s raw ResolveError reach the top-level error
 * boundary as a native stack trace.
 */
function resolveCoreOrExit(dir: string): string {
  try {
    return Bun.resolveSync("@thexjs/core", dir);
  } catch {
    xError('could not resolve "@thexjs/core" -- node_modules/@thexjs is missing');
    xError("run `bun install`");
    return process.exit(1);
  }
}

async function cmdDev(): Promise<void> {
  const startTime = performance.now();
  reporter.banner();
  const { options: opts } = await detectOptions();
  const corePath = resolveCoreOrExit(projectDir);
  const { createApp, installProcessCrashHandlers } = await import(corePath);
  const { port: _port, ...dirs } = opts;
  // createApp's own request logger (observability.logging, on by default)
  // prints its own "[x][request] ..." line plus a structured JSON log entry
  // per request — this CLI's `loggedFetch` wrapper below already reports an
  // equivalent `dev:request` event through the active Reporter, so in --json
  // mode core's logger is turned off to avoid duplicate, non-NDJSON lines on
  // stdout. Left on in human mode since it predates this issue and isn't a
  // content regression.
  if (format === "json") {
    dirs.observability = { ...dirs.observability, logging: false };
  }

  // Auto-compile Tailwind if a source entry exists
  const twInput = join(projectDir, "src/styles/globals.css");
  const twOutput = join(projectDir, "public/styles.css");
  if (existsSync(twInput)) {
    reporter.info("compiling Tailwind CSS...");
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync("bunx", ["tailwindcss", "-i", twInput, "-o", twOutput], {
      cwd: projectDir,
    });
    if (r.status !== 0) reporter.warn("Tailwind compilation failed, serving raw CSS.");
  }

  // Watch for CSS changes and recompile Tailwind. Must be async (`spawn`, not
  // `spawnSync`): the server is already serving requests by the time a save
  // lands, and Bun is single-threaded — a blocking recompile would freeze every
  // in-flight request and all live-reload sockets for the duration. The pre-boot
  // compile above stays sync, since nothing is serving yet at that point.
  const twSrc = join(projectDir, "src/styles");
  if (existsSync(twSrc)) {
    const { watch } = await import("node:fs");
    let twTimeout: ReturnType<typeof setTimeout> | null = null;
    watch(twSrc, { recursive: true }, (_event, filename) => {
      if (twTimeout) clearTimeout(twTimeout);
      const rebuildStart = performance.now();
      twTimeout = setTimeout(() => {
        const proc = compileTailwindAsync(twInput, twOutput, projectDir);
        proc.on("close", () => {
          reporter.devRebuild({
            reason: "file-change",
            ...(filename ? { file: relative(projectDir, join(twSrc, filename)) } : {}),
            durationMs: Math.round(performance.now() - rebuildStart),
          });
        });
      }, 200);
    }).on("error", (err: NodeJS.ErrnoException) => {
      reporter.warn(
        `Tailwind file watcher stopped (${err.code ?? err.message}) — restart dev server to resume CSS recompilation`,
      );
    });
  }

  // Report crashes outside the request lifecycle (module-eval throws, rejected
  // background promises) through the error reporter instead of dying silently.
  // Dev keeps serving after a crash so the next hot-reload can recover. The
  // prod server gets the same handlers but fails fast: build.ts's generated
  // entry passes exitOnCrash: true so the orchestrator restarts a clean box.
  installProcessCrashHandlers({ exitOnCrash: false });
  const app = await createApp({ ...dirs, development: true });

  // Wrap the app's fetch handler so every request is logged through the
  // active reporter (NDJSON `dev:request` events in --json mode, dim one-line
  // summaries in human mode) without reaching into createApp's internals.
  const originalFetch = app.fetch as (
    req: Request,
    server?: unknown,
  ) => Response | Promise<Response>;
  const loggedFetch = async (req: Request, bunServer?: unknown): Promise<Response> => {
    const reqStart = performance.now();
    const res = await originalFetch(req, bunServer);
    const url = new URL(req.url);
    reporter.devRequest({
      method: req.method,
      path: url.pathname,
      status: res.status,
      durationMs: Math.round(performance.now() - reqStart),
    });
    return res;
  };

  let port = opts.port;
  let server: ReturnType<typeof Bun.serve> | undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      server = Bun.serve({ ...app, fetch: loggedFetch, port });
      break;
    } catch (e) {
      if ((e as { code?: string })?.code === "EADDRINUSE") {
        port++;
        continue;
      }
      throw e;
    }
  }
  if (!server) {
    reporter.error("could not find an available port after 20 attempts");
    process.exit(1);
  }

  const startupMs = Math.round(performance.now() - startTime);
  const routeCount = countRoutes(opts.pagesDir, opts.apiDir);
  const networkUrl = getNetworkUrl(port);
  reporter.devReady({
    url: `http://localhost:${port}`,
    ...(networkUrl ? { networkUrl } : {}),
    routeCount,
    startupMs,
  });

  let shuttingDown = false;
  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    reporter.info(`received ${signal} - shutting down`);
    // Hard-cap fallback: if `stop(true)` hangs for any reason, don't leave the
    // terminal unresponsive forever.
    const exitFallback = setTimeout(() => process.exit(0), 3000);
    exitFallback.unref?.();
    void server?.stop(true).then(() => {
      clearTimeout(exitFallback);
      process.exit(0);
    });
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

interface ParsedBuildLine {
  step: string;
  message: string;
  /** This line restates info the caller already reports as a structured summary — drop it. */
  skip?: boolean;
  counts?: { staticCount: number; serverCount: number; contentCount: number };
  apiCount?: number;
}

/**
 * `@thexjs/core`'s `build()` (and the vercel/node adapters) log their own
 * `[static]`/`[content]`/`[server]`-tagged progress lines directly via
 * `console.log`/`console.warn` — data the CLI doesn't duplicate. Rather than
 * forking that logic into the CLI, `runBuildCapturingOutput` below intercepts
 * those calls for the duration of the build and re-emits each line through
 * the active Reporter as a `buildStep`, so nothing bypasses it and `--json`
 * mode never leaks raw text onto stdout. This function just classifies a line.
 */
function parseBuildLogLine(raw: string): ParsedBuildLine | undefined {
  const trimmed = raw.trim();

  let m = trimmed.match(/^\[x\] build: copied public\/ -> (.+)$/);
  if (m) return { step: "public", message: `copied public/ -> ${m[1]}` };

  m = trimmed.match(/^\[x\] build: (\d+) static, (\d+) server, (\d+) content pages?$/);
  if (m) {
    return {
      step: "scan",
      message: trimmed.replace(/^\[x\] build: /, ""),
      counts: {
        staticCount: Number(m[1]),
        serverCount: Number(m[2]),
        contentCount: Number(m[3]),
      },
    };
  }

  m = trimmed.match(/^\[static\] (.+)$/);
  if (m) return { step: "static", message: m[1] ?? trimmed };

  m = trimmed.match(/^\[content\] (.+)$/);
  if (m) return { step: "content", message: m[1] ?? trimmed };

  m = trimmed.match(/^\[islands\] (.+)$/);
  if (m) return { step: "islands", message: m[1] ?? trimmed };

  m = trimmed.match(/^\[server\] (\d+) page routes, (\d+) api routes -> (.+)$/);
  if (m) return { step: "server", message: trimmed, apiCount: Number(m[2] ?? 0) };

  m = trimmed.match(/^\[warn\] (.+)$/);
  if (m) return { step: "warn", message: m[1] ?? trimmed };

  if (trimmed.startsWith("[x] build complete ->")) {
    // Superseded by this command's own buildComplete() summary.
    return { step: "complete", message: trimmed, skip: true };
  }

  if (/no default export -- skipping$/.test(trimmed)) {
    return { step: "scan", message: trimmed };
  }

  return undefined;
}

interface BuildCounts {
  staticCount: number;
  serverCount: number;
  contentCount: number;
  apiCount: number;
}

/**
 * Runs `fn`, capturing every `console.log`/`console.warn` call made during
 * it (by `@thexjs/core`'s `build()` or an adapter) and replaying each line
 * through `reporter.buildStep` instead of letting it reach stdout directly.
 * Returns whatever counts were found in the captured lines, for the final
 * `buildComplete` summary.
 */
async function runBuildCapturingOutput(
  reporter: Reporter,
  buildStart: number,
  fn: () => Promise<void>,
): Promise<BuildCounts> {
  const counts: BuildCounts = { staticCount: 0, serverCount: 0, contentCount: 0, apiCount: 0 };
  const originalLog = console.log;
  const originalWarn = console.warn;

  const handle = (raw: string, isWarn: boolean): void => {
    const parsed = parseBuildLogLine(raw);
    if (parsed?.counts) {
      counts.staticCount = parsed.counts.staticCount;
      counts.serverCount = parsed.counts.serverCount;
      counts.contentCount = parsed.counts.contentCount;
    }
    if (parsed?.apiCount !== undefined) counts.apiCount = parsed.apiCount;
    if (parsed?.skip) return;
    reporter.buildStep({
      step: parsed?.step ?? "build",
      status: isWarn ? "warn" : "ok",
      message: parsed?.message ?? raw.trim(),
      durationMs: Math.round(performance.now() - buildStart),
    });
  };

  console.log = (...args: unknown[]) => handle(args.map(String).join(" "), false);
  console.warn = (...args: unknown[]) => handle(args.map(String).join(" "), true);
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
  return counts;
}

async function cmdBuild(adapterName: string | undefined): Promise<void> {
  const { options: opts, configPath } = await detectOptions();

  reporter.buildStart();
  const start = performance.now();

  // Compile Tailwind for production
  const twInput = join(projectDir, "src/styles/globals.css");
  const twOutput = join(projectDir, "public/styles.css");
  if (existsSync(twInput)) {
    reporter.buildStep({ step: "tailwind", status: "ok", message: "compiling Tailwind CSS..." });
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync("bunx", ["tailwindcss", "-i", twInput, "-o", twOutput, "--minify"], {
      cwd: projectDir,
    });
    if (r.status !== 0) {
      reporter.buildStep({
        step: "tailwind",
        status: "warn",
        message: "Tailwind compilation failed.",
      });
    }
  }

  const {
    port: _port,
    security: _security,
    observability: _observability,
    images: _images,
    ...rest
  } = opts;

  if (adapterName === "vercel") {
    let buildVercelOutput: (options: Record<string, unknown>) => Promise<void>;
    try {
      ({ buildVercelOutput } = await import("@thexjs/adapter-vercel"));
    } catch {
      reporter.error('"--adapter vercel" requires @thexjs/adapter-vercel.');
      reporter.error("install it with: bun add -d @thexjs/adapter-vercel");
      process.exit(1);
    }
    const counts = await runBuildCapturingOutput(reporter, start, () =>
      buildVercelOutput({
        ...rest,
        ...(opts.security ? { security: opts.security } : {}),
        ...(opts.observability ? { observability: opts.observability } : {}),
        ...(opts.images ? { images: opts.images } : {}),
        projectRoot: projectDir,
      }),
    );
    const ms = Math.round(performance.now() - start);
    reporter.buildComplete({ durationMs: ms, outDir: ".vercel/output", ...counts });
    return;
  }

  if (adapterName === "node") {
    let buildNodeOutput: (options: Record<string, unknown>) => Promise<void>;
    try {
      ({ buildNodeOutput } = await import("@thexjs/adapter-node"));
    } catch {
      reporter.error('"--adapter node" requires @thexjs/adapter-node.');
      reporter.error("install it with: bun add -d @thexjs/adapter-node");
      process.exit(1);
    }
    const counts = await runBuildCapturingOutput(reporter, start, () =>
      buildNodeOutput({
        ...rest,
        ...(opts.security ? { security: opts.security } : {}),
        ...(opts.observability ? { observability: opts.observability } : {}),
        ...(opts.images ? { images: opts.images } : {}),
        projectRoot: projectDir,
      }),
    );
    const ms = Math.round(performance.now() - start);
    reporter.buildComplete({ durationMs: ms, outDir: "dist-node", ...counts });
    return;
  }

  if (adapterName) {
    reporter.error(`unknown adapter "${adapterName}"`);
    process.exit(1);
  }

  const corePath = resolveCoreOrExit(projectDir);
  const { build } = await import(corePath);
  const outDir = resolve(projectDir, outDirFlag ?? ".x");
  const counts = await runBuildCapturingOutput(reporter, start, () =>
    build({
      ...rest,
      outDir,
      ...(configPath ? { configPath } : {}),
    }),
  );

  const ms = Math.round(performance.now() - start);
  reporter.buildComplete({
    durationMs: ms,
    outDir: relative(projectDir, outDir),
    ...counts,
  });
}

async function cmdStart(): Promise<void> {
  const outDir = resolve(projectDir, outDirFlag ?? ".x");
  const serverEntry = join(outDir, "server", "index.ts");

  if (!existsSync(serverEntry)) {
    const clientDir = join(outDir, "client");
    if (existsSync(join(clientDir, "index.html"))) {
      await serveStaticBuild(clientDir);
      return;
    }
    reporter.error(`no built server found at ${serverEntry}`);
    reporter.error('run "x build" first');
    process.exit(1);
  }

  // The generated server entry (core/build.ts) prints its own
  // "[x] production server running at <url>" line via plain console.log —
  // it's a separate process, outside this CLI's Reporter. Pipe its stdio
  // instead of inheriting it, so that one line (and its shutdown message)
  // can be parsed and replayed through the active Reporter — keeping output
  // a single clean line in human mode and valid NDJSON in --json mode.
  const proc = spawn("bun", [serverEntry], {
    stdio: ["inherit", "pipe", "pipe"],
    cwd: projectDir,
    env: { ...process.env, NODE_ENV: "production" },
  });

  const handleChildLine = (raw: string, isStderr: boolean): void => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const ready = trimmed.match(/^\[x\] production server running at (.+)$/);
    if (ready) {
      reporter.startReady({ url: ready[1] as string });
      return;
    }
    if (isStderr) reporter.error(trimmed);
    else reporter.info(trimmed);
  };

  const pipeLines = (stream: NodeJS.ReadableStream | null, isStderr: boolean): void => {
    let buffer = "";
    stream?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handleChildLine(line, isStderr);
    });
  };

  // `spawn()`'s return type here is typed against bun-types' lightweight
  // `child_process` stub (this project doesn't pull in `@types/node`), which
  // doesn't declare EventEmitter methods like `.on()` or the stdio streams'
  // own `.on("data", ...)`, even though Bun's actual runtime child process
  // object supports them. Cast narrowly rather than widening the whole
  // file's node:child_process typing.
  const typedProc = proc as unknown as {
    stdout: NodeJS.ReadableStream | null;
    stderr: NodeJS.ReadableStream | null;
    on(event: "exit", listener: (code: number | null) => void): void;
    on(event: "error", listener: (err: Error) => void): void;
  };
  pipeLines(typedProc.stdout, false);
  pipeLines(typedProc.stderr, true);
  typedProc.on("exit", (code) => process.exit(code ?? 1));
  typedProc.on("error", (err) => {
    reporter.error(`failed to start bun: ${err.message}`);
    reporter.error("ensure bun is installed — https://bun.sh");
    process.exit(1);
  });
}

async function serveStaticBuild(clientDir: string): Promise<void> {
  const port = Number(process.env.PORT) || 3000;
  reporter.startReady({ url: `http://localhost:${port}` });
  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      let pathname: string;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return new Response("Bad request", { status: 400 });
      }
      if (pathname === "/") pathname = "/index.html";
      const filePath = resolve(clientDir, pathname.startsWith("/") ? pathname.slice(1) : pathname);
      if (!filePath.startsWith(resolve(clientDir) + sep)) {
        return new Response("Forbidden", { status: 403 });
      }
      const file = Bun.file(filePath);
      if (await file.exists()) return new Response(file);
      const index = Bun.file(join(clientDir, "index.html"));
      return new Response(index);
    },
  });
}

/**
 * `x migrate down [N]`: rolls back N applied migrations (default 1) by
 * running each one's `*.down.sql` sibling and removing its bookkeeping row.
 * Backend selection mirrors `connectPostgres`'s own default: use Postgres
 * when `--postgres` is passed or `DATABASE_URL` is set (unless `--sqlite`
 * explicitly asks for SQLite instead); otherwise SQLite.
 */
async function cmdMigrateDown(stepsArg: string | undefined): Promise<void> {
  let steps = 1;
  if (stepsArg !== undefined) {
    steps = Number(stepsArg);
    if (!Number.isInteger(steps) || steps <= 0) {
      xError(`invalid step count "${stepsArg}" -- expected a positive integer`);
      process.exit(1);
    }
  }

  const dir = resolve(projectDir, migrateDirFlag ?? "src/lib/migrations");
  if (!existsSync(dir)) {
    xError(`no migrations directory found at ${relative(projectDir, dir)}`);
    xError('pass "--dir <path>" to point at your migrations directory');
    process.exit(1);
  }

  const usePostgres =
    migratePostgresFlag || (!migrateSqliteFlag && Boolean(process.env.DATABASE_URL));

  const dataPath = Bun.resolveSync("@thexjs/core/data", projectDir);

  if (usePostgres) {
    const { connectPostgres, rollbackPostgresMigrations } = (await import(dataPath)) as {
      connectPostgres: typeof import("@thexjs/core/data").connectPostgres;
      rollbackPostgresMigrations: typeof import("@thexjs/core/data").rollbackPostgresMigrations;
    };
    const client = connectPostgres();
    try {
      const result = await rollbackPostgresMigrations(client, dir, steps);
      reportRollback(result);
    } finally {
      (client as unknown as { close?(): void }).close?.();
    }
    return;
  }

  const { connectSQLite, rollbackSQLiteMigrations } = (await import(dataPath)) as {
    connectSQLite: typeof import("@thexjs/core/data").connectSQLite;
    rollbackSQLiteMigrations: typeof import("@thexjs/core/data").rollbackSQLiteMigrations;
  };
  const sqlitePath = resolve(projectDir, migrateSqliteFlag ?? "data/dev.db");
  if (!existsSync(sqlitePath)) {
    xError(`no SQLite database found at ${relative(projectDir, sqlitePath)}`);
    xError('pass "--sqlite <path>" to point at your database file');
    process.exit(1);
  }
  const db = connectSQLite({ path: sqlitePath });
  const result = rollbackSQLiteMigrations(db, dir, steps);
  reportRollback(result);
}

function reportRollback(result: { rolledBack: string[]; skipped: string[] }): void {
  if (result.rolledBack.length === 0 && result.skipped.length === 0) {
    xInfo("nothing to roll back");
    return;
  }
  for (const name of result.rolledBack) xSuccess(`rolled back: ${name}`);
  for (const name of result.skipped) {
    xWarn(`no down migration for "${name}" -- stopped rollback here`);
  }
  if (result.skipped.length > 0) process.exitCode = 1;
}

function printVersion(): void {
  try {
    const pkgPath = join(import.meta.dir, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    console.log(pkg.version ?? "0.0.1");
  } catch {
    console.log("0.0.1");
  }
}

function printHelp(): void {
  console.log(`x — full-stack React framework on Bun

Usage:
  x <command> [options]

Commands:
  dev            Start the development server with hot reload
  build          Build for production (static export + server bundle -> .x/)
  start          Start the production server (run "x build" first)
  doctor         Diagnose the project: config, dirs, env isolation, dependency health
  migrate down [N]  Roll back N applied migrations (default 1), most-recently-applied first

Options:
  --cwd <dir>          Run as if started inside <dir> (default: current directory)
  --adapter <name>     "build" target adapter, e.g. "vercel" (default: Bun server -> .x/)
  --outDir <dir>       Output directory for "build"/"start" (default: .x)
  --json               Machine-readable NDJSON output on stdout (errors on stderr); alias for --format json
  --format <text|json> Output format: "text" (default, human-readable) or "json" (NDJSON)
  --dir <path>         Migrations directory for "migrate down" (default: src/lib/migrations)
  --sqlite <path>      SQLite database file for "migrate down" (default: data/dev.db)
  --postgres           Use Postgres for "migrate down" (reads DATABASE_URL)
  -h, --help           Show this help message
  -v, --version        Print the CLI version

Tip: "x run dev" also works, as an alias for "x dev".
Tip: "x build --adapter vercel" emits a .vercel/output tree (Build Output API v3),
     no vercel.json needed. Requires @thexjs/adapter-vercel as a dependency.
Tip: "x build --json | jq ." streams one JSON object per line (build:start/build:step/build:complete) for tools and CI.
Tip: "x migrate down" rolls back SQLite by default, or Postgres automatically
     when DATABASE_URL is set (or pass --postgres explicitly).`);
}

async function main(): Promise<void> {
  if (command === "--version" || command === "-v") {
    printVersion();
    return;
  }

  // Production builds must resolve React (and any other NODE_ENV-conditional
  // packages) to their production builds. Bun keys that off NODE_ENV at
  // process spawn -- mutating process.env afterward has no effect on
  // Bun.build -- so re-exec the build under NODE_ENV=production once.
  if (command === "build" && process.env.NODE_ENV !== "production") {
    const script = process.argv[1] ?? import.meta.path;
    const res = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
      stdio: "inherit",
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "production" },
    });
    process.exit(res.status ?? 1);
  }

  switch (command) {
    case "dev":
      await cmdDev();
      break;
    case "build":
      await cmdBuild(adapter);
      break;
    case "start":
      await cmdStart();
      break;
    case "doctor":
      process.exitCode = await runDoctor(projectDir);
      break;
    case "migrate": {
      const sub = args[1];
      if (sub === "down") {
        await cmdMigrateDown(args[2]);
      } else {
        xError(`unknown "migrate" subcommand "${sub ?? ""}"`);
        xError("usage: x migrate down [N]");
        process.exit(1);
      }
      break;
    }
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      // Bare `x` (no command) is a usage error → exit 1.
      // `x --help` / `x -h` is an explicit request → exit 0.
      if (command === undefined) process.exitCode = 1;
      break;
    default:
      reporter.error(`unknown command "${command}"`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  // Top-level error boundary: anything that escapes a command (a throwing
  // x.config.ts, Bun.resolveSync failures we didn't pre-empt, EACCES on a
  // port bind, etc.) is reported through the same styled xError output as
  // the rest of the CLI, instead of a raw native stack trace -- mirroring
  // create-thexjs-app's own top-level boundary.
  xError(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
