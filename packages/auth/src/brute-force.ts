/**
 * Per-account brute-force guard for credentials sign-in.
 *
 * The framework's general-purpose rate limiter is IP-keyed and shared across
 * the whole app, so a distributed attack (many IPs, one account) or a shared
 * NAT/office IP walks right past it. This guard is scoped tighter than that:
 * two *independent* buckets are checked together —
 *
 * - **Account bucket** (keyed by the submitted identifier alone): N
 *   consecutive failed attempts against one account lock *that account*
 *   regardless of how many IPs are doing the guessing.
 * - **IP bucket** (keyed by the client IP alone): a single IP spraying many
 *   accounts is throttled without locking out any one account for everyone
 *   who shares that network.
 *
 * They are separate keys deliberately: a composite `(IP, account)` key gives
 * neither protection — an attacker rotating source IPs starts a fresh bucket
 * on every attempt, so no bucket ever accumulates toward `maxAttempts`.
 *
 * In-memory (single-process) by default, with exponential backoff: each
 * failure extends the lockout window (`windowMs * 2^(failures-1)`, capped),
 * so sustained guessing is pushed out rather than just rate-sampled. Pass
 * `store` (see `createRedisBruteForceStore`) for multi-instance deployments
 * — without one, an attacker spread across N replicas behind a load
 * balancer gets ~N× `maxAttempts` before the account bucket (the axis
 * specifically meant to be IP-agnostic) ever locks, since each replica
 * counts independently.
 *
 * All five operations are async regardless of backend — the in-memory path
 * never awaits internally, so two concurrent callers' calls still can't
 * interleave between a bucket's check and its mutation (the function being
 * declared `async` doesn't reopen the TOCTOU race in #168; only an `await`
 * *inside* the check-then-mutate logic itself could). The Redis store keeps
 * that same atomicity through Lua scripts, not multiple round trips.
 */

import { clientIpFromRequest } from "@thexjs/core";

export interface BruteForceOptions {
  /** Consecutive failed attempts per account before it locks. Default: 5. */
  maxAttempts?: number;
  /** Base lockout window in ms; each failure extends it (exponential backoff). Default: 15 min. */
  windowMs?: number;
  /** Optional shared store (e.g. Redis) for multi-instance deployments. */
  store?: BruteForceStore;
}

export interface AttemptResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

interface Bucket {
  failures: number;
  resetAt: number;
}

/**
 * A shared backend for brute-force bucket state, so `createBruteForceGuard`
 * can be backed by Redis instead of local `Map`s. Unlike
 * `RateLimitStore`/`IsrCacheStore`, there is deliberately **no non-atomic
 * fallback** when the server denies scripting — see
 * `createRedisBruteForceStoreFromClient`'s doc comment for why.
 */
export interface BruteForceStore {
  /** Read-only lockout state for `key`, without recording or reserving anything. */
  status(key: string, maxAttempts: number, now: number): Promise<AttemptResult>;
  /**
   * Atomically checks the persisted lockout state and, if not locked,
   * reserves one attempt slot (capped at `maxAttempts` in-flight
   * reservations) — in one indivisible operation, so N concurrent callers
   * across every replica sharing this store can't all pass the check before
   * any of them commits a failure.
   */
  reserve(key: string, maxAttempts: number, now: number): Promise<AttemptResult>;
  /** Releases a reservation (rollback on success, or after it became a failure). */
  release(key: string): Promise<void>;
  /** Converts a reservation into a persisted failure, extending the lockout via exponential backoff. */
  recordFailure(
    key: string,
    maxAttempts: number,
    windowMs: number,
    now: number,
  ): Promise<AttemptResult>;
  /** Clears the persisted bucket for `key` after a successful sign-in. */
  reset(key: string): Promise<void>;
}

