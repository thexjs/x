import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { renderToString } from "react-dom/server";
import { unmountIslandRoots } from "./client-nav";
import { createIslandRegistry, Island, IslandProvider } from "./island";
import {
  buildIslandBundleInMemory,
  generateHydrateEntry,
  hashId,
  islandEntryId,
  resolveIslandPaths,
} from "./island-bundle";

declare global {
  interface Window {
    __xTestCleanupCount?: number;
  }
}

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/islands");
const ROUTE_PATH = join(FIXTURE_DIR, "route.tsx");

const ROUTE_SOURCE = `import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((c) => c + 1)}>Like {count}</button>;
}

export const islands = { Counter };
`;

const CLEANUP_ROUTE_PATH = join(FIXTURE_DIR, "route-cleanup.tsx");

const CLEANUP_ROUTE_SOURCE = `import { useEffect, useState } from "react";

export function CleanupTracker() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    return () => {
      window.__xTestCleanupCount = (window.__xTestCleanupCount || 0) + 1;
    };
  }, []);
  return <div>{mounted ? "alive" : "init"}</div>;
}

export const islands = { CleanupTracker };
`;

// Fixtures for the #174-adjacent bug: a route combining a server-only loader
// (something that touches node:crypto, same as the real @thexjs/auth case
// that surfaced this) with an `islands` export. Historically that always
// leaked the loader's imports into the client bundle, because resolving
// `Route.islands?.[name]` required evaluating the whole module. A
// *string*-valued island entry should resolve via a direct import of that
// path instead, never touching the route module (or its loader) at all.
const LEAKY_HELPER_PATH = join(FIXTURE_DIR, "leaky-loader-helper.ts");
const LEAKY_HELPER_SOURCE = `import { timingSafeEqual } from "node:crypto";
export function checkSecret(a: Uint8Array, b: Uint8Array) {
  return timingSafeEqual(a, b);
}
`;

const PATH_ISLAND_PATH = join(FIXTURE_DIR, "path-island.tsx");
const PATH_ISLAND_SOURCE = `export default function PathIsland() {
  return <button>path island</button>;
}
`;

const LEAKY_ROUTE_PATH = join(FIXTURE_DIR, "leaky-route.tsx");
const LEAKY_ROUTE_SOURCE = `import { checkSecret } from "./leaky-loader-helper";

export async function loader() {
  checkSecret(new Uint8Array([1]), new Uint8Array([1]));
  return {};
}

export function InlineIsland() {
  return <button>inline island</button>;
}

export const islands = {
  InlineIsland,
  PathIsland: "./path-island",
};
`;

const LEAKY_LAYOUT_PATH = join(FIXTURE_DIR, "leaky-layout.tsx");
const LEAKY_LAYOUT_SOURCE = `export const islands = { LayoutPathIsland: "./path-island" };
export default function Layout({ children }) {
  return children;
}
`;

const ROUTE_NO_ISLANDS_PATH = join(FIXTURE_DIR, "route-no-islands.tsx");
const ROUTE_NO_ISLANDS_SOURCE = `export default function Page() {
  return <div>no islands here</div>;
}
`;

// SSR an island exactly as the request pipeline does (IslandProvider + Island),
// so the markup that reaches the browser carries the data-island wrapper.
async function ssrIsland(): Promise<string> {
  const registry = createIslandRegistry();
  const { Counter } = await import(ROUTE_PATH);
  return renderToString(
    <IslandProvider registry={registry}>
      <Island name="Counter">
        <Counter />
      </Island>
    </IslandProvider>,
  );
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

let entryIndex = 0;

// Each test writes a fresh entry file so the dynamic import isn't cached — the
// hydration code must actually run against that test's DOM.
async function hydrate(): Promise<void> {
  const entryPath = join(FIXTURE_DIR, `entry-${entryIndex++}.tsx`);
  writeFileSync(entryPath, generateHydrateEntry(ROUTE_PATH));
  await import(entryPath);
  await tick();
}

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(ROUTE_PATH, ROUTE_SOURCE);
  writeFileSync(CLEANUP_ROUTE_PATH, CLEANUP_ROUTE_SOURCE);
  writeFileSync(LEAKY_HELPER_PATH, LEAKY_HELPER_SOURCE);
  writeFileSync(PATH_ISLAND_PATH, PATH_ISLAND_SOURCE);
  writeFileSync(LEAKY_ROUTE_PATH, LEAKY_ROUTE_SOURCE);
  writeFileSync(LEAKY_LAYOUT_PATH, LEAKY_LAYOUT_SOURCE);
  writeFileSync(ROUTE_NO_ISLANDS_PATH, ROUTE_NO_ISLANDS_SOURCE);
  GlobalRegistrator.register();
});

