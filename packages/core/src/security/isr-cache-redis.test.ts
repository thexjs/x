import { describe, expect, test } from "bun:test";
import {
  createRedisIsrCacheStoreFromClient,
  type RedisClientLike,
  type StaticCacheEntry,
} from "./isr-cache";

/**
 * A faithful in-memory model of the Redis commands the store relies on:
 * GET/SET with EX, DEL, EXISTS, and SCAN with a MATCH glob pattern. Keeps the
 * store's logic (serialization, TTL, pattern-based purge, reconnect-on-
 * failure) pinned deterministically without needing a live Redis.
 */
class FakeRedis {
  private values = new Map<string, { value: string; expiresAt: number | null }>();
  private now = () => Date.now();

  client(): RedisClientLike {
    return { sendCommand: (cmd, ...args) => this.run(cmd, ...args) };
  }

  setNow(ts: number) {
    this.now = () => ts;
  }

  /** Translates a Redis glob pattern (`*`, `?`, `\`-escaped literals) to a RegExp. */
  private static globToRegExp(pattern: string): RegExp {
    let out = "";
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === "\\" && i + 1 < pattern.length) {
        out += pattern[++i]?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        continue;
      }
      if (ch === "*") {
        out += ".*";
      } else if (ch === "?") {
        out += ".";
      } else {
        out += ch?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
    }
    return new RegExp(`^${out}$`);
  }

  private run(cmd: string, ...args: string[]): Promise<unknown> {
    const now = this.now();
    switch (cmd) {
      case "GET": {
        const key = args[0] as string;
        const entry = this.values.get(key);
        if (!entry) return Promise.resolve(null);
        if (entry.expiresAt !== null && entry.expiresAt <= now) {
          this.values.delete(key);
          return Promise.resolve(null);
        }
        return Promise.resolve(entry.value);
      }
      case "SET": {
        const [key, value, exFlag, exSeconds] = args;
        const expiresAt =
          exFlag === "EX" && exSeconds !== undefined ? now + Number(exSeconds) * 1000 : null;
        this.values.set(key as string, { value: value as string, expiresAt });
        return Promise.resolve("OK");
      }
      case "DEL": {
        let count = 0;
        for (const key of args) if (this.values.delete(key)) count++;
        return Promise.resolve(count);
      }
      case "EXISTS": {
        const key = args[0] as string;
        return Promise.resolve(this.values.has(key) ? 1 : 0);
      }
      case "SCAN": {
        // args: cursor, "MATCH", pattern, "COUNT", n -- this fake always
        // returns every match in one page (cursor "0"), real pagination
        // behavior isn't what's under test here.
        const pattern = args[2] as string;
        const re = FakeRedis.globToRegExp(pattern);
        const matches = [...this.values.keys()].filter((k) => re.test(k));
        return Promise.resolve(["0", matches]);
      }
      default:
        throw new Error(`FakeRedis: unhandled command ${cmd}`);
    }
  }
}