export function createBruteForceGuard(options: BruteForceOptions = {}) {
  const maxAttempts = options.maxAttempts ?? 5;
  const windowMs = options.windowMs ?? 15 * 60_000;
  const store = options.store;
  const buckets = new Map<string, Bucket>();

  /**
   * In-flight reservations. `reserve` bumps this counter before `authorize`
   * is awaited, so N concurrent requests can't all pass the lockout check
   * before any commits a failure (the TOCTOU in #168). Each reserved slot is
   * released either on success (rollback) or after being converted to a
   * real failure.
   */
  const inflight = new Map<string, number>();

  /** Client IP, or null when neither proxy header is present. */
  function clientIp(req: Request): string | null {
    return clientIpFromRequest(req);
  }

  /**
   * Account-scoped bucket key: the submitted identifier alone. Namespaced
   * separately from the IP bucket so a crafted identifier that happens to look
   * like an IP (or vice versa) can't merge the two buckets.
   */
  function accountKey(identifier: string): string {
    return `login:account:${identifier}`;
  }

  /**
   * IP-scoped bucket key: the client IP alone (one IP spraying many accounts),
   * or null when the client IP can't be determined — see {@link clientIp}.
   */
  function ipKey(req: Request): string | null {
    const ip = clientIp(req);
    return ip === null ? null : `login:ip:${ip}`;
  }

  /** Current lockout state for `key`, without recording anything. */
  async function status(key: string, now = Date.now()): Promise<AttemptResult> {
    if (store) return store.status(key, maxAttempts, now);
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      return { ok: true, remaining: maxAttempts, resetAt: now };
    }
    return {
      ok: bucket.failures < maxAttempts,
      remaining: Math.max(0, maxAttempts - bucket.failures),
      resetAt: bucket.resetAt,
    };
  }

  /** Records a failed attempt, extending the lockout via exponential backoff. */
  async function recordFailure(key: string, now = Date.now()): Promise<AttemptResult> {
    if (store) return store.recordFailure(key, maxAttempts, windowMs, now);
    const existing = buckets.get(key);
    if (existing && existing.resetAt > now) {
      const failures = existing.failures + 1;
      const backoff = Math.min(windowMs * 2 ** (failures - 1), windowMs * 32);
      const resetAt = now + backoff;
      buckets.set(key, { failures, resetAt });
      return {
        ok: failures < maxAttempts,
        remaining: Math.max(0, maxAttempts - failures),
        resetAt,
      };
    }
    const resetAt = now + windowMs;
    buckets.set(key, { failures: 1, resetAt });
    return { ok: maxAttempts > 1, remaining: maxAttempts - 1, resetAt };
  }

  /**
   * Reserves an attempt slot for `key` — atomically, with no gap between the
   * capacity check and the bump (see the store/in-memory note above).
   * Parallel callers that all clear the persisted lockout are still gated:
   * the in-flight counter caps how many may proceed before any of them
   * commits a failure. Returns `ok: false` immediately when at capacity so
   * the caller can respond 429 with no authorization work.
   */
  async function reserve(key: string, now = Date.now()): Promise<AttemptResult> {
    if (store) return store.reserve(key, maxAttempts, now);
    // Inlined rather than calling the async `status()` and awaiting it: an
    // `await` -- even one that resolves "instantly" with no real I/O -- is
    // still a yield point, and the whole reason this function is safe
    // without a lock is that everything from the bucket read through the
    // inflight bump happens in one synchronous stretch with *no* yield point
    // in between. Keeping that inline, rather than reasoning about whether a
    // trivially-resolved await happens to still be safe, is what actually
    // keeps #168 closed for the in-memory path.
    const bucket = buckets.get(key);
    const locked = bucket !== undefined && bucket.resetAt > now && bucket.failures >= maxAttempts;
    const resetAt = bucket !== undefined && bucket.resetAt > now ? bucket.resetAt : now;
    if (locked) {
      return { ok: false, remaining: Math.max(0, maxAttempts - (bucket?.failures ?? 0)), resetAt };
    }
    const count = inflight.get(key) ?? 0;
    if (count >= maxAttempts) {
      return { ok: false, remaining: maxAttempts - count, resetAt };
    }
    inflight.set(key, count + 1);
    return { ok: true, remaining: maxAttempts - (count + 1), resetAt };
  }

  /** Releases a reservation (rollback on success, or after it became a failure). */
  async function release(key: string): Promise<void> {
    if (store) return store.release(key);
    const count = inflight.get(key) ?? 0;
    if (count <= 1) inflight.delete(key);
    else inflight.set(key, count - 1);
  }

  /** Clears the bucket for `key` after a successful sign-in. */
  async function reset(key: string): Promise<void> {
    if (store) return store.reset(key);
    buckets.delete(key);
  }

  function sweep(): void {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  // Don't keep the process (or a test run) alive just for sweeping. No-op
  // when a store is configured -- the store is responsible for its own
  // expiry (the Redis store uses key TTLs instead of a sweep loop).
  const timer = setInterval(sweep, Math.max(windowMs, 1000));
  timer.unref?.();

  return {
    accountKey,
    ipKey,
    status,
    reserve,
    release,
    recordFailure,
    reset,
    buckets,
    dispose: () => clearInterval(timer),
  };
}

