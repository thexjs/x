import { describe, expect, test } from "bun:test";
import { createRedisBruteForceStoreFromClient, type RedisClientLike } from "./brute-force";

/**
 * A faithful in-memory model of the three Lua scripts the store runs
 * (reserve, release, recordFailure) plus the read-only status script,
 * distinguished by a unique marker string each script's source contains.
 * Keeps the store's logic (atomicity, exponential backoff, the in-flight
 * reservation cap) pinned deterministically without needing a live Redis.
 */
class FakeRedis {
  private buckets = new Map<string, { failures: number; resetAt: number }>();
  private inflight = new Map<string, number>();
  private now = () => Date.now();

  client(): RedisClientLike {
    return { sendCommand: (cmd, ...args) => this.run(cmd, ...args) };
  }

  setNow(ts: number) {
    this.now = () => ts;
  }

  private run(cmd: string, ...args: string[]): Promise<unknown> {
    const now = this.now();
    if (cmd === "DEL") {
      let count = 0;
      for (const key of args) {
        if (this.buckets.delete(key)) count++;
        if (this.inflight.delete(key)) count++;
      }
      return Promise.resolve(count);
    }
    if (cmd !== "EVAL") throw new Error(`FakeRedis: unhandled command ${cmd}`);

    const script = args[0] as string;
    const numKeys = Number(args[1]);
    const keys = args.slice(2, 2 + numKeys);
    const scriptArgs = args.slice(2 + numKeys);

    if (script.includes("newInflight")) return this.reserve(keys, scriptArgs, now);
    if (script.includes("redis.call('DECR'")) return this.release(keys);
    if (script.includes("backoff")) return this.recordFailure(keys, scriptArgs, now);
    return this.status(keys, scriptArgs, now);
  }

  private reserve(keys: string[], args: string[], now: number): Promise<unknown> {
    const [bucketKey, inflightKey] = keys as [string, string];
    const maxAttempts = Number(args[0]);
    const bucket = this.buckets.get(bucketKey);
    const live = bucket !== undefined && bucket.resetAt > now;
    const effectiveResetAt = live ? (bucket?.resetAt ?? now) : now;

    if (live && (bucket?.failures ?? 0) >= maxAttempts) {
      return Promise.resolve([0, maxAttempts - (bucket?.failures ?? 0), effectiveResetAt]);
    }
    const count = this.inflight.get(inflightKey) ?? 0;
    if (count >= maxAttempts) {
      return Promise.resolve([0, maxAttempts - count, effectiveResetAt]);
    }
    this.inflight.set(inflightKey, count + 1);
    return Promise.resolve([1, maxAttempts - (count + 1), effectiveResetAt]);
  }

  private release(keys: string[]): Promise<unknown> {
    const [inflightKey] = keys as [string];
    const count = this.inflight.get(inflightKey) ?? 0;
    if (count <= 1) this.inflight.delete(inflightKey);
    else this.inflight.set(inflightKey, count - 1);
    return Promise.resolve(1);
  }

  private recordFailure(keys: string[], args: string[], now: number): Promise<unknown> {
    const [bucketKey] = keys as [string];
    const windowMs = Number(args[1]);
    const existing = this.buckets.get(bucketKey);
    let failures: number;
    let resetAt: number;
    if (existing && existing.resetAt > now) {
      failures = existing.failures + 1;
      const backoff = Math.min(windowMs * 2 ** (failures - 1), windowMs * 32);
      resetAt = now + backoff;
    } else {
      failures = 1;
      resetAt = now + windowMs;
    }
    this.buckets.set(bucketKey, { failures, resetAt });
    return Promise.resolve([failures, resetAt]);
  }

  private status(keys: string[], args: string[], now: number): Promise<unknown> {
    const [bucketKey] = keys as [string];
    const maxAttempts = Number(args[0]);
    const bucket = this.buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) return Promise.resolve([1, maxAttempts, now]);
    if (bucket.failures >= maxAttempts) {
      return Promise.resolve([0, maxAttempts - bucket.failures, bucket.resetAt]);
    }
    return Promise.resolve([1, maxAttempts - bucket.failures, bucket.resetAt]);
  }
}

