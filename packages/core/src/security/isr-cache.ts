/**
 * ISR (revalidate) cache with a bounded size and in-flight dedup. In-memory
 * (per-process) by default; pass `store` (see `createRedisIsrCacheStore`) for
 * multi-instance deployments, where purging one replica's local cache isn't
 * enough — `/__x/revalidate` needs to invalidate the HTML every replica
 * shares, not just the one that happened to handle the purge request.
 *
 * Three problems this solves over a plain `Map`:
 *
 * 1. **Unbounded growth** — cached HTML for every distinct URL ever requested
 *    would otherwise live for the life of the process. Entries are capped at
 *    `maxEntries` and evicted oldest-first (LRU via Map insertion order).
 *    (The Redis store has its own bound — a TTL, not an entry cap; see
 *    `createRedisIsrCacheStore`.)
 *
 * 2. **Cache stampede** — N concurrent misses for the same URL all ran the
 *    loader and rendered. `getOrCompute` shares one in-flight computation
 *    across all waiters, so a busy page rebuilds its entry exactly once.
 *    This dedup is per-process even with a shared store: two different
 *    replicas can still both miss and both recompute once each, same as two
 *    independent single-instance deployments would. Closing that too would
 *    need a distributed lock, which is a bigger step than what a shared
 *    cache store is for.
 *
 * 3. **Cross-replica staleness** — with no shared store, revalidating or
 *    purging a path on one instance leaves every sibling instance still
 *    serving the old cached HTML until their own TTL naturally expires.
 *
 * Keys are full URLs (pathname + search). The caller is responsible for that
 * contract; see `isrCacheKey`.
 */
export interface StaticCacheEntry {
  html: string;
  timestamp: number;
  /** CSP nonce baked into the inline scripts of `html`; must be reused when serving from cache. */
  cspNonce: string;
}

/** Rendered HTML plus the CSP nonce it was rendered with. */
export interface ComputeResult {
  html: string;
  cspNonce: string;
}

/**
 * A shared backend for ISR cache entries, so `IsrCache` can be backed by
 * Redis (or any other store) instead of a local `Map`. All methods are
 * async, even though the in-memory default resolves synchronously-fast —
 * one uniform interface regardless of backend, the same choice
 * `RateLimitStore` already makes.
 */
export interface IsrCacheStore {
  get(key: string): Promise<StaticCacheEntry | undefined>;
  set(key: string, entry: StaticCacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  /** Deletes every entry whose pathname matches (query-blind purge); returns the count removed. */
  deletePath(pathname: string): Promise<number>;
  clear(): Promise<void>;
}

export class IsrCache {
  private readonly entries = new Map<string, StaticCacheEntry>();
  private readonly inFlight = new Map<string, Promise<ComputeResult | Response>>();
  private readonly maxEntries: number;
  private readonly store: IsrCacheStore | undefined;

  constructor(maxEntries = 500, store?: IsrCacheStore) {
    this.maxEntries = maxEntries;
    this.store = store;
  }

