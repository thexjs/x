# @thexjs/adapter-node

## 0.1.0

### Minor Changes

- 6d46c47: Initial release of `@thexjs/adapter-node`: a generic Node.js adapter that bundles a standalone server (static files + SSR/API, one process, one port) for hosts that only give you Node.js at runtime (Railway, Render, a bare VPS) -- no Bun required to serve traffic. Composes the same `@thexjs/core/adapter` SDK `@thexjs/adapter-vercel` uses.

### Patch Changes

- c5a3f0f: Bump `tsup` devDependency to 9.0.0 across all packages, and `react`/`@types/react`/`react-dom`/`@types/react-dom` to 19.3.x where applicable (`@thexjs/core`, `@thexjs/hooks`, `@thexjs/adapter-vercel`, `@thexjs/cli`).
- 801184e: Apply the app's configured security headers (CSP, HSTS, X-Frame-Options, etc.) to static/prerendered responses, not just server-rendered ones. Previously, `createApp`'s own static-asset handler ran every response through `withResponseHardening`, but both production adapters served static assets through a path that never reached it: `adapter-node`'s generated server intercepts static GET/HEAD requests before calling into `app.fetch()`, and `adapter-vercel`'s static tier is served directly from Vercel's CDN via filesystem routing, bypassing the render function entirely. Every prerendered HTML page and static asset shipped with no CSP/HSTS/X-Frame-Options once deployed via either adapter, while the identical app run directly via `x start` got them. `adapter-node` now builds the same headers from the app's `security.headers` config and applies them before serving a static file; `adapter-vercel` now emits a native Build Output API `headers` rule so Vercel's CDN applies them at the edge.
- Updated dependencies [c5a3f0f]
- Updated dependencies [4b1e66b]
  - @thexjs/core@1.10.0
