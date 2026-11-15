import { describe, expect, test } from "bun:test";
import {
  createRateLimiter,
  createRedisRateLimitStoreFromClient,
  type RedisClientLike,
} from "./rate-limit";

/**
 * A faithful in-memory model of the Redis INCR/EXPIRE behavior the store
 * relies on: INCR bumps a per-key counter (keys are atomic), EXPIRE records a
 * TTL, and a counter resets to a fresh window once its TTL elapses. This keeps
 * the store's logic (counting, window expiry, reconnect-on-failure) pinned
 * deterministically without needing a live Redis or the platform-dependent
 * `bun:redis` module.
 */
class FakeRedis {
  private values = new Map<string, { value: number; expiresAt: number }>();
  private now = () => Date.now();

  client(): RedisClientLike {
    return { sendCommand: (cmd, ...args) => this.run(cmd, ...args) };
  }

  /** Advances the fake clock so TTLs elapse deterministically. */
  setNow(ts: number) {
    this.now = () => ts;
  }

  private run(cmd: string, ...args: string[]): Promise<unknown> {
    const now = this.now();
    switch (cmd) {
      case "EVAL": {
        // Models the store's Lua script atomically: EVAL args are
        // [script, numkeys, key, ttlSeconds]; returns [count, pttl].
        const key = args[2] as string;
        return this.run("INCR", key).then(async (count) => {
          if ((await this.run("PTTL", key)) === -1) {
            await this.run("EXPIRE", key, args[3] as string);
          }
          return [count, await this.run("PTTL", key)];
        });
      }
      case "INCR": {
        const key = args[0] as string;
        const current = this.values.get(key);
        const live = current !== undefined && current.expiresAt > now;
        const value = live ? current.value + 1 : 1;
        // A live key keeps its TTL; a fresh key starts a (TBD, set by EXPIRE) window.
        this.values.set(key, {
          value,
          expiresAt: live ? current.expiresAt : Number.POSITIVE_INFINITY,
        });
        return Promise.resolve(value);
      }
      case "EXPIRE": {
        const key = args[0] as string;
        const current = this.values.get(key);
        if (current === undefined) return Promise.resolve(0);
        this.values.set(key, { value: current.value, expiresAt: now + Number(args[1]) * 1000 });
        return Promise.resolve(1);
      }
      case "PTTL": {
        const key = args[0];
        if (key === undefined) throw new Error("FakeRedis: PTTL requires a key");
        const current = this.values.get(key);
        if (current === undefined) return Promise.resolve(-2);
        if (current.expiresAt === Number.POSITIVE_INFINITY) return Promise.resolve(-1);
        return Promise.resolve(Math.max(0, current.expiresAt - now));
      }
      default:
        throw new Error(`FakeRedis: unhandled command ${cmd}`);
    }
  }
}

