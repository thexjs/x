import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  assertNoEnvLeakage,
  assertNoEnvValueLeakage,
  EnvLeakageError,
} from "./security/env-isolation";
import { generateServerFunctionClient } from "./server-functions";

export interface ActionModuleInfo {
  parentPath: string;
  fnNames: string[];
}

/**
 * A Bun.build() plugin that intercepts any import resolving to a file inside
 * `actionsDir` that was registered as a server-function module, and swaps
 * its source for a generated fetch()-based client (see
 * `generateServerFunctionClient`). This lets client/island code do:
 *
 *   import { subscribeUser } from "../actions/subscribe";
 *   await subscribeUser("dev@example.com");
 *
 * and have it silently become a POST to /__x/actions/... in the compiled
 * bundle — the real function body (db calls, secrets, etc.) is never read
 * by the client-target bundler, so it can't end up in the shipped JS.
 * Files under actionsDir that aren't registered action routes (e.g. shared
 * helpers) are left untouched and load normally.
 */
export function actionsRewritePlugin(
  actionModules: Map<string, ActionModuleInfo>,
): import("bun").BunPlugin {
  return {
    name: "x-actions-rewrite",
    setup(build) {
      if (actionModules.size === 0) return;
      build.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
        const info = actionModules.get(args.path);
        if (!info) return undefined;

        const endpointBase =
          info.parentPath === "/" ? "/__x/actions" : `/__x/actions${info.parentPath}`;
        const contents = generateServerFunctionClient(args.path, info.fnNames, endpointBase);
        return { contents, loader: "ts" };
      });
    },
  };
}

/**
 * Builds the client hydration entry for a route.
 *
 * `islandNames`/`islandPaths` are optional and, when omitted, preserve the
 * original behavior exactly: always `import * as Route from routeAbsPath`
 * (and each layout) and resolve `Route.islands?.[name]` at runtime.
 *
 * When `islandPaths` has an entry for one of `islandNames` (a route or
 * layout's `islands` map had a *string* value for that name -- a module
 * specifier, not a live component reference), that island is resolved via a
 * direct static import of that path instead. If every requested name is
 * path-backed this way, the route file (and its layouts) are never imported
 * into the browser bundle at all -- which is the point: a route combining a
 * server-only `loader` with `islands` in the same file used to leak that
 * loader's imports (e.g. a database/auth client touching `node:crypto`) into
 * the client bundle, because reading `Route.islands?.[name]` required
 * evaluating the whole module, loader included. See `resolveIslandPaths`,
 * which is what actually discovers these string-valued entries server-side
 * before this function is called.
 */
export function generateHydrateEntry(
  routeAbsPath: string,
  layoutAbsPaths: string[] = [],
  islandNames?: string[],
  islandPaths: Record<string, string> = {},
): string {
  // No island-name list provided: caller is using the original contract
  // (always import the route module). Keeps every pre-existing call site
  // and test byte-for-byte compatible.
  const pathBackedNames =
    islandNames === undefined ? [] : islandNames.filter((n) => islandPaths[n] !== undefined);
  const moduleBackedNames =
    islandNames === undefined
      ? undefined // signals "unconditionally import Route", not "import nothing"
      : islandNames.filter((n) => islandPaths[n] === undefined);
  const needsRouteModule = moduleBackedNames === undefined || moduleBackedNames.length > 0;

  const routeImport = needsRouteModule ? `import * as Route from "${routeAbsPath}";\n` : "";
  const layoutImports = needsRouteModule
    ? layoutAbsPaths.map((p, i) => `import * as Layout${i} from "${p}";`).join("\n")
    : "";
  const pathImports = pathBackedNames
    .map((name, i) => `import __x_island_${i} from "${islandPaths[name]}";`)
    .join("\n");
  const pathEntries = pathBackedNames
    .map((name, i) => `  ${JSON.stringify(name)}: __x_island_${i},`)
    .join("\n");

  const moduleLookupParts: string[] = [];
  if (needsRouteModule) {
    moduleLookupParts.push("Route.islands?.[name]");
    for (let i = 0; i < layoutAbsPaths.length; i++) {
      moduleLookupParts.push(`Layout${i}.islands?.[name]`);
    }
  }
  const moduleLookup = moduleLookupParts.length > 0 ? moduleLookupParts.join(" ?? ") : "undefined";

  return `import React from "react";
import { hydrateRoot } from "react-dom/client";
${routeImport}${layoutImports}
${pathImports}

var __x_pathIslands = {
${pathEntries}
};

function resolveIsland(name: string) {
  if (Object.prototype.hasOwnProperty.call(__x_pathIslands, name)) {
    return __x_pathIslands[name];
  }
  return ${moduleLookup};
}

// Islands whose render is non-deterministic (e.g. \`useState(() => ...)\` with
// Math.random) can't be hydrated against their SSR output. React recovers by
// re-rendering client-side, so the island is still fully interactive. The
// mismatch is NOT silently swallowed: it is reported to the server so real
// rendering bugs are observable in production instead of hidden.
function reportHydrationMismatch(error, name) {
  try {
    console.error("[x] hydration mismatch on island '" + name + "':", error);
  } catch (_) {}
  try {
    var message = error instanceof Error ? error.message : String(error);
    navigator.sendBeacon(
      "/__x/hydration-mismatch",
      new Blob([JSON.stringify({ error: message, island: name, url: location.href })], {
        type: "application/json",
      }),
    );
  } catch (_) {
    // sendBeacon is best-effort; a failing beacon must not break hydration.
  }
}

// Preserve roots from a prior hydration entry on the same page (e.g. partial
// re-hydration). Only initialize when the array doesn't exist yet.
if (!window.__xIslandRoots) window.__xIslandRoots = [];

document.querySelectorAll("[data-island]").forEach((el) => {
  const name = el.getAttribute("data-island");
  if (!name) return;
  const Component = resolveIsland(name);
  if (!Component) return;
  const root = hydrateRoot(el, React.createElement(Component), {
    onRecoverableError(error) {
      reportHydrationMismatch(error, name);
    },
  });
  window.__xIslandRoots.push(root);
});
`;
}

