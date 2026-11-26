# AGENTS.md x framework (Bun + React)

## What is this?

`x` is a full-stack React framework built natively on Bun. Monorepo with workspaces: `packages/*` (framework) and `examples/*` (dogfood apps).

## Quick commands

```bash
# Install + build all packages (postinstall runs automatically)
bun install

# Dev loop — builds packages then starts examples/basic
bun run dev

# Lint + format
bun run lint          # biome check .
bun run lint:fix      # biome check --write .

# Typecheck every package + example
bun run typecheck

# Run all tests
bun test
```

## Package layout

```
packages/core              framework runtime (router, SSR/SSG, islands, server functions, data layer)
packages/auth              credentials + OAuth2/GitHub auth, sessions, CSRF
packages/cli               `x dev` / `x build` / `x start` CLI
packages/env               type-safe env var validation
packages/hooks             client-side React hook helpers
packages/adapter-vercel      Vercel Build Output API adapter
packages/create-thexjs-app   `bun create thexjs-app@latest` scaffolder
packages/mcp                 MCP server exposing x's docs/conventions as tools for coding agents
examples/basic             full demo: pages, API routes, auth, dashboard
examples/default           minimal starter
examples/landing           x's own docs site
examples/blog              content collections demo
examples/saas              SaaS dashboard demo
```

## CLI usage

The CLI is `packages/cli/src/index.ts`. Run it directly with `bun`:

```bash
# From an example directory
bun ../../packages/cli/src/index.ts dev
bun ../../packages/cli/src/index.ts build
bun ../../packages/cli/src/index.ts start

# Or after postinstall links it globally
x dev
x build
x start

# x run dev  also works (alias)
# x build --adapter vercel  emits .vercel/output (requires @thexjs/adapter-vercel)
# x build --outDir dist  writes the build to ./dist (Dockerfile/DEPLOY.md use this)
# --cwd <dir>  run as if from another directory
```

## Build output

- `x build` writes to `.x/` (configurable via `--outDir` or `outDir`)
- `.x/client/` — static HTML, island JS chunks, public assets
- `.x/server/index.ts` — generated server entry (run with `x start` or `bun .x/server/index.ts`)
- `x start` runs the production server from `.x/server/`
- The generated server entry handles `SIGTERM`/`SIGINT` gracefully (stops
  accepting connections, flushes the error reporter, drains for 3s, exits)

## File-based routing conventions

Routes are scanned from `pagesDir` (default `src/pages`). The `_` prefix is reserved:

| File pattern     | Behavior                                       |
| ---------------- | ---------------------------------------------- |
| `index.tsx`      | Route `/`                                      |
| `about.tsx`      | Route `/about`                                 |
| `[slug].tsx`     | Dynamic segment, param in `loader({ params })` |
| `[...slug].tsx`  | Catch-all, param is full remaining path        |
| `_layout.tsx`    | Nested layout for that directory               |
| `_middleware.ts` | Middleware for that directory (onion pattern)  |
| `_404.tsx`       | Custom 404 page                                |
| `api/*.ts`       | API route (if in `apiDir` or `pages/api/`)     |

**API routes** export `GET`, `POST`, `PUT`, `PATCH`, `DELETE` handlers. Each receives the `Request` and returns a `Response`.

**Page routes** export a default React component. Optional exports:

- `export const mode = "static"` — prerender at build time (default: `"server"`)
- `export const revalidate = 3600` — ISR: cache for N seconds
- `export async function loader({ params, request })` — runs server-side, data passed as `loaderData`
- `export const middleware` — route-level middleware (alternative to `_middleware.ts`)
- `export const seo = { title, description, canonical, robots, openGraph, twitter, jsonLd }` — static per-page SEO (`SeoData` from `@thexjs/core`)
- `export function generateSeo({ params, loaderData })` — per-request SEO computed from the same data `loader` produced (e.g. `/blog/[slug]` titling itself from the post it loaded); takes precedence over `seo` when both are present

## SEO

`x.config.ts`'s `seo` option (`siteUrl`, `sitemap`, `robots`) drives `x build`'s sitemap.xml/robots.txt generation: static-mode pages and content-collection entries (both enumerable at build time) are included automatically; `seo.sitemap.extraUrls` adds routes the build can't discover on its own (e.g. a `mode: "server"` dynamic route backed by a database). No `seo`/`generateSeo` export and no `x.config.ts` `seo` option means every page still renders `<title>x app</title>` with no extra tags, same as before this existed.

## Server functions

Files in `actionsDir` (default `src/actions`) export async functions. They are called via POST to `/__x/actions/<routePath>/<fnName>` with JSON args in the body. In dev, CSRF origin verification is enforced on `/__x/actions/*`.

## Auto-generated files

- `src/x-routes.ts` — written by `createApp` in dev mode. Contains a `RouteMap` type and a typed `href()` helper. **Do not edit.**
- `.x/server/index.ts` — written by `build()`. Re-imports `x.config.ts` at runtime to forward `security`/`observability` options (these can hold live values like error reporters).

## Config

`x.config.ts` at project root uses `defineConfig` from `@thexjs/core`. All options optional:

```ts
export default defineConfig({
  pagesDir: "src/pages", // default
  layoutsDir: "src/layouts", // undefined by default -- see Gotchas below
  apiDir: "src/api", // default
  actionsDir: "src/actions", // default
  contentDir: "content", // undefined
  port: 3000, // default
});
```

