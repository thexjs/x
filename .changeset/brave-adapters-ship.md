---
"@thexjs/adapter-node": minor
---

Initial release of `@thexjs/adapter-node`: a generic Node.js adapter that bundles a standalone server (static files + SSR/API, one process, one port) for hosts that only give you Node.js at runtime (Railway, Render, a bare VPS) -- no Bun required to serve traffic. Composes the same `@thexjs/core/adapter` SDK `@thexjs/adapter-vercel` uses.
