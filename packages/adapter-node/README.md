# @thexjs/adapter-node

Generic Node.js adapter for `@thexjs` apps. Produces a standalone server that runs on
plain Node.js -- **no Bun runtime required to serve traffic** -- for hosts that only
give you Node (Railway, Render, a bare VPS, most container platforms).

```sh
bun add -d @thexjs/adapter-node
x build --adapter node
node dist-node/server/index.mjs
```

## What it produces

```text
dist-node/
  static/                HTML, CSS, island JS chunks -- served by the server itself
  server/
    index.mjs             standalone SSR + API + static-file server, listens on $PORT
```

Unlike `@thexjs/adapter-vercel`, the server is bundled even for 100%-static apps:
there's no separate CDN/filesystem tier on a generic Node host, so the one process
you run always needs to serve `static/` itself.

## How it works

1. Runs `@thexjs/core`'s normal `build()` to prerender every static-mode page/content
   entry and compile island bundles -- this becomes `static/`.
2. Separately resolves every *server-mode* page, API route, layout, middleware file,
   and server-action file **at build time** (reusing `@thexjs/core/adapter`'s SDK --
   the same one `@thexjs/adapter-vercel` composes), so nothing at request time depends
   on walking the filesystem or on a dynamic `import(path)` of a `.tsx` file.
3. Transpiles each of those files from Bun-flavored TSX/TS into plain Node ESM, then
   bundles them together with `@thexjs/core` and React into one standalone
   `server/index.mjs`.
4. The bundled entry starts a plain `node:http` server: static requests are served
   straight from `static/` (path-traversal-safe, with an `index.html` fallback for
   prerendered routes); everything else goes through the Node <-> Web
   Request/Response bridge into the real `createApp()` -- the exact same request
   pipeline as `x start` (health checks, rate limiting, revalidation, server actions,
   SSR with loaders/layouts/middleware, API routes, security headers, the 404 page).

## Options

```ts
import { buildNodeOutput } from "@thexjs/adapter-node";

await buildNodeOutput({
  projectRoot: process.cwd(),
  pagesDir: "src/pages",
  apiDir: "src/api",
  layoutsDir: "src/layouts",
  actionsDir: "src/actions",
  contentDir: "content",
  outputDir: "dist-node", // default
  port: 3000,             // default; overridden by $PORT at runtime
  trustProxy: false,      // default -- see below
});
```

### `trustProxy`

`@thexjs/adapter-vercel` always trusts `X-Forwarded-*` headers because it only ever
runs behind Vercel's own edge. A generic Node deployment can't make that assumption --
if you run this behind your own reverse proxy / load balancer that you know strips or
overwrites these headers on the way in, set `trustProxy: true` so client IP resolution
(brute-force guards, audit trails) and protocol/host resolution (CSRF origin checks,
redirects) use the proxy's headers instead of the raw socket. Leave it `false` (the
default) if you're not sure, or if the server is reachable directly.

## Known limitations (follow-up work)

- ISR-style `revalidate` caching (in-memory in the long-running server process)
  doesn't survive a restart and isn't shared across replicas -- see `SECURITY.md`'s
  "Multi-instance deployments" section.
- Markdown `contentDir` entries are always statically prerendered (matches
  `@thexjs/core`'s `build()` behavior today) -- there's no server-mode content route yet.
- The bundled static-file server has no HTTP range/conditional-request support
  (`Range`, `If-Modified-Since`, `ETag`). Fine behind a CDN or reverse proxy that adds
  caching; for large files served directly, consider fronting this with one.
