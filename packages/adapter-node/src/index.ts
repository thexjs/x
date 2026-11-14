import { rmSync } from "node:fs";
import { join } from "node:path";
import { build as coreBuild } from "@thexjs/core";
import { bundleRenderFunction } from "./bundle-function";
import { resolveBuildManifest } from "./scan";
import type { NodeAdapterOptions } from "./types";
import { copyStaticAssets, resolveOutputDir } from "./write-output";

export type { NodeAdapterOptions } from "./types";

/**
 * Builds a `@thexjs` app into a standalone tree that runs on plain Node.js --
 * no Bun runtime required to serve traffic (Railway, Render, Fly, a bare
 * VPS, any host that only gives you Node).
 *
 * ```
 * dist-node/
 *   static/                       HTML/CSS/JS -- served by the server itself
 *   server/
 *     index.mjs                   standalone SSR + API + static-file server
 * ```
 *
 * Pipeline (identical first three steps to `@thexjs/adapter-vercel` -- both
 * compose the same `@thexjs/core/adapter` SDK):
 *  1. Run `@thexjs/core`'s normal `build()` to prerender every static-mode
 *     page/content entry to HTML and to compile island bundles.
 *  2. Resolve every server-mode page, API route, layout, middleware file and
 *     server-action file at build time (see scan.ts) -- no runtime fs
 *     scanning, no dynamic `import(path)`.
 *  3. Transpile each of those from Bun-flavored TSX/TS into plain Node ESM,
 *     then bundle them together with `@thexjs/core` and React into one
 *     standalone `server/index.mjs` (see generate-entry.ts / bundle-function.ts).
 *  4. Copy static assets and write the output tree.
 *
 * Unlike the Vercel adapter, the server is bundled even for 100%-static apps:
 * there's no separate CDN/filesystem tier on a generic Node host, so the one
 * process the operator runs always needs to be able to serve `static/`
 * itself.
 */
export async function buildNodeOutput(options: NodeAdapterOptions = {}): Promise<void> {
  const outputDir = resolveOutputDir(options);
  const trustProxy = options.trustProxy ?? false;
  const port = options.port ?? 3000;

  const coreOutDir = join(outputDir, ".scratch-core");
  try {
    console.log("[adapter-node] running @thexjs/core build (static pages + islands)...");
    const rest: Record<string, string> = {};
    if (options.pagesDir) rest.pagesDir = options.pagesDir;
    if (options.routesDir) rest.routesDir = options.routesDir;
    if (options.apiDir) rest.apiDir = options.apiDir;
    if (options.layoutsDir) rest.layoutsDir = options.layoutsDir;
    if (options.actionsDir) rest.actionsDir = options.actionsDir;
    if (options.contentDir) rest.contentDir = options.contentDir;
    await coreBuild({ ...rest, outDir: coreOutDir });

    console.log("[adapter-node] resolving server-mode routes...");
    const manifestScratchDir = join(outputDir, ".scratch-routes");
    const manifest = await resolveBuildManifest(
      { ...options, islandsDir: join(coreOutDir, "client") },
      manifestScratchDir,
    );

    console.log(
      `[adapter-node] ${manifest.routes.length} server route(s), ${manifest.actions.length} action file(s)`,
    );

    copyStaticAssets(outputDir, join(coreOutDir, "client"), options.additionalStaticDirs);

    const serverDir = join(outputDir, "server");
    console.log("[adapter-node] bundling standalone server...");
    await bundleRenderFunction(manifest, serverDir, { trustProxy, port });
    console.log(`[adapter-node] wrote ${serverDir}`);

    console.log(`[adapter-node] build complete -> ${outputDir}`);
    console.log(`[adapter-node] run with: node ${join(outputDir, "server", "index.mjs")}`);
  } finally {
    rmSync(coreOutDir, { recursive: true, force: true });
    rmSync(join(outputDir, ".scratch-routes"), { recursive: true, force: true });
  }
}
