import { describe, expect, test } from "bun:test";
import { IsrCache, isrCacheKey } from "./isr-cache";

describe("isrCacheKey", () => {
  test("keeps pathname and search, ignores host", () => {
    expect(isrCacheKey("http://localhost/blog/one")).toBe("/blog/one");
    expect(isrCacheKey("http://localhost/search?q=alpha&page=2")).toBe("/search?q=alpha&page=2");
  });
});

describe("IsrCache", () => {
  test("getOrCompute computes once across concurrent misses (stampede dedup)", async () => {
    const cache = new IsrCache();
    let computeCount = 0;

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        cache.getOrCompute("/a", async () => {
          computeCount++;
          await Bun.sleep(5);
          return { html: "html-a", cspNonce: "nonce-a" };
        }),
      ),
    );

    expect(computeCount).toBe(1);
    expect(results.every((r) => !(r instanceof Response) && r.html === "html-a")).toBe(true);

    const cached = await cache.getOrCompute("/a", () =>
      Promise.resolve({ html: "html-a-2", cspNonce: "nonce-b" }),
    );
    expect(cached).not.toBeInstanceOf(Response);
    if (cached instanceof Response) return;
    expect(cached.html).toBe("html-a");
    // Nonce from the first computation is reused, not the second compute's.
    expect(cached.cspNonce).toBe("nonce-a");
  });

  test("Response results are passed through and never cached", async () => {
    const cache = new IsrCache();
    const response = new Response("redirect", { status: 302 });

    const first = await cache.getOrCompute("/r", async () => {
      await Bun.sleep(2);
      return response;
    });
    expect(first).toBe(response);
    expect(cache.size).toBe(0);
  });

  test("evicts oldest entries past maxEntries (LRU)", async () => {
    const cache = new IsrCache(2);
    await cache.set("/1", "one", "n1");
    await cache.set("/2", "two", "n2");
    await cache.set("/3", "three", "n3");
    expect(cache.size).toBe(2);
    expect(await cache.get("/1")).toBeUndefined();

    // Touching /2 makes it most-recently-used, so /3 is evicted next.
    expect((await cache.get("/2"))?.html).toBe("two");
    await cache.set("/4", "four", "n4");
    expect(await cache.get("/3")).toBeUndefined();
    expect((await cache.get("/4"))?.html).toBe("four");
  });

  test("deletePath purges every query variant under a pathname", async () => {
    const cache = new IsrCache();
    await cache.set("/search?q=alpha", "a", "n1");
    await cache.set("/search?q=beta", "b", "n2");
    await cache.set("/other", "o", "n3");

    expect(await cache.deletePath("/search")).toBe(2);
    expect(cache.size).toBe(1);
    expect((await cache.get("/other"))?.html).toBe("o");
  });

  test("clear empties everything", async () => {
    const cache = new IsrCache();
    await cache.set("/1", "one", "n1");
    await cache.set("/2", "two", "n2");
    await cache.clear();
    expect(cache.size).toBe(0);
  });
});
