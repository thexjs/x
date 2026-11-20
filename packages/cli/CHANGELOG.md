# @thexjs/cli

## 1.3.0

### Minor Changes

- 07ed0bd: Add down-migrations/rollback to the data layer and a CLI runner for it.

  `@thexjs/core/data` gains `rollbackSQLiteMigrations` and `rollbackPostgresMigrations`: each rolls back up to N applied migrations (default 1), most-recently-applied first, by running an optional `*.down.sql` sibling of the up-migration file (e.g. `001_create_users.sql` / `001_create_users.down.sql`) and removing its `_x_migrations` bookkeeping row. A migration with no down file can't be reverted, so rollback stops there instead of silently skipping past it. Existing migrations with no down file keep working exactly as before.

  `@thexjs/cli` adds `x migrate down [N]`, rolling back against SQLite (`--sqlite <path>`, default `data/dev.db`) or Postgres (`--postgres`, or automatically when `DATABASE_URL` is set), reading migrations from `--dir <path>` (default `src/lib/migrations`).
- 8c77122: Add a `Reporter` abstraction (`packages/cli/src/reporter.ts`) that every CLI command path now routes through instead of calling `console.log` ad hoc. `x dev` prints a settled startup summary (local/network URL, route count, startup time) followed by live request lines; `x build` prints a step-by-step list with per-step timing ending in the existing `N static, N server, N api routes -> <dir>` summary; `x start` prints a single clean "production server running at `<url>`" line. ANSI colors are now automatically stripped when stdout isn't a TTY (piped to a file/tool) or `NO_COLOR` is set.

  Adds a machine-readable mode: `--json` (or `--format json`) emits one JSON object per line (NDJSON) on stdout for events like `build:start`/`build:step`/`build:complete`, `dev:ready`/`dev:request`/`dev:rebuild`, and `start:ready`; errors go to stderr as `{"event":"...:error","message","stack"}`. Exit codes are unchanged — a failed build still fails. `--format text` is the default, human-readable mode; an unknown `--format` value fails with a clear error, matching the existing `--adapter` error style.

### Patch Changes

- Updated dependencies [a91bdd8]
- Updated dependencies [07ed0bd]
  - @thexjs/core@1.14.0

## 1.2.0

### Minor Changes

