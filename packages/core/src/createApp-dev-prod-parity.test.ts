import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./createApp";

/**
 * Dev and prod build their fetch handler from the same `buildFetchInner`
 * pipeline (#153) — dev's only real difference is the extra `/__x/reload`
 * SSE endpoint. These tests pin that the two modes handle everything else
 * identically, so the two paths can't silently diverge again in the future.
 */
const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/dev-prod-parity");
const PAGES_DIR = join(FIXTURE_DIR, "pages");

function touch(relPath: string, content: string) {
  const full = join(PAGES_DIR, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeAll(() => {
  touch("index.tsx", `export default function Home() { return <h1>Home</h1>; }\n`);
  touch("about.tsx", `export default function About() { return <h1>About</h1>; }\n`);
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

async function makeApps() {
  const dev = await createApp({
    pagesDir: PAGES_DIR,
    development: true,
    security: { headers: false },
    observability: { logging: false },
  });
  const prod = await createApp({
    pagesDir: PAGES_DIR,
    development: false,
    security: { headers: false },
    observability: { logging: false },
  });
  return { dev, prod };
}

async function snapshot(res: Response) {
  return { status: res.status, body: await res.text() };
}

// Dev legitimately injects a live-reload `<script>` (with a per-response
// CSP nonce) into every HTML page — that's dev tooling, not part of the
// shared fetch pipeline this refactor is about. Strip it out before
// comparing HTML bodies so these tests pin pipeline parity, not the
// unrelated reload-script injection.
function stripDevReloadScript(html: string): string {
  return html
    .replace(
      /<script nonce="[^"]*">\(function \(\) \{\s*var es = new EventSource[\s\S]*?<\/script>/,
      "",
    )
    .replace(/ nonce="[^"]*"/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

describe("dev/prod fetch pipeline parity (#153)", () => {
  test("a normal route is served identically", async () => {
    const { dev, prod } = await makeApps();

    const devRes = await snapshot(await dev.fetch(new Request("http://localhost/about")));
    const prodRes = await snapshot(await prod.fetch(new Request("http://localhost/about")));

    expect(devRes.status).toBe(200);
    expect(prodRes.status).toBe(200);
    expect(stripDevReloadScript(devRes.body)).toBe(stripDevReloadScript(prodRes.body));
  });

  test("a missing route 404s identically", async () => {
    const { dev, prod } = await makeApps();

    const devRes = await snapshot(await dev.fetch(new Request("http://localhost/nope")));
    const prodRes = await snapshot(await prod.fetch(new Request("http://localhost/nope")));

    expect(devRes.status).toBe(404);
    expect(prodRes.status).toBe(404);
    expect(stripDevReloadScript(devRes.body)).toBe(stripDevReloadScript(prodRes.body));
  });

  test("/__x/hydration-mismatch is handled identically", async () => {
    const { dev, prod } = await makeApps();

    const makeReq = () =>
      new Request("http://localhost/__x/hydration-mismatch", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({
          error: "text did not match server-rendered HTML",
          island: "Counter",
          url: "http://localhost/about",
        }),
      });

    const devRes = await snapshot(await dev.fetch(makeReq()));
    const prodRes = await snapshot(await prod.fetch(makeReq()));

    expect(devRes.status).toBe(204);
    expect(devRes).toEqual(prodRes);
  });

  test("/__x/revalidate is handled identically", async () => {
    const { dev, prod } = await makeApps();

    const makeReq = () =>
      new Request("http://localhost/__x/revalidate", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ path: "/about" }),
      });

    const devRes = await snapshot(await dev.fetch(makeReq()));
    const prodRes = await snapshot(await prod.fetch(makeReq()));

    expect(devRes.status).toBe(200);
    expect(devRes).toEqual(prodRes);
  });

  test("dev still serves its one real extra: the /__x/reload SSE endpoint", async () => {
    const { dev, prod } = await makeApps();

    const devRes = await dev.fetch(new Request("http://localhost/__x/reload"));
    expect(devRes.status).toBe(200);
    expect(devRes.headers.get("content-type")).toBe("text/event-stream");

    // Prod has no reload stream, so without it the same request just falls
    // through the shared pipeline to the 404 page.
    const prodRes = await prod.fetch(new Request("http://localhost/__x/reload"));
    expect(prodRes.status).toBe(404);
  });
});
