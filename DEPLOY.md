# Deploying x apps

x apps deploy as a single server process with a static assets directory, no Node.js, no
build-time server. Just `x build --outDir dist` + `bun dist/server/index.ts`.

## Deployment targets at a glance

`x` isn't tied to one host. `x build` defaults to a Bun-native output, but
`--adapter <name>` swaps in a platform-specific build for anywhere that default
doesn't fit:

| Target                                 | How                                                         | Runtime at request time                           |
| -------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| Bun process (VPS, systemd, bare metal) | `x build --outDir dist` + `bun dist/server/index.ts`        | Bun                                               |
| Docker / any OCI container             | root `Dockerfile` (Bun-based, multi-stage)                  | Bun                                               |
| Fly.io                                 | committed `fly.toml` + the same root `Dockerfile`           | Bun                                               |
| Vercel                                 | `x build --adapter vercel` (`@thexjs/adapter-vercel`)       | Node 20 (Vercel's own Build Output API functions) |
| Railway / Render / a bare Node host    | `x build --adapter node` (`@thexjs/adapter-node`)           | plain Node.js, no Bun                             |
| Something else                         | write your own adapter against `@thexjs/core/adapter`'s SDK | up to you                                         |

None of these require rewriting app code to switch — the adapters compose the
same build primitives (see "Writing your own adapter" below), and the two
shipped adapters are themselves ordinary consumers of that SDK, not special
cases wired into the core. See also the "Bring your own runtime" section in
the root [README.md](./README.md) for the short version of why this matters
for a solo-maintained project.

## Prerequisites

- [Bun](https://bun.sh) 1.3.x or later (build + runtime)
- A project using `@thexjs/core` with at least one route

## Build

```sh
x build --outDir dist
```

This produces:

- `dist/client/`: fully static assets (HTML, island JS chunks, content pages)
- `dist/server/index.ts`: the generated server entry, run directly with `bun`

`--outDir` defaults to `.x/` if omitted.

## Run in production

`x start` serves whatever `x build` produced. If you built with `--outDir dist`,
point `start` at the same directory:

```sh
x start --outDir dist
```

Or directly:

```sh
NODE_ENV=production bun dist/server/index.ts
```

> If you omit `--outDir`, both commands default to `.x/` and stay consistent.

### Run more than one process

A single `x start` process serves every request with no per-request isolation — one
hung or CPU-bound handler can stall everything else in that process. `createApp`'s
`requestTimeoutMs` option bounds how long any one request can take (returning 504
once it's exceeded), which stops a hung handler from stalling the process forever,
but it doesn't free up CPU mid-flight and it's unset by default. **In production,
run at least two replicas behind a load balancer** — a process manager restarting
one process (`systemd`, `pm2`, your platform's own supervisor) is not a substitute
for this; it only recovers after a crash, not during a stall. See the core
package's README ("Deployment note") and `THREAT_MODEL.md` for the full caveat.

## Docker

A `Dockerfile` is provided at the project root. Build and run:

```sh
docker build -t my-x-app .
docker run -p 3000:3000 my-x-app
```

## Deploy to Vercel

A `vercel-build` script (`x build --adapter vercel`) emits a Build Output API
v3 tree (`.vercel/output/`), no `vercel.json` needed. `examples/basic` and
`examples/landing` ship one; here's how to wire those up:

### Option 1 (recommended): rootDirectory per app

In the Vercel project, set **Root Directory** to the app you're deploying, e.g.
`examples/basic` (the same setup `examples/landing` uses for thexjs.abdelkabir.me).
Vercel then runs `bun install` + `bun run vercel-build` inside that directory.

### Option 2: deploy from the repo root

The root `package.json` has a `vercel-build` script that builds `examples/basic`
in place (where `node_modules` resolve; the render function must live inside
the app tree) and stages the result to the repo-root `.vercel/output`:

```sh
bun run vercel-build
```

> **Why the staging step?** The adapter bundles the SSR render function by
> walking up from its output directory to find `node_modules`. That only works
> when `.vercel/output` sits inside the app's tree, so the root script builds in
> `examples/basic/.vercel/output` (where `@thexjs/*` resolve) and copies the
> self-contained output to the root afterward. Point Vercel at the repo root if
> you use this option.

## Deploy to a bare Node host (Railway, Render, etc.)

The default `x build`/`x start` path requires a Bun runtime on the host, same as the
Fly.io/VPS/Docker sections below. If your host only gives you Node.js -- common on
PaaS platforms that auto-detect and run Node apps -- use `@thexjs/adapter-node`
instead, which bundles a standalone server with no Bun dependency at runtime:

```sh
bun add -d @thexjs/adapter-node
x build --adapter node
node dist-node/server/index.mjs
```

This produces `dist-node/static/` (prerendered HTML, island JS, `public/`) and
`dist-node/server/index.mjs` -- a single file with the whole SSR/API dependency
graph inlined, serving both static and dynamic requests on one port (`$PORT`,
default 3000). No separate static host or CDN tier is required, though you can
still put one in front. See `packages/adapter-node/README.md` for the `trustProxy`
option (only enable it behind a reverse proxy you control).

> **SQLite apps need Postgres first.** `connectSQLite` (`@thexjs/core/data`)
> wraps `bun:sqlite` and throws on boot under plain Node ("connectSQLite
> requires the Bun runtime") -- it has no polyfill, by design. If your app
> uses it (`examples/basic` and `examples/saas` both do, for their
> credentials auth), switch to `connectPostgres` before building with
> `--adapter node` (or `--adapter vercel`, which hits the same constraint).
> Also watch for `import.meta.dir` in your own code -- it's a Bun-only
> global that's `undefined` under Node; use
> `fileURLToPath(new URL(".", import.meta.url))` instead if you need a
> runtime-agnostic "this file's directory".

## Writing your own adapter

`@thexjs/adapter-vercel` and `@thexjs/adapter-node` aren't special-cased into
the CLI's build pipeline -- they're both ordinary consumers of a
platform-agnostic adapter SDK exported from `@thexjs/core/adapter`
(`packages/core/src/adapter/`). A third adapter (Cloudflare, Netlify, a
different Node host with its own packaging format, ...) composes the same
four pieces:

1. **`resolveBuildManifest(options, scratchDir)`** -- scans every
   server-mode route, layout, middleware, and action file at build time into
   a `BuildManifest`. This is what lets the output run somewhere that can't
   scan the filesystem for `.tsx`/`.ts` routes at request time the way Bun
   can.
2. **`transpileModules(moduleRefs)`** -- compiles each referenced source file
   from Bun-flavored TSX/TS into a standalone Node-runnable ESM module
   (`react`, `react-dom`, and `@thexjs/core` stay external here so they're
   inlined once, not per-route).
3. **`generateAdapterEntry(manifest, entryDir)`** -- emits an entry module
   that statically imports every compiled route/action and constructs the
   real `createApp()` against the pre-resolved manifest (no dynamic
   `import(path)`, no runtime fs walk).
4. **`bundleRenderFunction(entryDir, outFile)`** -- inlines that entry plus
   its whole dependency graph into one self-contained file.

What differs per platform is everything _around_ those four calls: `@thexjs/adapter-node`
adds a plain `node:http` static-file server in front and writes a flat
`dist-node/` tree; `@thexjs/adapter-vercel` instead emits a Build Output API
v3 tree (`config.json`, `static/`, `functions/render.func`) because that's
what Vercel's routing layer expects. Read `packages/adapter-node/src/index.ts`
and `packages/adapter-vercel/src/index.ts` side by side -- they diverge only
in that output-shaping layer, not in how they get the server-mode code into a
bundle. Wire a new adapter into the CLI by adding an `adapterName === "..."`
branch next to the existing ones in `packages/cli/src/index.ts`'s `cmdBuild`
(around the `"vercel"` and `"node"` branches), which dynamically imports your
package the same way.

## Deploy to Fly.io

A reference deployment is committed at the repo root: [`fly.toml`](./fly.toml).
It builds the same multi-stage `Dockerfile` the "Docker" section above uses
(Bun-based), not `@thexjs/adapter-node`'s output -- `examples/basic`'s SQLite
auth needs Bun at runtime (see the caveat above), and Fly runs an arbitrary
container anyway, so there's no Node-only constraint to route around here the
way there is on Railway/Render.

1. Install the [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/)
2. Review `fly.toml` -- at minimum change `app` to a name you own
3. Launch:

```sh
fly launch --no-deploy
fly deploy
```

> `fly launch` may offer to regenerate `fly.toml` for you. If you accept, diff
> the result against the committed one -- `internal_port` (`http_service`)
> needs to stay `3000` to match the Dockerfile's `EXPOSE`/`CMD`.
> `scripts/fly-toml.test.ts` checks that invariant in CI so it can't drift
> silently.

## Deploy to a VPS

1. Build locally (so the artifacts land in `dist/`):

```sh
x build --outDir dist
```

2. Copy `dist/` to the server:

```sh
rsync -avz dist/ user@host:/opt/my-x-app/dist
```

3. Run (use a process manager like `systemd` or `pm2`):

```ini
# /etc/systemd/system/my-x-app.service
[Unit]
Description=my-x-app
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/my-x-app
ExecStart=/usr/local/bin/bun dist/server/index.ts
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```sh
systemctl enable --now my-x-app
```

## Environment

| Variable               | Default      | Description                                                                                                                   |
| ---------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                 | `3000`       | HTTP port the server listens on                                                                                               |
| `NODE_ENV`             | `production` | Set to `development` for dev mode                                                                                             |
| `DATABASE_URL`         | —            | Postgres connection string for `@thexjs/core/data` `connectPostgres`; only needed when using Postgres                         |
| `AUTH_SECRET`          | —            | Secret used to HMAC `@thexjs/auth` session/state cookies; required in production — without it sessions won't survive restarts |
| `GITHUB_CLIENT_ID`     | —            | OAuth app client ID for the `@thexjs/auth` GitHub provider; only needed if you use GitHub sign-in                             |
| `GITHUB_CLIENT_SECRET` | —            | OAuth app client secret for the `@thexjs/auth` GitHub provider; only needed if you use GitHub sign-in                         |

## Architecture

```
dist/
  client/           # Static assets — serve from any static file server
    index.html
    _islands/*.js   # Per-island hydration bundles
    blog/hello/index.html
  server/
    index.ts        # Generated server entry (Bun.serve with routes + API + SSR)
```

You can serve `dist/client/` from a CDN or reverse proxy (nginx, Fly CDN, etc.)
and forward API/SSR requests to the server process.

> **Docker tip:** `docker build` emits the build to `./dist` (the Dockerfile runs
> `x build --outDir dist`), so the image's `CMD` is `bun dist/server/index.ts`.