describe("createRedisBruteForceStoreFromClient", () => {
  test("reserve admits up to maxAttempts in-flight, then refuses", async () => {
    const fake = new FakeRedis();
    const store = createRedisBruteForceStoreFromClient(async () => fake.client());
    const now = Date.now();

    expect((await store.reserve("a", 3, now)).ok).toBe(true);
    expect((await store.reserve("a", 3, now)).ok).toBe(true);
    expect((await store.reserve("a", 3, now)).ok).toBe(true);
    expect((await store.reserve("a", 3, now)).ok).toBe(false);
  });

  test("release restores capacity", async () => {
    const fake = new FakeRedis();
    const store = createRedisBruteForceStoreFromClient(async () => fake.client());
    const now = Date.now();

    for (let i = 0; i < 3; i++) await store.reserve("a", 3, now);
    expect((await store.reserve("a", 3, now)).ok).toBe(false);

    await store.release("a");
    expect((await store.reserve("a", 3, now)).ok).toBe(true);
  });

  test("two store handles over one backend share the in-flight cap (cross-instance)", async () => {
    const fake = new FakeRedis();
    const storeA = createRedisBruteForceStoreFromClient(async () => fake.client());
    const storeB = createRedisBruteForceStoreFromClient(async () => fake.client());
    const now = Date.now();

    // This is the entire point of the Redis store: without it, two
    // replicas (A and B) would each independently admit up to maxAttempts,
    // effectively doubling the attacker's budget.
    expect((await storeA.reserve("shared", 3, now)).ok).toBe(true);
    expect((await storeB.reserve("shared", 3, now)).ok).toBe(true);
    expect((await storeA.reserve("shared", 3, now)).ok).toBe(true);
    expect((await storeB.reserve("shared", 3, now)).ok).toBe(false);
  });

  test("recordFailure locks the account after maxAttempts, with exponential backoff", async () => {
    const fake = new FakeRedis();
    const store = createRedisBruteForceStoreFromClient(async () => fake.client());
    const now = Date.now();

    const first = await store.recordFailure("a", 3, 60_000, now);
    expect(first.ok).toBe(true);
    expect(first.remaining).toBe(2);

    const second = await store.recordFailure("a", 3, 60_000, now);
    expect(second.ok).toBe(true);
    expect(second.remaining).toBe(1);
    // Backoff doubled on the second failure: windowMs * 2^(2-1) = 120_000.
    expect(second.resetAt - now).toBeCloseTo(120_000, -2);

    const third = await store.recordFailure("a", 3, 60_000, now);
    expect(third.ok).toBe(false);
    expect(third.remaining).toBe(0);
  });

  test("backoff is capped at windowMs * 32", async () => {
    const fake = new FakeRedis();
    const store = createRedisBruteForceStoreFromClient(async () => fake.client());
    const now = Date.now();

    let result = await store.recordFailure("a", 100, 1_000, now);
    for (let i = 0; i < 9; i++) {
      result = await store.recordFailure("a", 100, 1_000, now);
    }
    expect(result.resetAt - now).toBeLessThanOrEqual(32_000);
  });

  test("status reflects the persisted lockout without reserving or recording anything", async () => {
    const fake = new FakeRedis();
    const store = createRedisBruteForceStoreFromClient(async () => fake.client());
    const now = Date.now();

    await store.recordFailure("a", 2, 60_000, now);
    await store.recordFailure("a", 2, 60_000, now);
    expect((await store.status("a", 2, now)).ok).toBe(false);
    // Reading status again doesn't change anything.
    expect((await store.status("a", 2, now)).ok).toBe(false);
  });

  test("a locked bucket's window expiring resets to a fresh, unlocked state", async () => {
    const fake = new FakeRedis();
    const store = createRedisBruteForceStoreFromClient(async () => fake.client());
    const now = Date.now();

    await store.recordFailure("a", 1, 500, now);
    expect((await store.status("a", 1, now)).ok).toBe(false);

    fake.setNow(now + 1_000);
    expect((await store.status("a", 1, now + 1_000)).ok).toBe(true);
    expect((await store.reserve("a", 1, now + 1_000)).ok).toBe(true);
  });

  test("reset clears the persisted bucket", async () => {
    const fake = new FakeRedis();
    const store = createRedisBruteForceStoreFromClient(async () => fake.client());
    const now = Date.now();

    await store.recordFailure("a", 1, 60_000, now);
    expect((await store.status("a", 1, now)).ok).toBe(false);

    await store.reset("a");
    expect((await store.status("a", 1, now)).ok).toBe(true);
  });

  test("keys are stored under the x:bruteforce: prefix", async () => {
    const seen: string[] = [];
    const client: RedisClientLike = {
      sendCommand: async (cmd, ...args) => {
        if (cmd === "EVAL") seen.push(args[2] as string);
        return [1, 60_000];
      },
    };
    const store = createRedisBruteForceStoreFromClient(async () => client);
    await store.reserve("login:account:a@example.com", 5, Date.now());
    expect(seen[0]).toBe("x:bruteforce:bucket:login:account:a@example.com");
  });

  test("throws, with no non-atomic fallback, when the server denies scripting", async () => {
    const client: RedisClientLike = {
      sendCommand: async () => {
        throw new Error("NOPERM User default has no permissions to run the 'eval' command");
      },
    };
    const store = createRedisBruteForceStoreFromClient(async () => client);

    // Unlike the rate-limit store, this one must NOT silently degrade to a
    // non-atomic fallback -- that would reopen the exact #168 TOCTOU race
    // this store exists to close, just across replicas instead of within
    // one process.
    await expect(store.reserve("a", 3, Date.now())).rejects.toThrow(/denied EVAL/);
  });

  test("does not hide non-scripting Redis errors behind a misleading message", async () => {
    const client: RedisClientLike = {
      sendCommand: async () => {
        throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
      },
    };
    const store = createRedisBruteForceStoreFromClient(async () => client);
    await expect(store.reserve("a", 3, Date.now())).rejects.toThrow("WRONGTYPE");
  });

  test("a failed connection does not poison later attempts (connecting is reset)", async () => {
    let attempts = 0;
    const factory = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("ECONNREFUSED");
      return { sendCommand: async () => [1, 3, Date.now()] };
    };
    const store = createRedisBruteForceStoreFromClient(factory);

    await expect(store.reserve("a", 3, Date.now())).rejects.toThrow("ECONNREFUSED");
    await expect(store.reserve("a", 3, Date.now())).resolves.toMatchObject({ ok: true });
    expect(attempts).toBe(2);
  });

  test("a single client is reused across calls", async () => {
    let connects = 0;
    const store = createRedisBruteForceStoreFromClient(async () => {
      connects += 1;
      return { sendCommand: async () => [1, 3, Date.now()] };
    });

    await store.reserve("a", 3, Date.now());
    await store.release("a");
    await store.status("a", 3, Date.now());
    expect(connects).toBe(1);
  });
});
