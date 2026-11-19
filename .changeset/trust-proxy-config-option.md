---
"@thexjs/core": minor
---

Add a `security.trustProxy` option to `createApp`, the `x.config.ts`-level opt-in `trusted-proxy.ts`'s own `configureTrustedProxy()` doc comment already described but never actually existed. Previously, `configureTrustedProxy` was called only by `@thexjs/adapter-vercel`'s own bridge — any `x dev`/`x start` deployment behind a different reverse proxy (NGINX, Cloudflare, an ALB) had no declarative way to opt in to trusting forwarded headers, silently losing IP-based rate limiting and brute-force protection. Setting `security.trustProxy: true` calls `configureTrustedProxy` once at boot; leaving it unset/`false` never calls it at all, so an adapter that already made its own trust decision at its own initialization point is never overridden back to untrusted.