- 6d46c47: Add `x build --adapter node`, wiring the new `@thexjs/adapter-node` package into the CLI the same way `--adapter vercel` is wired to `@thexjs/adapter-vercel` (optional peer dependency, dynamic import with a friendly error if it isn't installed).

### Patch Changes

- c5a3f0f: Bump `tsup` devDependency to 9.0.0 across all packages, and `react`/`@types/react`/`react-dom`/`@types/react-dom` to 19.3.x where applicable (`@thexjs/core`, `@thexjs/hooks`, `@thexjs/adapter-vercel`, `@thexjs/cli`).
- Updated dependencies [6d46c47]
- Updated dependencies [c5a3f0f]
- Updated dependencies [4b1e66b]
- Updated dependencies [801184e]
  - @thexjs/adapter-node@0.1.0
  - @thexjs/core@1.10.0
  - @thexjs/adapter-vercel@1.0.14

## 1.1.7

### Patch Changes

- d306e11: Wire the existing bounded backpressure primitive into the public `createApp` / `defineConfig` surface, propagate the option through dev, production build/start, and adapter manifests, and document the per-process overload semantics. Saturated requests return 503 + `Retry-After`; queued client disconnects are removed without becoming false 500s.
- Updated dependencies [d306e11]
  - @thexjs/core@1.9.0

## 1.1.6

### Patch Changes

- 3abc948: Pass `exitOnCrash: false` explicitly when the dev server installs its process crash handlers, so an uncaught exception outside the request lifecycle is reported through the error reporter instead of silently killing `x dev`. The prod generated entry continues to fail fast (`exitOnCrash: true`).
- Updated dependencies [c453015]
  - @thexjs/core@1.8.2

## 1.1.5

### Patch Changes

- 553f7bc: Fix a flaky `tailwind.test.ts` serialization test that intermittently failed CI (`Test / ubuntu-latest`) due to a missing-file race in `readFileSync` and a start-timing race after process close. The compile-serialization contract is preserved.

## 1.1.4

### Patch Changes

- 65c03ea: `x start`: add an `error` event listener on the spawned `bun` process so that a missing `bun` on `PATH` prints a friendly installation message instead of a raw ENOENT stack trace.

  `x dev`: add an `error` event listener on the Tailwind file watcher so that inotify exhaustion or directory removal logs a clear warning instead of silently dying.
- 2c1bc35: Document the intentional exit-code asymmetry: bare `x` exits 1 (usage error), `x --help` exits 0 (explicit request). Comment only, no behavior change.
- 65c03ea: `x dev`: add an `error` event listener on the Tailwind file watcher so that inotify exhaustion or directory removal logs a clear warning instead of silently dying.
- Updated dependencies [d9da82e]
  - @thexjs/core@1.7.1

## 1.1.3

### Patch Changes

- b567ad5: Fix the `doctor` version-consistency check to evaluate real semver ranges instead of silently skipping `^`/`~` dependencies, which are what generated projects use.

## 1.1.2

### Patch Changes

- 3234581: Contain process-level crashes and route them to the error reporter (closes #85):
  - New `installProcessCrashHandlers()` helper (exported from `@thexjs/core`)
    registers `uncaughtException`/`unhandledRejection` handlers that log the
    crash and report it through the configured error reporter, so a throw
    outside the request lifecycle (module-eval error, rejected background
    promise) is surfaced instead of dying silently. The optional `exitOnCrash`
    flag opts into crash-on-error semantics for supervisor-managed deploys.
  - The generated production server entry now installs these via the shared
    helper instead of inline code, and `x dev` installs identical handlers on the
    dev server — closing the gap where dev had no crash reporting at all.
  - The top-of-fetch boundary (`guardFetchErrors`), the `Bun.serve` `error`
    hook, guarded revalidation JSON parsing and streaming-pump controller
    handling for #92 were already in place; this adds coverage proving a broken
    shared rate-limit store (e.g. Redis outage) surfaces as a 500 while the box
    keeps answering `/healthz`.
  - Worker/subprocess isolation was evaluated and rejected for SSR: per-request
    workers would re-render the whole module graph and provide no isolation for
    shared state/DB; serverless deploys already provide that boundary. Left for
    the threat-model doc (#80).
- Updated dependencies [d628d5e]
- Updated dependencies [88902c4]
- Updated dependencies [167bded]
- Updated dependencies [4361c32]
- Updated dependencies [193cc6a]
- Updated dependencies [3234581]
- Updated dependencies [f1c55a0]
- Updated dependencies [8f9a8bf]
- Updated dependencies [7dee9e6]
  - @thexjs/core@1.3.6

## 1.1.1

### Patch Changes

- b22e149: chore(deps-dev): bump @biomejs/biome from 1.9.4 to 2.5.8 and migrate config (formatting/lint fixes only)
- Updated dependencies [b22e149]
  - @thexjs/core@1.2.4
  - @thexjs/adapter-vercel@1.0.5

## 1.1.0

### Minor Changes

- 43fa19d: Add `x doctor`: a project diagnostics command that checks Bun version, config
  presence/parse, expected directories (pages/api/actions/layouts/content/public),
  route-tree compilation, installed `@thexjs/*` packages, and -- for production
  envs -- server-only env access across pages/actions and a missing `AUTH_SECRET`.
  Exits non-zero when problems are found.

### Patch Changes

- Updated dependencies [fbd5e29]
- Updated dependencies [58aa123]
  - @thexjs/core@1.2.0
  - @thexjs/adapter-vercel@1.0.1

## 1.0.0

### Major Changes

- b010e14: Release 1.0.0 of all packages.

### Patch Changes

- Updated dependencies [b010e14]
  - @thexjs/adapter-vercel@1.0.0
  - @thexjs/core@1.0.0

## 0.1.8

### Patch Changes

- 72ca613: Add runtime test coverage for the request pipeline, server actions, image
  proxy, env validation, Vercel build output, and the CLI; add release
  automation (changesets + CI enforcement).
- Updated dependencies [72ca613]
  - @thexjs/core@0.1.7
  - @thexjs/adapter-vercel@0.1.4