export type BruteForceGuard = ReturnType<typeof createBruteForceGuard>;

// -- Redis-backed store -----------------------------------------------------

/**
 * The subset of a Redis client the store needs. Matches `bun:redis`'s
 * `RedisClient#sendCommand`, so the store works with any RESP-capable
 * client. (Same shape as `security/rate-limit.ts`'s and
 * `security/isr-cache.ts`'s `RedisClientLike` — duplicated rather than
 * imported from `@thexjs/core`, so this module in a different package has
 * no dependency on either's internals and all three can evolve
 * independently.)
 */
export interface RedisClientLike {
  sendCommand(...args: string[]): Promise<unknown>;
}

/** Yields a connected Redis client. Injectable for tests and custom transports. */
export type RedisClientFactory = () => Promise<RedisClientLike>;

/** Connects to Redis via Bun's built-in `Bun.RedisClient` (no npm dependency). */
function createBunRedisClient(options: { url?: string }): RedisClientFactory {
  return async () => {
    const BunRedis = (
      globalThis as unknown as {
        Bun: {
          RedisClient: new (
            url?: string,
          ) => {
            connect(): Promise<unknown>;
            send(command: string, args: string[]): Promise<unknown>;
          };
        };
      }
    ).Bun.RedisClient;
    const instance = options.url ? new BunRedis(options.url) : new BunRedis();
    await instance.connect();
    return {
      sendCommand: (command, ...args) => instance.send(command, args),
    };
  };
}

const BUCKET_PREFIX = "x:bruteforce:bucket:";
const INFLIGHT_PREFIX = "x:bruteforce:inflight:";
/** Safety-net TTL on an in-flight reservation: far longer than any real
 *  request should take (createApp's requestTimeoutMs bounds that long
 *  before this would ever matter), just long enough that a process that
 *  crashes between reserve() and release() can't leak a slot forever and
 *  permanently cap a key at maxAttempts across every replica. */
const INFLIGHT_SAFETY_TTL_SECONDS = 60;

const RESERVE_SCRIPT = `
local bucketKey = KEYS[1]
local inflightKey = KEYS[2]
local maxAttempts = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local inflightTtl = tonumber(ARGV[3])

local bucket = redis.call('HMGET', bucketKey, 'failures', 'resetAt')
local failures = tonumber(bucket[1]) or 0
local resetAt = tonumber(bucket[2]) or 0

local live = resetAt > now
local effectiveResetAt = now
if live then effectiveResetAt = resetAt end

if live and failures >= maxAttempts then
  return {0, maxAttempts - failures, effectiveResetAt}
end

local inflight = tonumber(redis.call('GET', inflightKey)) or 0
if inflight >= maxAttempts then
  return {0, maxAttempts - inflight, effectiveResetAt}
end

local newInflight = redis.call('INCR', inflightKey)
redis.call('EXPIRE', inflightKey, inflightTtl)
return {1, maxAttempts - newInflight, effectiveResetAt}
`;

const RELEASE_SCRIPT = `
local inflightKey = KEYS[1]
local count = tonumber(redis.call('GET', inflightKey)) or 0
if count <= 1 then
  redis.call('DEL', inflightKey)
else
  redis.call('DECR', inflightKey)
end
return 1
`;

const RECORD_FAILURE_SCRIPT = `
local bucketKey = KEYS[1]
local maxAttempts = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local bucket = redis.call('HMGET', bucketKey, 'failures', 'resetAt')
local existingFailures = tonumber(bucket[1]) or 0
local existingResetAt = tonumber(bucket[2]) or 0

local failures
local resetAt
if existingResetAt > now then
  failures = existingFailures + 1
  local backoff = windowMs * (2 ^ (failures - 1))
  local cap = windowMs * 32
  if backoff > cap then backoff = cap end
  resetAt = now + backoff
else
  failures = 1
  resetAt = now + windowMs
end

redis.call('HSET', bucketKey, 'failures', failures, 'resetAt', resetAt)
redis.call('PEXPIRE', bucketKey, (resetAt - now) + windowMs)
return {failures, resetAt}
`;