export function generateFallbackHydration(islandNames: string[]): string {
  return `// x island hydration fallback — ${islandNames.join(", ")}
document.querySelectorAll("[data-island]").forEach(function(el) {
  el.setAttribute("data-island-hydrated", "false");
});
`;
}

export function hashId(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

export function islandEntryId(routeFilePath: string): string {
  return `${basename(routeFilePath).replace(/\.(tsx|ts)$/, "")}-${hashId(routeFilePath)}`;
}

/**
 * Wraps a self-contained island bundle in an IIFE so its top-level function
 * declarations don't leak onto `window` when the bundle runs as a classic
 * script. Without this, a minified React-DOM bundle's top-level
 * `function dispatchEvent` silently replaces `window.dispatchEvent`, which
 * breaks app code that dispatches synthetic events on `window` (e.g. a
 * command palette trigger that re-dispatches the ⌘K keydown).
 */
export function wrapIslandBundle(code: string): string {
  return `;(function () {\n${code}\n})();\n`;
}

/**
 * Discovers, for the given route (and its layout chain), which of
 * `islandNames` were declared with a *string* value in that module's
 * `islands` map rather than a live component reference -- e.g.
 * `export const islands = { Foo: "../../components/foo" }`. A string value
 * is a module specifier, resolved here relative to the directory of the
 * file that declared it, into an absolute path the client entry can import
 * directly.
 *
 * This runs the route/layout modules server-side (not through Bun.build's
 * browser-target pipeline), so a server-only `loader` co-located in the same
 * file evaluates completely normally here -- `node:crypto`, database
 * clients, whatever. Nothing from that evaluation reaches the browser: only
 * the resolved path *strings* are returned, and `generateHydrateEntry` uses
 * them to import the island's own file directly, bypassing the route module
 * (and its loader's imports) in the actual client bundle entirely.
 *
 * Best-effort: a route/layout file that fails to import here (a real syntax
 * error, a missing required env var, etc.) is skipped rather than thrown --
 * the caller falls back to the original `Route.islands?.[name]` resolution,
 * which will surface the same failure through the normal Bun.build error
 * path instead.
 */
export async function resolveIslandPaths(
  routeFilePath: string,
  layoutFilePaths: string[],
  islandNames: string[],
): Promise<Record<string, string>> {
  if (islandNames.length === 0) return {};
  const paths: Record<string, string> = {};
  const owners = [routeFilePath, ...layoutFilePaths];
  for (const ownerPath of owners) {
    let mod: Record<string, unknown>;
    try {
      mod = (await import(ownerPath)) as Record<string, unknown>;
    } catch {
      continue;
    }
    const islands = mod.islands as Record<string, unknown> | undefined;
    if (!islands) continue;
    for (const name of islandNames) {
      if (name in paths) continue; // route's own islands win over a layout's
      const value = islands[name];
      if (typeof value === "string") {
        paths[name] = resolve(dirname(ownerPath), value);
      }
    }
  }
  return paths;
}

/**
 * Bundles a route's island hydration entry into browser JS entirely in
 * memory. Bun.build() requires a real entrypoint file, so a scratch entry
 * file is written to a temp directory and removed immediately after —
 * nothing lands in the project tree. Used by the dev server and by the
 * production SSR path (createApp), where there's no `.x/client` output
 * directory to write into.
 */
export async function buildIslandBundleInMemory(
  routeFilePath: string,
  layoutFilePaths: string[],
  islandNames: string[],
  actionModules: Map<string, ActionModuleInfo>,
  projectRoot: string,
): Promise<string> {
  const entryId = islandEntryId(routeFilePath);
  const scratchRoot = join(projectRoot, ".x", "islands-tmp");
  mkdirSync(scratchRoot, { recursive: true });
  const scratchDir = mkdtempSync(join(scratchRoot, "x-islands-"));

  try {
    const islandPaths = await resolveIslandPaths(routeFilePath, layoutFilePaths, islandNames);
    const entryPath = join(scratchDir, `${entryId}.tsx`);
    writeFileSync(
      entryPath,
      generateHydrateEntry(routeFilePath, layoutFilePaths, islandNames, islandPaths),
      "utf-8",
    );

    const result = await Bun.build({
      entrypoints: [entryPath],
      target: "browser",
      env: "disable",
      plugins: [actionsRewritePlugin(actionModules)],
    });

    if (!result.success) {
      for (const log of result.logs) {
        console.warn(`  [islands] build error: ${log.message}`);
      }
      return wrapIslandBundle(generateFallbackHydration(islandNames));
    }

    const outputs = result.outputs.filter((o) => o.kind === "entry-point");
    const built = outputs[0] ?? result.outputs[0];
    if (!built) return wrapIslandBundle(generateFallbackHydration(islandNames));

    const code = await built.text();
    assertNoEnvLeakage(code, entryPath);
    assertNoEnvValueLeakage(code, entryPath, process.env);
    return wrapIslandBundle(code);
  } catch (err) {
    // A leaked server-only env var isn't a routine build hiccup. Dev keeps
    // serving the fallback stub (fast iteration wins), but the warning must
    // be visually distinct so it can't be mistaken for a hot-reload error.
    if (err instanceof EnvLeakageError) {
      console.error(
        `\x1b[1;31m🔒  SECURITY: [islands] ${err.message}\x1b[0m\n    Falling back to a non-interactive hydration stub — fix the env isolation (prefix with THEXJS_PUBLIC_ or move the access server-side) before relying on this page's client behavior.`,
      );
      return wrapIslandBundle(generateFallbackHydration(islandNames));
    }
    console.warn(`  [islands] build failed for ${routeFilePath}:`, err);
    return wrapIslandBundle(generateFallbackHydration(islandNames));
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

/**
 * Bundles a route's island hydration entry to a real file on disk under
 * `islandsDir/<entryId>/<entryId>.js` and returns the public script URL.
 * Used by the adapter build so server-mode routes ship their island bundles
 * as static assets (which adapter-vercel copies into static/) instead of
 * relying on the in-memory builder that needs the source tree at request
 * time.
 */
export async function bundleRouteIslandsToDisk(
  routeFilePath: string,
  layoutFilePaths: string[],
  islandNames: string[],
  islandsDir: string,
  actionModules: Map<string, ActionModuleInfo>,
): Promise<string[]> {
  const entryId = islandEntryId(routeFilePath);
  const outdir = join(islandsDir, entryId);
  mkdirSync(outdir, { recursive: true });
  const bundlePath = join(outdir, `${entryId}.js`);

  const islandPaths = await resolveIslandPaths(routeFilePath, layoutFilePaths, islandNames);
  const hydrateEntry = generateHydrateEntry(
    routeFilePath,
    layoutFilePaths,
    islandNames,
    islandPaths,
  );
  const entryPath = join(outdir, `${entryId}.tsx`);
  writeFileSync(entryPath, hydrateEntry, "utf-8");

  try {
    const result = await Bun.build({
      entrypoints: [entryPath],
      target: "browser",
      env: "disable",
      plugins: [actionsRewritePlugin(actionModules)],
    });

    if (result.success) {
      const outputs = result.outputs.filter((o) => o.kind === "entry-point");
      const built = outputs[0] ?? result.outputs[0];
      if (built) {
        const code = await built.text();
        assertNoEnvLeakage(code, bundlePath);
        assertNoEnvValueLeakage(code, bundlePath, process.env);
        writeFileSync(bundlePath, wrapIslandBundle(code), "utf-8");
        return [`/_islands/${entryId}/${entryId}.js`];
      }
    }
    for (const log of result.logs) {
      console.warn(`  [islands] build error: ${log.message}`);
    }
  } catch (err) {
    if (err instanceof EnvLeakageError) throw err;
    console.warn(`  [islands] build failed for ${routeFilePath}:`, err);
  }

  writeFileSync(bundlePath, wrapIslandBundle(generateFallbackHydration(islandNames)), "utf-8");
  return [`/_islands/${entryId}/${entryId}.js`];
}
