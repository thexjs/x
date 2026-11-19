import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./createApp";
import { isTrustedProxy, resetTrustedProxy } from "./security/trusted-proxy";

/**
 * Regression tests for `security.trustProxy`: the `x.config.ts`-level
 * opt-in `trusted-proxy.ts`'s own doc comment already describes, but that
 * never actually existed anywhere in the codebase (#238) -- the only way to
 * enable it was calling `configureTrustedProxy()` directly.
 */

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/trust-proxy");
const PAGES_DIR = join(FIXTURE_DIR, "pages");

function touch(relPath: string, content: string) {
  const full = join(FIXTURE_DIR, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeAll(() => {
  touch(
    "pages/index.tsx",
    `export default function Home() {
  return <h1>Home</h1>;
}
`,
  );
});

afterEach(() => {
  resetTrustedProxy();
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe("security.trustProxy", () => {
  test("unset leaves the default (untrusted) in place", async () => {
    await createApp({ pagesDir: PAGES_DIR, development: true });
    expect(isTrustedProxy()).toBe(false);
  });

  test("false leaves the default (untrusted) in place", async () => {
    await createApp({
      pagesDir: PAGES_DIR,
      development: true,
      security: { trustProxy: false },
    });
    expect(isTrustedProxy()).toBe(false);
  });

  test("true enables trusted forwarded-header handling", async () => {
    await createApp({
      pagesDir: PAGES_DIR,
      development: true,
      security: { trustProxy: true },
    });
    expect(isTrustedProxy()).toBe(true);
  });

  test("unset/false never overrides a trust decision an adapter already made at its own init point", async () => {
    // Simulates adapter-vercel's bridge: it calls configureTrustedProxy(true)
    // at its own top-level init, *before* createApp() runs inside the same
    // bundle. createApp() must not then flip it back to untrusted just
    // because the app's own x.config.ts never set security.trustProxy.
    const { configureTrustedProxy } = await import("./security/trusted-proxy");
    configureTrustedProxy({ trustForwardedHeaders: true });

    await createApp({ pagesDir: PAGES_DIR, development: true });
    expect(isTrustedProxy()).toBe(true);
  });
});
