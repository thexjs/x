<p align="center">
  <a href="#">
    <img src="examples/landing/public/icon-512.png" alt="Thexjs logo" width="128" height="128">
  </a>
</p>

<p align="center">
A full-stack React framework built natively on Bun — file-based routing, SSR/SSG, API routes, and server actions in one process, with security defaults (CSP, CSRF, rate limiting) baked in rather than bolted on.
</p>

<p align="center">
<a href="#quick-start"><img src="https://img.shields.io/badge/Bun-1.4+-black?style=flat-square&logo=bun" alt="Bun Ready"></a>
<a href="#what-x-does-differently"><img src="https://img.shields.io/badge/React-19-blue?style=flat-square&logo=react" alt="React 19"></a>
<a href="#what-x-does-differently"><img src="https://img.shields.io/badge/TypeScript-Strict-blue?style=flat-square&logo=typescript" alt="TypeScript"></a>
<a href="./ROADMAP.md"><img src="https://img.shields.io/badge/Status-Maintenance-yellow?style=flat-square" alt="Status"></a>
<a href="https://stardance.hackclub.com/projects/41081"><img src="https://img.shields.io/badge/Stardance-hackclub-blue?style=flat-square" alt="Stardance"></a>
</p>

## Quick start

```bash
bun create thexjs-app@latest my-app
cd my-app
bun run dev
```

The scaffolder is feature-based — pick `tailwind`, `auth`, `content`, `hooks`, `shadcn`, any combination, or nothing for a blank page. Non-interactive: `--tailwind --auth`; `--no-install` / `--no-git` skip those steps.

## What x does differently

Most "fast, modern React framework" pitches mean the same few things. These are the parts of `x` that are actually structurally different, not just styled differently:

- **One runtime, not a stack of tools wearing a runtime's clothes.** Bundler, package manager, SQLite/Postgres drivers, and the HTTP server are all Bun natively — no separate bundler process negotiating with a separate server runtime. Fewer handoffs, fewer places for two tools' assumptions to disagree.
- **Secrets are isolated structurally, not by convention.** A server action's body is swapped for a generated `fetch` wrapper _before_ the client bundler ever reads the real source (`actionsRewritePlugin`) — a leaked `DATABASE_URL` or `STRIPE_SECRET_KEY` in client code isn't "unlikely," it's excluded from the bundle at the file level. A regex scanner (`assertNoEnvLeakage`) runs after as a second check, not the only one.
- **Security is a framework default, not an app author's homework.** CSP (with per-request nonces), CSRF double-submit checks, rate limiting, and a brute-force guard are on by default in `createApp` — most frameworks leave all of this to middleware you write yourself or the hosting platform's edge config.

See [docs/README.md](docs/README.md) for the full feature-by-feature walkthrough (routing, layouts, content collections, the `<Image>` component, auth, data layer) and the founder's own account of what was hard to get right.

## AI-native by design

`x` is built assuming most people writing it — including experienced devs — reach for an AI coding agent to get things done. The problem: a general-purpose agent will confidently write Next.js/Remix/TanStack Start syntax that _looks_ like `x` but isn't, because file-based routing conventions across frameworks are close enough to be dangerous.

Two things ground an agent in `x`'s actual conventions instead of its training data's best guess:

- **[`@thexjs/mcp`](packages/mcp/README.md)** — an MCP server exposing `list_topics`, `get_docs`, `search_docs`, and `scaffold_file` tools, so an agent can look up the real routing/loader/action/middleware contract instead of guessing. Every project scaffolded with `bun create thexjs-app@latest` wires it up automatically — `.mcp.json` for Claude Code, `.cursor/mcp.json` for Cursor, no setup step.
- **`AGENTS.md`** (+ a `CLAUDE.md` pointer) — shipped in every scaffolded project as the fallback for any agent without MCP access: routing conventions, the server-action contract, the env-var prefix rule, and the gotchas that actually bite.

This isn't a bolt-on "AI features" section — it's the same instinct as the security defaults above: don't make the person building on `x` responsible for keeping an agent from confidently doing the wrong thing.