describe("createRedisRateLimitStoreFromClient", () => {
  test("increments a counter and returns the running count", async () => {
    const fake = new FakeRedis();
    const store = createRedisRateLimitStoreFromClient(async () => fake.client());

    const first = await store.incr("a", 60_000);
    const second = await store.incr("a", 60_000);
    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
    expect(second.resetAt).toBeGreaterThanOrEqual(first.resetAt);
  });

  test("two store handles over one backend share a counter (cross-instance)", async () => {
    const fake = new FakeRedis();
    const storeA = createRedisRateLimitStoreFromClient(async () => fake.client());
    const storeB = createRedisRateLimitStoreFromClient(async () => fake.client());

    expect((await storeA.incr("shared", 60_000)).count).toBe(1);
    expect((await storeB.incr("shared", 60_000)).count).toBe(2);
    expect((await storeA.incr("shared", 60_000)).count).toBe(3);
  });

  test("wired through createRateLimiter, two limiter instances share one budget", async () => {
    const fake = new FakeRedis();
    const store = createRedisRateLimitStoreFromClient(async () => fake.client());
    const limiterA = createRateLimiter({ limit: 2, windowMs: 60_000, store });
    const limiterB = createRateLimiter({ limit: 2, windowMs: 60_000, store });
    const req = new Request("https://example.com/x", {
      headers: { "x-forwarded-for": "203.0.113.99" },
    });

    expect((await limiterA.check(req)).ok).toBe(true);
    expect((await limiterB.check(req)).ok).toBe(true);
    expect((await limiterA.check(req)).ok).toBe(false);
    limiterA.dispose();
    limiterB.dispose();
  });

  test("INCR and expiry run in one round trip, so a dropped connection cannot strand a key without a TTL", async () => {
    const fake = new FakeRedis();
    const sent: string[] = [];
    const client: RedisClientLike = {
      sendCommand: async (cmd, ...args) => {
        sent.push(cmd);
        // Simulate the connection dropping after the first command is sent.
        if (sent.length > 1) throw new Error("connection dropped");
        return fake.client().sendCommand(cmd, ...args);
      },
    };
    const store = createRedisRateLimitStoreFromClient(async () => client);

    await expect(store.incr("atomic", 60_000)).resolves.toMatchObject({ count: 1 });
    expect(sent).toEqual(["EVAL"]);
  });

  test("a key still gets its TTL when the reply to EVAL is lost", async () => {
    const fake = new FakeRedis();
    const client: RedisClientLike = {
      sendCommand: async (cmd, ...args) => {
        // The server runs the script, then the connection drops before the reply arrives.
        await fake.client().sendCommand(cmd, ...args);
        throw new Error("connection dropped");
      },
    };
    const store = createRedisRateLimitStoreFromClient(async () => client);

    await expect(store.incr("lost", 60_000)).rejects.toThrow("connection dropped");
    expect(await fake.client().sendCommand("PTTL", "x:ratelimit:lost")).toBeGreaterThan(0);
  });

  test("repairs a counter stranded without a TTL by the old non-atomic store", async () => {
    const fake = new FakeRedis();
    // Old bug: the counter reached 5 but EXPIRE never ran.
    for (let i = 0; i < 5; i++) await fake.client().sendCommand("INCR", "x:ratelimit:stranded");
    const store = createRedisRateLimitStoreFromClient(async () => fake.client());

    const result = await store.incr("stranded", 60_000);
    expect(result.count).toBe(6);
    expect(result.resetAt - Date.now()).toBeGreaterThan(0);
    expect(await fake.client().sendCommand("PTTL", "x:ratelimit:stranded")).toBeGreaterThan(0);
  });

  test("falls back to INCR/PTTL when the server denies scripting, and stops retrying EVAL", async () => {
    const fake = new FakeRedis();
    const commands: string[] = [];
    const client: RedisClientLike = {
      sendCommand: async (cmd, ...args) => {
        commands.push(cmd);
        if (cmd === "EVAL") {
          throw new Error("NOPERM User default has no permissions to run the 'eval' command");
        }
        return fake.client().sendCommand(cmd, ...args);
      },
    };
    const store = createRedisRateLimitStoreFromClient(async () => client);

    await expect(store.incr("noscript", 60_000)).resolves.toMatchObject({ count: 1 });
    await expect(store.incr("noscript", 60_000)).resolves.toMatchObject({ count: 2 });
    expect(commands.filter((c) => c === "EVAL").length).toBe(1);
    expect(await fake.client().sendCommand("PTTL", "x:ratelimit:noscript")).toBeGreaterThan(0);
  });

  test("does not hide non-scripting Redis errors behind the fallback", async () => {
    const client: RedisClientLike = {
      sendCommand: async () => {
        throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
      },
    };
    const store = createRedisRateLimitStoreFromClient(async () => client);

    await expect(store.incr("wrongtype", 60_000)).rejects.toThrow("WRONGTYPE");
  });

  test("resetAt derives from the key's remaining TTL, not Date.now()+windowMs (#135)", async () => {
    // Mid-window: the key already has 30s of its 60s window EXPIRED away, so
    // the real reset is only ~30s ahead. The buggy store returned
    // Date.now()+windowMs on every call, sliding Retry-After forward and
    // pinning resetAt ~60s ahead. With PTTL driving resetAt it must land ~30s
    // ahead, and stay pinned across calls.
    const t0 = Date.now();
    const remaining = 30_000;
    const client: RedisClientLike = {
      sendCommand: async (cmd) => {
        if (cmd === "EVAL") return [2, remaining];
        throw new Error(`unhandled command ${cmd}`);
      },
    };
    const store = createRedisRateLimitStoreFromClient(async () => client);

    const first = await store.incr("d", 60_000);
    const second = await store.incr("d", 60_000);

    expect(first.resetAt).toBeGreaterThan(t0 + 25_000);
    expect(first.resetAt).toBeLessThan(t0 + 35_000);
    expect(second.resetAt).toBeGreaterThan(first.resetAt - 2_000);
    expect(second.resetAt).toBeLessThan(first.resetAt + 2_000);
  });

  test("a new window starts fresh once the key's TTL elapses", async () => {
    const fake = new FakeRedis();
    const store = createRedisRateLimitStoreFromClient(async () => fake.client());

    expect((await store.incr("w", 500)).count).toBe(1);
    expect((await store.incr("w", 500)).count).toBe(2);

    fake.setNow(Date.now() + 1500);
    expect((await store.incr("w", 500)).count).toBe(1);
  });

  test("sets a 1-second minimum TTL and round up sub-second windows", async () => {
    const fake = new FakeRedis();
    const ttls: string[] = [];
    const client: RedisClientLike = {
      sendCommand: async (cmd, ...args) => {
        if (cmd === "EVAL") ttls.push(args[3] as string);
        return fake.client().sendCommand(cmd, ...args);
      },
    };
    const store = createRedisRateLimitStoreFromClient(async () => client);

    await store.incr("ttl", 500);
    await store.incr("ttl2", 1_200);
    expect(ttls).toEqual(["1", "2"]);
  });

  test("uses one EVAL per increment, with the window TTL only set on the first", async () => {
    const fake = new FakeRedis();
    const commands: string[] = [];
    const client: RedisClientLike = {
      sendCommand: async (cmd, ...args) => {
        commands.push(cmd);
        return fake.client().sendCommand(cmd, ...args);
      },
    };
    const store = createRedisRateLimitStoreFromClient(async () => client);

    await store.incr("e", 60_000);
    await store.incr("e", 60_000);
    expect(commands).toEqual(["EVAL", "EVAL"]);
  });

  test("keys are stored under the x:ratelimit: prefix", async () => {
    const seen: string[] = [];
    const client: RedisClientLike = {
      sendCommand: async (cmd, ...args) => {
        if (cmd === "EVAL") seen.push(args[2] as string);
        return [1, 60_000];
      },
    };
    const store = createRedisRateLimitStoreFromClient(async () => client);
    await store.incr("ip-1.2.3.4", 60_000);
    expect(seen).toEqual(["x:ratelimit:ip-1.2.3.4"]);
  });

  test("a failed connection does not poison later attempts (connecting is reset)", async () => {
    let attempts = 0;
    const factory = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("ECONNREFUSED");
      return { sendCommand: async () => [1, 60_000] };
    };
    const store = createRedisRateLimitStoreFromClient(factory);

    await expect(store.incr("r", 60_000)).rejects.toThrow("ECONNREFUSED");
    await expect(store.incr("r", 60_000)).resolves.toMatchObject({ count: 1 });
    expect(attempts).toBe(2);
  });

  test("a single client is reused across increments", async () => {
    let connects = 0;
    const store = createRedisRateLimitStoreFromClient(async () => {
      connects += 1;
      return { sendCommand: async () => [1, 60_000] };
    });

    await store.incr("c", 60_000);
    await store.incr("c", 60_000);
    await store.incr("c", 60_000);
    expect(connects).toBe(1);
  });
});