const STATUS_SCRIPT = `
local bucketKey = KEYS[1]
local maxAttempts = tonumber(ARGV[1])
local now = tonumber(ARGV[2])

local bucket = redis.call('HMGET', bucketKey, 'failures', 'resetAt')
local failures = tonumber(bucket[1]) or 0
local resetAt = tonumber(bucket[2]) or 0

if resetAt <= now then
  return {1, maxAttempts, now}
end
if failures >= maxAttempts then
  return {0, maxAttempts - failures, resetAt}
end
return {1, maxAttempts - failures, resetAt}
`;

/** True when a Redis error says scripting is unavailable to this client. */
function isScriptingDenied(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /NOSCRIPT|unknown command|NOPERM|scripting is disabled|not allowed/i.test(message);
}

/**
 * Shared brute-force guard store backed by Redis, so the account/IP lockout
 * buckets — and the TOCTOU-closing in-flight reservation counter — are
 * shared across every replica instead of counted independently per process.
 *
 * Unlike `createRedisRateLimitStore`, there is **no non-atomic fallback**
 * when the Redis server denies scripting (scripting disabled, or an ACL
 * without `EVAL`). A non-atomic multi-command fallback here would reopen
 * the exact TOCTOU race #168 closed — just across replicas sharing this
 * store instead of within one process — defeating the entire reason this
 * store exists. If your Redis deployment denies `EVAL`, every method
 * throws; fix the ACL rather than silently accepting a bypassable guard.
 */
export function createRedisBruteForceStore(options: { url?: string } = {}): BruteForceStore {
  return createRedisBruteForceStoreFromClient(createBunRedisClient(options));
}

/**
 * Builds the Redis-backed brute-force store from an explicit client factory.
 * Exposed for testing and custom transports; the default factory is Bun's
 * `Bun.RedisClient`.
 */
export function createRedisBruteForceStoreFromClient(
  clientFactory: RedisClientFactory,
): BruteForceStore {
  let client: RedisClientLike | null = null;
  let connecting: Promise<RedisClientLike> | null = null;

  function getClient(): Promise<RedisClientLike> {
    if (client) return Promise.resolve(client);
    if (!connecting) {
      connecting = clientFactory().then(
        (c) => {
          client = c;
          return c;
        },
        (err) => {
          connecting = null;
          throw err;
        },
      );
    }
    return connecting;
  }

  async function runScript(
    script: string,
    keys: string[],
    args: string[],
  ): Promise<[number, number, number]> {
    const c = await getClient();
    try {
      const reply = (await c.sendCommand(
        "EVAL",
        script,
        String(keys.length),
        ...keys,
        ...args,
      )) as [number, number, number];
      return reply;
    } catch (err) {
      if (isScriptingDenied(err)) {
        throw new Error(
          "[@thexjs/auth] Redis brute-force store: the server denied EVAL (scripting " +
            "disabled, or an ACL without EVAL). This store has no non-atomic fallback -- " +
            "unlike the rate-limit store, a non-atomic path here would reopen the exact " +
            "TOCTOU race it exists to close. Grant EVAL on this Redis user/ACL.",
          { cause: err },
        );
      }
      throw err;
    }
  }

  return {
    async status(key, maxAttempts, now) {
      const [ok, remaining, resetAt] = await runScript(
        STATUS_SCRIPT,
        [BUCKET_PREFIX + key],
        [String(maxAttempts), String(now)],
      );
      return { ok: ok === 1, remaining, resetAt };
    },

    async reserve(key, maxAttempts, now) {
      const [ok, remaining, resetAt] = await runScript(
        RESERVE_SCRIPT,
        [BUCKET_PREFIX + key, INFLIGHT_PREFIX + key],
        [String(maxAttempts), String(now), String(INFLIGHT_SAFETY_TTL_SECONDS)],
      );
      return { ok: ok === 1, remaining, resetAt };
    },

    async release(key) {
      await runScript(RELEASE_SCRIPT, [INFLIGHT_PREFIX + key], []);
    },

    async recordFailure(key, maxAttempts, windowMs, now) {
      const [failures, resetAt] = await runScript(
        RECORD_FAILURE_SCRIPT,
        [BUCKET_PREFIX + key],
        [String(maxAttempts), String(windowMs), String(now)],
      );
      return {
        ok: failures < maxAttempts,
        remaining: Math.max(0, maxAttempts - failures),
        resetAt,
      };
    },

    async reset(key) {
      const c = await getClient();
      await c.sendCommand("DEL", BUCKET_PREFIX + key);
    },
  };
}