describe("createRedisIsrCacheStoreFromClient", () => {
  test("round-trips an entry through set/get", async () => {
    const fake = new FakeRedis();
    const store = createRedisIsrCacheStoreFromClient(async () => fake.client());
    const entry: StaticCacheEntry = { html: "<h1>hi</h1>", timestamp: Date.now(), cspNonce: "n1" };

    await store.set("/a", entry);
    expect(await store.get("/a")).toEqual(entry);
  });

  test("a missing key is a clean miss, not a crash", async () => {
    const fake = new FakeRedis();
    const store = createRedisIsrCacheStoreFromClient(async () => fake.client());
    expect(await store.get("/missing")).toBeUndefined();
  });

  test("a value that isn't valid JSON is treated as a miss", async () => {
    const fake = new FakeRedis();
    await fake.client().sendCommand("SET", "x:isr:/corrupt", "not json");
    const store = createRedisIsrCacheStoreFromClient(async () => fake.client());
    expect(await store.get("/corrupt")).toBeUndefined();
  });

  test("delete removes exactly the one key", async () => {
    const fake = new FakeRedis();
    const store = createRedisIsrCacheStoreFromClient(async () => fake.client());
    const entry: StaticCacheEntry = { html: "x", timestamp: Date.now(), cspNonce: "n" };
    await store.set("/a", entry);
    await store.set("/b", entry);

    await store.delete("/a");
    expect(await store.get("/a")).toBeUndefined();
    expect(await store.get("/b")).toEqual(entry);
  });

  test("two store handles over one backend share cached entries (cross-instance)", async () => {
    const fake = new FakeRedis();
    const storeA = createRedisIsrCacheStoreFromClient(async () => fake.client());
    const storeB = createRedisIsrCacheStoreFromClient(async () => fake.client());
    const entry: StaticCacheEntry = { html: "shared", timestamp: Date.now(), cspNonce: "n" };

    await storeA.set("/shared", entry);
    expect(await storeB.get("/shared")).toEqual(entry);
  });

  test("deletePath purges the exact pathname and every query variant, nothing else", async () => {
    const fake = new FakeRedis();
    const store = createRedisIsrCacheStoreFromClient(async () => fake.client());
    const e = (html: string): StaticCacheEntry => ({
      html,
      timestamp: 1_700_000_000_000,
      cspNonce: "n",
    });

    await store.set("/search", e("bare"));
    await store.set("/search?q=alpha", e("alpha"));
    await store.set("/search?q=beta", e("beta"));
    await store.set("/other", e("other"));

    const removed = await store.deletePath("/search");
    expect(removed).toBe(3);
    expect(await store.get("/search")).toBeUndefined();
    expect(await store.get("/search?q=alpha")).toBeUndefined();
    expect(await store.get("/search?q=beta")).toBeUndefined();
    expect(await store.get("/other")).toEqual(e("other"));
  });

  test("deletePath does not prefix-collide with a longer pathname sharing the same prefix", async () => {
    const fake = new FakeRedis();
    const store = createRedisIsrCacheStoreFromClient(async () => fake.client());
    const e = (html: string): StaticCacheEntry => ({
      html,
      timestamp: 1_700_000_000_000,
      cspNonce: "n",
    });

    await store.set("/blog/post1", e("one"));
    await store.set("/blog/post10", e("ten"));
    await store.set("/blog/post10?draft=true", e("ten-draft"));

    const removed = await store.deletePath("/blog/post1");
    expect(removed).toBe(1);
    expect(await store.get("/blog/post1")).toBeUndefined();
    // "/blog/post10" and its query variant must survive -- a naive
    // `${pathname}*` glob would have swept these up too.
    expect(await store.get("/blog/post10")).toEqual(e("ten"));
    expect(await store.get("/blog/post10?draft=true")).toEqual(e("ten-draft"));
  });

  test("deletePath escapes glob metacharacters in the pathname itself", async () => {
    const fake = new FakeRedis();
    const store = createRedisIsrCacheStoreFromClient(async () => fake.client());
    const e = (html: string): StaticCacheEntry => ({
      html,
      timestamp: 1_700_000_000_000,
      cspNonce: "n",
    });

    // A route segment that happens to look like a Redis glob character class.
    await store.set("/blog/post[1]", e("bracket"));
    await store.set("/blog/postX1X", e("decoy")); // would match `[1]` as a char class if unescaped

    const removed = await store.deletePath("/blog/post[1]");
    expect(removed).toBe(1);
    expect(await store.get("/blog/post[1]")).toBeUndefined();
    expect(await store.get("/blog/postX1X")).toEqual(e("decoy"));
  });

  test("deletePath returns 0 when nothing matches", async () => {
    const fake = new FakeRedis();
    const store = createRedisIsrCacheStoreFromClient(async () => fake.client());
    expect(await store.deletePath("/nothing-here")).toBe(0);
  });

  test("clear empties every entry under the store's key prefix, nothing else", async () => {
    const fake = new FakeRedis();
    const store = createRedisIsrCacheStoreFromClient(async () => fake.client());
    const e = (html: string): StaticCacheEntry => ({
      html,
      timestamp: 1_700_000_000_000,
      cspNonce: "n",
    });
    await store.set("/a", e("a"));
    await store.set("/b", e("b"));
    // A key outside the store's own prefix must survive a clear().
    await fake.client().sendCommand("SET", "someone-elses-key", "untouched");

    await store.clear();
    expect(await store.get("/a")).toBeUndefined();
    expect(await store.get("/b")).toBeUndefined();
    expect(await fake.client().sendCommand("GET", "someone-elses-key")).toBe("untouched");
  });

  test("entries carry the configured TTL", async () => {
    const fake = new FakeRedis();
    const store = createRedisIsrCacheStoreFromClient(async () => fake.client(), 10);
    const entry: StaticCacheEntry = { html: "x", timestamp: Date.now(), cspNonce: "n" };

    await store.set("/a", entry);
    expect(await store.get("/a")).toEqual(entry);

    fake.setNow(Date.now() + 11_000);
    expect(await store.get("/a")).toBeUndefined();
  });

  test("keys are stored under the x:isr: prefix", async () => {
    const seen: string[] = [];
    const client: RedisClientLike = {
      sendCommand: async (cmd, ...args) => {
        if (cmd === "SET") seen.push(args[0] as string);
        return "OK";
      },
    };
    const store = createRedisIsrCacheStoreFromClient(async () => client);
    await store.set("/a", { html: "x", timestamp: Date.now(), cspNonce: "n" });
    expect(seen).toEqual(["x:isr:/a"]);
  });

  test("a failed connection does not poison later attempts (connecting is reset)", async () => {
    let attempts = 0;
    const factory = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("ECONNREFUSED");
      return { sendCommand: async () => null };
    };
    const store = createRedisIsrCacheStoreFromClient(factory);

    await expect(store.get("/r")).rejects.toThrow("ECONNREFUSED");
    await expect(store.get("/r")).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  test("a single client is reused across calls", async () => {
    let connects = 0;
    const store = createRedisIsrCacheStoreFromClient(async () => {
      connects += 1;
      return { sendCommand: async () => null };
    });

    await store.get("/a");
    await store.get("/b");
    await store.get("/c");
    expect(connects).toBe(1);
  });
});
