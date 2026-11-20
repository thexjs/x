import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transpileModules } from "./transpile";
import type { CompiledModuleRef } from "./types";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/transpile");

function touch(relPath: string, content: string): string {
  const full = join(FIXTURE_DIR, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  return full;
}

describe("transpileModules", () => {
  afterAll(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  test("batches every ref into a single Bun.build call and wires each output to the correct compiledPath", async () => {
    // Each fixture file exports a differently-named, differently-valued
    // marker so a cross-wired output (e.g. route A's compiled file ending up
    // with route B's content) is immediately detectable -- this is a
    // correctness check for the output -> compiledPath mapping, not a
    // timing/perf benchmark.
    const routeSource = touch(
      "src/routes/home.tsx",
      `export const routeMarker = "MARKER_ROUTE_HOME_8f3a";\n`,
    );
    const layoutSource = touch(
      "src/layouts/root.tsx",
      `export const layoutMarker = "MARKER_LAYOUT_ROOT_2c91";\n`,
    );
    const actionSource = touch(
      "src/actions/submit.ts",
      `export const actionMarker = "MARKER_ACTION_SUBMIT_d47e";\n`,
    );
    // Deliberately shares a basename with another fixture file (in a
    // different directory) to exercise the case that would most likely
    // trip up a naive path/basename-based mapping.
    const middlewareSource = touch(
      "src/middleware/auth/home.tsx",
      `export const middlewareMarker = "MARKER_MIDDLEWARE_AUTH_71bd";\n`,
    );

    const refs: CompiledModuleRef[] = [
      {
        sourcePath: routeSource,
        compiledPath: join(FIXTURE_DIR, "out/route.mjs"),
        identifier: "__x_0",
      },
      {
        sourcePath: layoutSource,
        compiledPath: join(FIXTURE_DIR, "out/layout.mjs"),
        identifier: "__x_1",
      },
      {
        sourcePath: actionSource,
        compiledPath: join(FIXTURE_DIR, "out/action.mjs"),
        identifier: "__x_2",
      },
      {
        sourcePath: middlewareSource,
        compiledPath: join(FIXTURE_DIR, "out/middleware.mjs"),
        identifier: "__x_3",
      },
    ];

    await transpileModules(refs);

    expect(readFileSync(join(FIXTURE_DIR, "out/route.mjs"), "utf-8")).toContain(
      "MARKER_ROUTE_HOME_8f3a",
    );
    expect(readFileSync(join(FIXTURE_DIR, "out/layout.mjs"), "utf-8")).toContain(
      "MARKER_LAYOUT_ROOT_2c91",
    );
    expect(readFileSync(join(FIXTURE_DIR, "out/action.mjs"), "utf-8")).toContain(
      "MARKER_ACTION_SUBMIT_d47e",
    );
    expect(readFileSync(join(FIXTURE_DIR, "out/middleware.mjs"), "utf-8")).toContain(
      "MARKER_MIDDLEWARE_AUTH_71bd",
    );

    // None of the markers should have leaked into a sibling's output.
    const allMarkers = [
      "MARKER_ROUTE_HOME_8f3a",
      "MARKER_LAYOUT_ROOT_2c91",
      "MARKER_ACTION_SUBMIT_d47e",
      "MARKER_MIDDLEWARE_AUTH_71bd",
    ];
    const outputs = ["out/route.mjs", "out/layout.mjs", "out/action.mjs", "out/middleware.mjs"];
    for (const outputRelPath of outputs) {
      const content = readFileSync(join(FIXTURE_DIR, outputRelPath), "utf-8");
      const matchingMarkers = allMarkers.filter((marker) => content.includes(marker));
      expect(matchingMarkers).toHaveLength(1);
    }
  });

  test("throws a 'failed to transpile <path>' error naming the offending file", async () => {
    const goodSource = touch("src/routes/good.tsx", `export const ok = "MARKER_GOOD_1";\n`);
    const badSource = touch(
      "src/routes/bad.tsx",
      // Invalid syntax -- guaranteed to fail to parse.
      "export const broken = ;;; not valid\n",
    );

    const refs: CompiledModuleRef[] = [
      {
        sourcePath: goodSource,
        compiledPath: join(FIXTURE_DIR, "out/good.mjs"),
        identifier: "__x_g",
      },
      {
        sourcePath: badSource,
        compiledPath: join(FIXTURE_DIR, "out/bad.mjs"),
        identifier: "__x_b",
      },
    ];

    await expect(transpileModules(refs)).rejects.toThrow(
      new RegExp(`failed to transpile ${badSource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
  });
});
