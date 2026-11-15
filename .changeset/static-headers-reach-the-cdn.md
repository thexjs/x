---
"@thexjs/adapter-node": patch
"@thexjs/adapter-vercel": patch
---

Apply the app's configured security headers (CSP, HSTS, X-Frame-Options, etc.) to static/prerendered responses, not just server-rendered ones. Previously, `createApp`'s own static-asset handler ran every response through `withResponseHardening`, but both production adapters served static assets through a path that never reached it: `adapter-node`'s generated server intercepts static GET/HEAD requests before calling into `app.fetch()`, and `adapter-vercel`'s static tier is served directly from Vercel's CDN via filesystem routing, bypassing the render function entirely. Every prerendered HTML page and static asset shipped with no CSP/HSTS/X-Frame-Options once deployed via either adapter, while the identical app run directly via `x start` got them. `adapter-node` now builds the same headers from the app's `security.headers` config and applies them before serving a static file; `adapter-vercel` now emits a native Build Output API `headers` rule so Vercel's CDN applies them at the edge.
