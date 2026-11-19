---
"@thexjs/core": minor
---

Add a pluggable `IsrCacheStore` for the ISR cache, mirroring the rate limiter's `RateLimitStore` pattern. In-memory and per-process by default (no behavior change). Pass `createRedisIsrCacheStore()` as `security.isrCache.store` for multi-instance deployments, so `/__x/revalidate` purges the cache every replica serves instead of just the one that handled the request. `security.isrCache.maxEntries` is also now configurable (previously hardcoded to 500).
