# @thexjs/env

## 1.2.0

### Minor Changes

- ea323cf: `createEnv()` now also returns `client` and `server` structural sub-objects alongside the existing flat top-level keys. `env.client` contains only the keys that passed the `clientPrefix` check — it's the structurally-safe shape to serialize for a hydration payload (`window.__ENV__ = env.client`), since it can never carry a server secret even if the schema grows one later. `env.server` mirrors the server-only keys, for symmetry. This is additive: every existing flat `env.SOME_KEY` access keeps working unchanged.

### Patch Changes

- ea43222: Document why the `input as T` cast in `oneOf()` is safe (it relies on the preceding `values.includes()` guard). Docs-only, no behavior change.

## 1.1.2

### Patch Changes

- e579b57: Reformat README.md for the biome 2.6.8 upgrade (blank line before/after a bulleted list). Docs-only, no behavior change.

## 1.1.1

### Patch Changes

- c5a3f0f: Bump `tsup` devDependency to 9.0.0 across all packages, and `react`/`@types/react`/`react-dom`/`@types/react-dom` to 19.3.x where applicable (`@thexjs/core`, `@thexjs/hooks`, `@thexjs/adapter-vercel`, `@thexjs/cli`).

## 1.1.0

### Minor Changes

- e795002: Add `optional()` and `default()` combinators to every built-in env validator:
  - `num().optional()` → `number | undefined`, missing variable no longer fails
    validation; a present but invalid value still throws
  - `num().default(3000)` → `number`, missing variable yields the fallback; a
    present but invalid value still throws
  - Combinators chain, e.g. `oneOf(["dev", "prod"] as const).default("dev")`

  Missing optional vars now pass through `createEnv` instead of failing the
  whole validation, so legitimately-optional variables (feature flags,
  `SENTRY_DSN`, …) no longer need empty placeholder values.

## 1.0.2

### Patch Changes

- b22e149: chore(deps-dev): bump @biomejs/biome from 1.9.4 to 2.5.8 and migrate config (formatting/lint fixes only)

## 1.0.1

### Patch Changes

- c8e7985: `num()` now rejects empty/whitespace-only strings. Previously an empty numeric
  env var (e.g. `PORT=`) silently parsed as `0`.

## 1.0.0

### Major Changes

- b010e14: Release 1.0.0 of all packages.

## 0.1.5

### Patch Changes

- 72ca613: Add runtime test coverage for the request pipeline, server actions, image
  proxy, env validation, Vercel build output, and the CLI; add release
  automation (changesets + CI enforcement).
