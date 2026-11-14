import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./createApp";
import { setErrorReporter } from "./observability/monitoring";

/**
 * Regression tests for `requestTimeoutMs`: a single hung handler must not be
 * able to stall the whole process indefinitely — the server gives up and
 * returns 504 once the budget is exceeded.
 */

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/timeout");
const PAGES_DIR = join(FIXTURE_DIR, "pages");

function touch(relPath: string, content: string) {
  const full = join(FIXTURE_DIR, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

let captured: { error: unknown; context: unknown }[] = [];

beforeAll(() => {
  touch(
    "pages/index.tsx",
    `export const mode = "server";
export default function Home() {
  return <h1>Home</h1>;
}
`,
  );
  touch(
    "pages/slow.tsx",
    `export const mode = "server";
export async function loader() {
  await new Promise((resolve) => setTimeout(resolve, 200));
  return {};
}
export default function Slow() {
  return <h1>Slow</h1>;
}
`,
  );
  setErrorReporter({
    captureException(error, context) {
      captured.push({ error, context });
    },
  });
});

afterAll(() => {
  setErrorReporter({ captureException: () => {} });
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe("requestTimeoutMs", () => {
  test("a handler that exceeds the budget gets a 504, not an indefinite hang", async () => {
    const a = await createApp({
      pagesDir: PAGES_DIR,
      development: false,
      requestTimeoutMs: 20,
      security: { headers: false },
      observability: { logging: false },
    });
    captured = [];

    const res = await a.fetch(new Request("http://localhost/slow"));
    expect(res.status).toBe(504);
    expect(await res.text()).toContain("Gateway Timeout");

    expect(captured.length).toBe(1);
    expect(captured[0]).toEqual(
      expect.objectContaining({
        context: expect.objectContaining({ phase: "api", route: "/slow" }),
      }),
    );
  });

  test("a handler within the budget is unaffected", async () => {
    const a = await createApp({
      pagesDir: PAGES_DIR,
      development: false,
      requestTimeoutMs: 5000,
      security: { headers: false },
      observability: { logging: false },
    });

    const res = await a.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h1>Home</h1>");
  });

  test("no requestTimeoutMs configured behaves exactly as before (no timeout applied)", async () => {
    const a = await createApp({
      pagesDir: PAGES_DIR,
      development: false,
      security: { headers: false },
      observability: { logging: false },
    });

    const res = await a.fetch(new Request("http://localhost/slow"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h1>Slow</h1>");
  });

  test("server still serves healthy routes after a timeout", async () => {
    const a = await createApp({
      pagesDir: PAGES_DIR,
      development: false,
      requestTimeoutMs: 20,
      security: { headers: false },
      observability: { logging: false },
    });

    expect((await a.fetch(new Request("http://localhost/slow"))).status).toBe(504);
    const res = await a.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
  });
});