  async get(key: string): Promise<StaticCacheEntry | undefined> {
    if (this.store) return this.store.get(key);
    const entry = this.entries.get(key);
    if (entry) {
      // LRU touch: re-insert so it survives longer than less-recently-used
      // entries when the cap is hit.
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  async set(key: string, html: string, cspNonce: string): Promise<void> {
    const entry: StaticCacheEntry = { html, timestamp: Date.now(), cspNonce };
    if (this.store) {
      await this.store.set(key, entry);
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.evict();
  }

  async delete(key: string): Promise<void> {
    if (this.store) {
      await this.store.delete(key);
      return;
    }
    this.entries.delete(key);
  }

  async clear(): Promise<void> {
    if (this.store) {
      await this.store.clear();
      return;
    }
    this.entries.clear();
  }

  /** Deletes every entry whose pathname matches (query-blind purge). */
  async deletePath(pathname: string): Promise<number> {
    if (this.store) return this.store.deletePath(pathname);
    let removed = 0;
    for (const key of this.entries.keys()) {
      const url = new URL(key, "http://localhost");
      if (url.pathname === pathname) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** In-process entry count. With a shared store, this only reflects in-flight dedup bookkeeping, not the store's size. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Returns the cached HTML for `key`, or runs `compute` exactly once — even
   * when multiple callers miss concurrently — and caches the result. A
   * `Response` returned by `compute` (e.g. a loader redirect) is passed
   * through and never cached.
   */
  async getOrCompute(
    key: string,
    compute: () => Promise<ComputeResult | Response>,
  ): Promise<ComputeResult | Response> {
    const cached = await this.get(key);
    if (cached) return { html: cached.html, cspNonce: cached.cspNonce };

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = compute()
      .then(async (result) => {
        if (result instanceof Response) return result;
        await this.set(key, result.html, result.cspNonce);
        return result;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  private evict(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }
}

/** Full-URL cache key (pathname + search) — query strings are part of the key. */
export function isrCacheKey(requestUrl: string): string {
  const url = new URL(requestUrl);
  return url.pathname + url.search;
}

/**
 * The subset of a Redis client the store needs. Matches `bun:redis`'s
 * `RedisClient#sendCommand`, so the store works with any RESP-capable client.
 * (Same shape as `security/rate-limit.ts`'s `RedisClientLike` — duplicated
 * rather than imported, so this module has no dependency on rate-limit.ts's
 * internals and the two can evolve independently.)
 */
export interface RedisClientLike {
  sendCommand(...args: string[]): Promise<unknown>;
}

/** Yields a connected Redis client. Injectable for tests and custom transports. */
export type RedisClientFactory = () => Promise<RedisClientLike>;

/** Connects to Redis via Bun's built-in `Bun.RedisClient` (no npm dependency). */
function createBunRedisClient(options: { url?: string }): RedisClientFactory {
  return async () => {
    // Loaded through the Bun global rather than an import, so this module
    // still type-checks and loads on runtimes without it -- the failure only
    // surfaces if someone actually uses the Redis store, and the browser
    // bundle never sees a Bun-only global reference.
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

const REDIS_KEY_PREFIX = "x:isr:";

/** Escapes Redis glob-pattern metacharacters (`*`, `?`, `[`, `]`, `\`) so a literal key segment containing one of them (e.g. a route path like `/blog/post[1]`) is matched as text, not interpreted as pattern syntax. */
function escapeRedisGlob(value: string): string {
  return value.replace(/[*?[\]\\]/g, "\\$&");
}

/** Scans for every key matching `pattern`, cursor-paginated so a large keyspace never blocks Redis with one unbounded call. */
async function scanKeys(client: RedisClientLike, pattern: string): Promise<string[]> {
  const found: string[] = [];
  let cursor = "0";
  do {
    const reply = (await client.sendCommand("SCAN", cursor, "MATCH", pattern, "COUNT", "200")) as [
      string,
      string[],
    ];
    cursor = reply[0];
    found.push(...reply[1]);
  } while (cursor !== "0");
  return found;
}

/**
 * Shared ISR cache store backed by Redis, so `/__x/revalidate` invalidates
 * the HTML every replica serves, not just the one that handled the purge
 * request. Connects lazily on first use and keeps retrying after a failed
 * connection attempt — same lazy-connect contract as
 * `createRedisRateLimitStore`.
 *
 * Entries carry a TTL (default 7 days) so an abandoned URL's cached HTML
 * eventually falls out of Redis on its own, the same reason the in-memory
 * `IsrCache` bounds itself with `maxEntries` -- a shared store needs its own
 * answer to "unbounded growth," since there's no LRU cap to reuse here. The
 * TTL only guards against a replica never requesting a URL again; the
 * app-level `revalidate` staleness check (comparing `entry.timestamp`
 * against `revalidateSeconds`) is unaffected and keeps working exactly as it
 * does for the in-memory store.
 */
export function createRedisIsrCacheStore(
  options: { url?: string; ttlSeconds?: number } = {},
): IsrCacheStore {
  return createRedisIsrCacheStoreFromClient(createBunRedisClient(options), options.ttlSeconds);
}

/**
 * Builds the Redis-backed ISR cache store from an explicit client factory.
 * Exposed for testing and custom transports; the default factory is Bun's
 * `Bun.RedisClient`.
 */
export function createRedisIsrCacheStoreFromClient(
  clientFactory: RedisClientFactory,
  ttlSeconds = 7 * 24 * 60 * 60,
): IsrCacheStore {
  let client: RedisClientLike | null = null;
  let connecting: Promise<RedisClientLike> | null = null;

  function getClient(): Promise<RedisClientLike> {
    if (client) return Promise.resolve(client);
    if (!connecting) {
      // Clear `connecting` on failure so a transient blip (Redis briefly
      // unreachable at boot) doesn't poison every later call with the same
      // rejected promise -- the store keeps retrying on each subsequent call.
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

  return {
    async get(key) {
      const c = await getClient();
      const raw = await c.sendCommand("GET", REDIS_KEY_PREFIX + key);
      if (typeof raw !== "string") return undefined;
      try {
        return JSON.parse(raw) as StaticCacheEntry;
      } catch {
        // A value that isn't valid JSON (e.g. written by something else
        // under the same key prefix) is treated as a miss, not a crash.
        return undefined;
      }
    },

    async set(key, entry) {
      const c = await getClient();
      await c.sendCommand(
        "SET",
        REDIS_KEY_PREFIX + key,
        JSON.stringify(entry),
        "EX",
        String(ttlSeconds),
      );
    },

    async delete(key) {
      const c = await getClient();
      await c.sendCommand("DEL", REDIS_KEY_PREFIX + key);
    },

    async deletePath(pathname) {
      const c = await getClient();
      // Two patterns, not one: a naive `${pathname}*` would also match
      // "/blog/post10" while purging "/blog/post1" -- the same
      // prefix-collision class of bug as a path-traversal check missing its
      // separator boundary. The exact pathname, and the pathname followed by
      // a literal "?" (the start of a query string), are the only two ways a
      // real cache key can extend this pathname. `pathname` itself is
      // glob-escaped so a route like "/blog/post[1]" is matched literally,
      // not interpreted as Redis pattern syntax.
      const exactKey = REDIS_KEY_PREFIX + pathname;
      const escapedKey = REDIS_KEY_PREFIX + escapeRedisGlob(pathname);
      const withQuery = await scanKeys(c, `${escapedKey}\\?*`);
      const exists = await c.sendCommand("EXISTS", exactKey);
      const keysToDelete = [...(Number(exists) > 0 ? [exactKey] : []), ...withQuery];
      if (keysToDelete.length === 0) return 0;
      await c.sendCommand("DEL", ...keysToDelete);
      return keysToDelete.length;
    },

    async clear() {
      const c = await getClient();
      const keys = await scanKeys(c, `${REDIS_KEY_PREFIX}*`);
      if (keys.length === 0) return;
      await c.sendCommand("DEL", ...keys);
    },
  };
}
