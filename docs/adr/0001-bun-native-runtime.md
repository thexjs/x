---

## status: accepted

# Bun-native runtime, not a Node framework that happens to run under Bun

`x` runs its bundler, package manager, SQLite/Postgres drivers, and HTTP server all through Bun's own APIs (`Bun.serve()`, `Bun.build()`, `bun:sqlite`, `Bun.sql`) rather than wrapping Node-ecosystem equivalents (webpack/esbuild, `pg`/`better-sqlite3`, Express) and running them under Bun's Node-compatibility layer.

We picked this knowing it narrows the ecosystem `x` can lean on compared to a Node-targeting framework, and that it couples the framework tightly to Bun's own API surface and release cadence. The payoff is fewer handoffs: no separate bundler process negotiating with a separate server runtime, no translation layer between the dev server and the build tool, and meaningfully simpler internals because there's one runtime's assumptions to satisfy instead of two.

## Consequences

- Deployment targets that can't run Bun (most traditional Node-only PaaS) need an adapter that produces Node-runnable output (`@thexjs/adapter-node`'s `transpileModules` step) rather than running Bun in production directly.
- Edge runtimes with their own JS engine (Cloudflare Workers, Vercel Edge Functions) are a separate compatibility question from "runs under Bun" — see ADR-0011 for the specific gap this creates in `@thexjs/auth`.