## What's inside

```
packages/core              file-based router, SSR/SSG renderer, middleware, security defaults
packages/cli                x dev / x build / x start
packages/env                 typed env variable validation
packages/auth               credentials + OAuth2/GitHub auth, sessions, CSRF, RBAC
packages/hooks               client-side hook helpers (useDebounce, useForm, useServerAction, ...)
packages/adapter-vercel      Vercel Build Output API adapter
packages/adapter-node        standalone Node.js adapter (Railway, Render, a bare VPS — no Bun at runtime)
packages/create-thexjs-app   the scaffolder (bun create thexjs-app@latest)
packages/mcp                 MCP server so AI agents get x's conventions right, not a guess
examples/default             minimal starter
examples/basic               pages, API routes, auth, dashboard
examples/landing             x's own docs site
examples/blog                content collections demo
examples/saas                SaaS dashboard demo
```

A typical project:

```
my-app/
  x.config.ts
  src/
    pages/       # file-based routes
    layouts/     # nested layouts (_layout.tsx)
    api/         # REST endpoints
    actions/     # server functions
  content/       # markdown collections
```

## Bring your own runtime

A fair worry with a solo-maintained framework: what happens to your app if
the project stalls? For `x`, less than it would for a framework that only
runs on its own hosting platform — `x` doesn't have one.

- **Bun process** — the default. `x build` + `bun dist/server/index.ts` on
  any VPS, bare metal, or behind `systemd`/`pm2`.
- **Docker** — the multi-stage [`Dockerfile`](./Dockerfile) at the repo root
  builds and runs any example as a container; works on any OCI host.
- **Vercel** — [`@thexjs/adapter-vercel`](packages/adapter-vercel) emits a
  real Build Output API v3 tree, no `vercel.json` needed.
- **Node-only hosts (Railway, Render, a bare VPS)** —
  [`@thexjs/adapter-node`](packages/adapter-node) produces a standalone
  server with zero Bun dependency at runtime.
- **Fly.io** — a committed [`fly.toml`](./fly.toml) builds the same Docker
  image above.
- **Anything else** — adapters aren't special-cased into the framework; both
  of the ones above are ordinary consumers of the adapter SDK exported from
  `@thexjs/core/adapter`. Writing a new one is scoped work, not a fork.

None of this requires touching your app code to move — see
[DEPLOY.md](./DEPLOY.md) for the full walkthrough of every target above, plus
how to write your own adapter.

## Status

**Pre-1.0, in maintenance mode.** The author is busy with college; reviews and merges happen on a best-effort weekly cadence, and the project leans on community contributors for everything beyond that. The API is still settling — expect breaking changes between minor releases on pre-1.0 packages, and pin exact versions if that matters to you. None of that is a disclaimer to skip past: treat `x` as something to learn from, prototype with, or build something small on — not yet a dependency a team should bet production on without reading [ROADMAP.md](./ROADMAP.md)'s honest accounting of what's stable versus still moving.

What _is_ unusually solid for a project at this stage: CI runs SBOM generation, CVE scanning on both the dependency tree and the built Docker image, and SLO-gated load tests on every merge — not something bolted on after an incident. See [ROADMAP.md](./ROADMAP.md) for the full API stability matrix and enterprise-readiness tracking.

## Docs

- Full story + feature walkthrough: [docs/README.md](docs/README.md)
- Hosted docs: https://thexjs.abdelkabir.me/docs
- Roadmap & API stability matrix: [ROADMAP.md](./ROADMAP.md)
- Security policy: [SECURITY.md](./SECURITY.md) · Threat model: [THREAT_MODEL.md](./THREAT_MODEL.md)
- Data retention & deletion: [DATA_POLICIES.md](./DATA_POLICIES.md)
- Support & versioning: [SUPPORT.md](./SUPPORT.md) · [VERSIONING.md](./VERSIONING.md)
- Benchmarks & SLOs: [BENCHMARKS.md](./BENCHMARKS.md)
- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)

MIT licensed. Feedback and issues welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for how review and release actually work here.
