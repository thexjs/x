---
"@thexjs/auth": minor
---

Add a Redis-backed `BruteForceStore` for the credentials provider's brute-force guard, so account/IP lockout state is shared across replicas instead of being per-process in-memory. Pass `store: createRedisBruteForceStore()` (or `createRedisBruteForceStoreFromClient(clientFactory)`) via `loginBruteForce.store` in `defineAuth`.

The Redis store uses Lua scripts to keep `reserve`/`release`/`recordFailure`/`status` atomic across replicas, closing the same #168 TOCTOU race the in-memory guard already closes within one process. Unlike the sibling rate-limit Redis store, there is deliberately no non-atomic fallback when the server denies `EVAL` — a fallback here would reopen the exact race this store exists to close, so it throws instead and asks you to fix the Redis ACL.
