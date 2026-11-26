---

## status: accepted

# Rate limiting, ISR cache, and the brute-force guard default to in-memory, single-process stores

Each has an opt-in Redis-backed alternative (`createRedisRateLimitStore`, `createRedisIsrCacheStore`, `createRedisBruteForceStore`) for cross-replica consistency, but none is wired in by default.

Behind a single replica this is correct and has no downside — reaching for Redis unconditionally would mean every app pays an external dependency and a network round trip for state that, for most deployments early in their life, never leaves one process. Behind multiple replicas (most real production deployments eventually), each instance enforces its own independent counter: the effective rate limit becomes `maxAttempts × replica count`, and state resets on every redeploy. We accepted that as a sharp edge rather than forcing Redis on everyone, on the bet that most apps start single-replica and can add the Redis store when they actually scale out — but it means scaling past one replica without switching stores silently weakens these three protections, not loudly.

## Considered options

Defaulting to Redis-backed stores and making in-memory the opt-out was considered and rejected: it would make the zero-config path slower and add an external dependency for the common case (single-replica deployments, local dev, most side projects) to protect the less common case (multi-replica production).
