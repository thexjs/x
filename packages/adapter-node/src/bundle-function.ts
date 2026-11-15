import type { BuildManifest } from "@thexjs/core/adapter";
import {
  adapterScratchDir,
  allModuleRefs,
  bundleRenderFunction as bundleToStandaloneFile,
  transpileModules,
} from "@thexjs/core/adapter";
import { generateEntrySource } from "./generate-entry";

/**
 * Produces `<outputDir>/server/index.mjs`: a single standalone ESM file with
 * the whole SSR/API dependency graph inlined (`@thexjs/core`, `react`,
 * `react-dom`, every route/layout/middleware/action module) so it runs on
 * plain Node.js with zero `node_modules` and zero dynamic filesystem access
 * at request time -- plus an `http.createServer` listen loop and a
 * static-file layer, since there's no separate CDN/platform runtime to
 * invoke the handler or split static traffic away for us.
 */
export async function bundleRenderFunction(
  manifest: BuildManifest,
  serverDir: string,
  options: { trustProxy: boolean; port: number },
): Promise<void> {
  const scratchDir = adapterScratchDir(serverDir);

  const refs = allModuleRefs(manifest);
  await transpileModules(refs);

  const entrySource = generateEntrySource(manifest, scratchDir, options);
  await bundleToStandaloneFile(serverDir, entrySource);
}