## Content collections

Markdown files in `contentDir` are scanned at build/dev time. Frontmatter is parsed (basic YAML). Use `scanContent()` and `renderMarkdown()` in loaders. Each `.md`/`.mdx` file becomes a route at its path.

## Data layer

`@thexjs/core` exports `connectSQLite` (wraps `bun:sqlite` with WAL + FK), `connectPostgres` (wraps `Bun.sql`), `runSQLiteMigrations`, `runPostgresMigrations`. Migrations are tracked in a `_x_migrations` table.

## Testing

Tests use `bun:test`. Fixtures are created in `beforeAll` and cleaned up in `afterAll` under `__fixtures__/`. Run a single test file:

```bash
bun test packages/core/src/router.test.ts
```

## Code style

- **Biome** for lint + format (double quotes, 2-space indent, semicolons, trailing commas)
- **TypeScript strict** — `tsconfig.base.json` shared by all packages. Key flags: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`
- All packages use `"type": "module"`
- `verbatimModuleSyntax` means type-only imports must use `import type`

## Gotchas

- **Postinstall** builds all packages and links the CLI globally. If it fails, run `bun run build:packages` manually.
- **Dev server** auto-compiles Tailwind CSS if `src/styles/globals.css` exists (via `bunx tailwindcss`).
- **File watcher** rebuilds the route tree on `.tsx`/`.ts`/`.css` changes (debounced 200ms). Files starting with `_` or `.` are ignored.
- **Production server** reads `PORT` env var (default 3000).
- **Env isolation**: variables not prefixed with `THEXJS_PUBLIC_` (or custom prefix) are server-only. The build step (`security/env-isolation.ts`) fails if client code references non-prefixed env keys.
- **Security headers** are applied by default (CSP, HSTS, X-Frame-Options, etc.). Pass `security: { headers: false }` to disable.
- **Rate limiting** is enabled by default. Pass `security: { rateLimit: false }` to disable.
- **Forwarded headers (`X-Forwarded-For`/`-Proto`, `X-Real-IP`) are ignored by default** — a client can set these to any value, so trusting them blindly would let an attacker spoof their IP and defeat IP-based rate limiting/brute-force guards. Without opting in, a non-Vercel deployment behind _any_ reverse proxy (NGINX, Cloudflare, an ALB) silently loses IP-based protection — not a bug, but easy to miss. Pass `security: { trustProxy: true }` in `x.config.ts` **only** when the deployment sits behind a proxy/edge that scrubs or overwrites these headers before they reach the app (never when reachable directly, or behind a proxy that forwards whatever the client sent). `@thexjs/adapter-vercel` already opts in for you; other adapters/direct `x start` deployments don't.
- **Rate limiting, the ISR cache, and the login brute-force guard are all in-memory (single-process) by default.** Behind a single replica this is fine; behind multiple replicas (most real deployments) each instance enforces its own independent counter, so the effective limit is `maxAttempts × replica count` and state resets on every redeploy. Each has an opt-in Redis-backed store for cross-replica consistency: `createRedisRateLimitStore`, `createRedisIsrCacheStore` (both `@thexjs/core`), `createRedisBruteForceStore` (`@thexjs/auth`). The rate-limit store falls back to non-atomic behavior if the Redis server denies `EVAL`; the brute-force store deliberately does not (see its doc comment) — a non-atomic fallback there would reopen the TOCTOU race it exists to close.
- **`layoutsDir` has no default directory — leaving it unset means no dedicated layouts dir is scanned at all**, not an implicit `src/layouts`. When you _do_ set it, **every file in that directory wraps every route in the app**, unconditionally (`createApp.ts` prepends all of them to every route's layout chain) — there's no filename convention that scopes one of those files to a subset of routes. A layout meant only for `/dashboard/*` (or any other subtree) does not belong in a dedicated `layoutsDir`; put it at `src/pages/dashboard/_layout.tsx` instead, using the nested-layout convention (any `_layout.tsx` wraps only routes in its own directory and below). Mixing the two — a few truly-global layouts in `layoutsDir`, a subtree-specific one as a nested `_layout.tsx` — is the normal, correct pattern.
- **A route (or layout) combining a server-only `loader`/module-level side effect with a _co-located_ `<Island>` can leak server code into the client bundle.** The island hydration entry resolves `Route.islands?.[name]` by re-importing the whole route module client-side — loader included — so anything that module imports at the top level (a database client, `@thexjs/auth`'s `defineAuth()`, etc.) gets evaluated for the browser target too, and fails the build (or silently falls back to a non-interactive stub) if that code touches something like `node:crypto` with no browser polyfill. Declare the `islands` map entry as a **path string** instead of a live component reference (`export const islands = { Foo: "../../components/foo" }`) whenever the island's component lives in its own file with no server-only imports — the client bundle then imports that file directly and never touches the route module. See `packages/core/src/island-bundle.ts`'s `resolveIslandPaths` and the Islands section of `packages/core/README.md`.

## Agent skills

### Issue tracker

Issues live as GitHub issues in this repo — use the `gh` CLI for all reads/writes. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root when present; proceed silently if absent. See `docs/agents/domain.md`.