afterAll(async () => {
  // Let React scheduler drain — unmounting island roots enqueues async work
  // that references window.event; unregistering before it fires causes
  // "ReferenceError: window is not defined" on Bun < 1.4.
  await new Promise((r) => setTimeout(r, 200));
  GlobalRegistrator.unregister();
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe("island hydration runtime", () => {
  test("SSR island output survives the hydration round-trip", async () => {
    document.body.innerHTML = await ssrIsland();
    expect(document.querySelector("button")?.textContent).toBe("Like 0");

    await hydrate();

    const island = document.querySelector("[data-island='Counter']");
    expect(island).not.toBeNull();
    const button = island?.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe("Like 0");
  });

  test("event handlers wired during hydration actually fire", async () => {
    document.body.innerHTML = await ssrIsland();
    await hydrate();

    const button = document.querySelector("button");
    expect(button?.textContent).toBe("Like 0");
    button?.click();
    await tick();
    expect(document.querySelector("button")?.textContent).toBe("Like 1");
    document.querySelector("button")?.click();
    await tick();
    expect(document.querySelector("button")?.textContent).toBe("Like 2");
  });
});

describe("island root unmount on client-nav (#158)", () => {
  beforeEach(() => {
    window.__xIslandRoots = [];
    window.__xTestCleanupCount = 0;
  });

  test("useEffect cleanup fires when island root is unmounted via __xIslandRoots", async () => {
    const registry = createIslandRegistry();
    const { CleanupTracker } = await import(CLEANUP_ROUTE_PATH);
    document.body.innerHTML = renderToString(
      <IslandProvider registry={registry}>
        <Island name="CleanupTracker">
          <CleanupTracker />
        </Island>
      </IslandProvider>,
    );

    const entryPath = join(FIXTURE_DIR, `entry-cleanup-${entryIndex++}.tsx`);
    writeFileSync(entryPath, generateHydrateEntry(CLEANUP_ROUTE_PATH));
    await import(entryPath);
    await tick();

    expect(document.querySelector("div")?.textContent).toBe("alive");
    expect(window.__xTestCleanupCount).toBe(0);
    expect(window.__xIslandRoots).toBeDefined();
    expect(window.__xIslandRoots?.length).toBe(1);

    unmountIslandRoots();
    await tick();

    expect(window.__xTestCleanupCount).toBe(1);
  });

  test("two sequential hydrate cycles do not leak island roots and cleanup fires per cycle", async () => {
    // Use CleanupTracker so we can verify cleanup fires across both cycles,
    // not just that the registry length resets.
    const registry1 = createIslandRegistry();
    const { CleanupTracker } = await import(CLEANUP_ROUTE_PATH);
    document.body.innerHTML = renderToString(
      <IslandProvider registry={registry1}>
        <Island name="CleanupTracker">
          <CleanupTracker />
        </Island>
      </IslandProvider>,
    );

    const entry1 = join(FIXTURE_DIR, `entry-seq1-${entryIndex++}.tsx`);
    writeFileSync(entry1, generateHydrateEntry(CLEANUP_ROUTE_PATH));
    await import(entry1);
    await tick();

    expect(window.__xIslandRoots).toBeDefined();
    expect(window.__xIslandRoots?.length).toBe(1);
    expect(window.__xTestCleanupCount).toBe(0);

    unmountIslandRoots();
    await tick();
    expect(window.__xTestCleanupCount).toBe(1);

    // Second cycle — fresh SSR + hydrate.
    const registry2 = createIslandRegistry();
    document.body.innerHTML = renderToString(
      <IslandProvider registry={registry2}>
        <Island name="CleanupTracker">
          <CleanupTracker />
        </Island>
      </IslandProvider>,
    );

    const entry2 = join(FIXTURE_DIR, `entry-seq2-${entryIndex++}.tsx`);
    writeFileSync(entry2, generateHydrateEntry(CLEANUP_ROUTE_PATH));
    await import(entry2);
    await tick();

    expect(window.__xIslandRoots?.length).toBe(1);

    unmountIslandRoots();
    await tick();
    expect(window.__xTestCleanupCount).toBe(2);
    expect(window.__xIslandRoots?.length).toBe(0);
  });
});

describe("islandEntryId / hashId (#156 collision regression)", () => {
  test("two routes sharing a basename in different directories get different entry ids", () => {
    const a = islandEntryId("/project/src/pages/a/index.tsx");
    const b = islandEntryId("/project/src/pages/b/index.tsx");
    expect(a).not.toBe(b);
  });

  test("hashId produces a wider, fixed-length hex digest", () => {
    const hash = hashId("/project/src/pages/a/index.tsx");
    // 64-bit hash truncated to 16 hex chars -- wide enough to make the
    // basename-collision scenario above astronomically unlikely at any
    // realistic route count, unlike the old 32-bit rolling hash.
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  test("hashId is deterministic for the same input", () => {
    const path = "/project/src/pages/nested/index.tsx";
    expect(hashId(path)).toBe(hashId(path));
  });

  test("different paths produce different hashes across a larger sample (no collisions)", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 500; i++) {
      hashes.add(hashId(`/project/src/pages/dir-${i}/index.tsx`));
    }
    expect(hashes.size).toBe(500);
  });
});

describe("resolveIslandPaths", () => {
  test("resolves a string-valued island entry relative to its owning file's directory", async () => {
    const paths = await resolveIslandPaths(LEAKY_ROUTE_PATH, [], ["PathIsland"]);
    expect(paths).toEqual({
      PathIsland: resolve(dirname(LEAKY_ROUTE_PATH), "./path-island"),
    });
  });

  test("a live component reference (not a string) is not included", async () => {
    const paths = await resolveIslandPaths(LEAKY_ROUTE_PATH, [], ["InlineIsland", "PathIsland"]);
    expect(Object.keys(paths)).toEqual(["PathIsland"]);
  });

  test("falls back to a layout's islands map, resolved relative to the layout's directory", async () => {
    const paths = await resolveIslandPaths(
      ROUTE_NO_ISLANDS_PATH,
      [LEAKY_LAYOUT_PATH],
      ["LayoutPathIsland"],
    );
    expect(paths).toEqual({
      LayoutPathIsland: resolve(dirname(LEAKY_LAYOUT_PATH), "./path-island"),
    });
  });

  test("the route's own entry wins over a layout's for the same name", async () => {
    // LEAKY_ROUTE_PATH declares PathIsland itself; pairing it with a layout
    // that (hypothetically) also declared it should still prefer the route's.
    const paths = await resolveIslandPaths(LEAKY_ROUTE_PATH, [LEAKY_LAYOUT_PATH], ["PathIsland"]);
    expect(paths.PathIsland).toBe(resolve(dirname(LEAKY_ROUTE_PATH), "./path-island"));
  });

  test("returns an empty map for a route with no islands export", async () => {
    const paths = await resolveIslandPaths(ROUTE_NO_ISLANDS_PATH, [], ["Anything"]);
    expect(paths).toEqual({});
  });
});

describe("generateHydrateEntry: path-backed islands", () => {
  test("omitting islandNames preserves the original always-import-Route contract", () => {
    const entry = generateHydrateEntry(ROUTE_PATH);
    expect(entry).toContain(`import * as Route from "${ROUTE_PATH}"`);
  });

  test("a path-backed island is statically imported directly, bypassing the route module", () => {
    const entry = generateHydrateEntry(LEAKY_ROUTE_PATH, [], ["PathIsland"], {
      PathIsland: PATH_ISLAND_PATH,
    });
    expect(entry).toContain(`import __x_island_0 from "${PATH_ISLAND_PATH}"`);
    expect(entry).not.toContain("import * as Route");
  });

  test("a mix of path-backed and module-backed islands still imports Route for the latter", () => {
    const entry = generateHydrateEntry(LEAKY_ROUTE_PATH, [], ["PathIsland", "InlineIsland"], {
      PathIsland: PATH_ISLAND_PATH,
    });
    expect(entry).toContain(`import __x_island_0 from "${PATH_ISLAND_PATH}"`);
    expect(entry).toContain(`import * as Route from "${LEAKY_ROUTE_PATH}"`);
  });
});

describe("buildIslandBundleInMemory: server-only loader + islands co-location (regression)", () => {
  const PROJECT_ROOT = join(import.meta.dir, "__fixtures__/islands-build-root");

  afterAll(() => {
    rmSync(PROJECT_ROOT, { recursive: true, force: true });
  });

  test("a path-backed island builds successfully even though the route's loader imports node:crypto", async () => {
    const code = await buildIslandBundleInMemory(
      LEAKY_ROUTE_PATH,
      [],
      ["PathIsland"],
      new Map(),
      PROJECT_ROOT,
    );
    // A failed build falls back to the non-interactive stub -- its presence
    // would mean the leak reproduced despite PathIsland being path-backed.
    expect(code).not.toContain("hydration fallback");
    expect(code).not.toContain("timingSafeEqual");
    expect(code).toContain("path island");
  });

  test("an inline (non-path-backed) island on the same route still reproduces the original leak", async () => {
    // This is the control: proving the fix is specific to path-backed
    // islands, not an accidental blanket fix that changed behavior for the
    // pre-existing co-located pattern everywhere.
    const code = await buildIslandBundleInMemory(
      LEAKY_ROUTE_PATH,
      [],
      ["InlineIsland"],
      new Map(),
      PROJECT_ROOT,
    );
    expect(code).toContain("hydration fallback");
  });
});
