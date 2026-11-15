import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { NodeAdapterOptions } from "./types";

/** Copies the client build output (already produced by `@thexjs/core`'s
 *  `build()` into `<outDir>/client`) plus any additional static dirs into
 *  `<outputDir>/static/`, served by the generated server itself (there's no
 *  separate CDN/filesystem tier on a generic Node host). */
export function copyStaticAssets(
  outputDir: string,
  clientDir: string,
  additionalStaticDirs: string[] = [],
): void {
  const staticDir = join(outputDir, "static");
  mkdirSync(staticDir, { recursive: true });
  if (existsSync(clientDir)) {
    cpSync(clientDir, staticDir, { recursive: true });
  }
  for (const dir of additionalStaticDirs) {
    if (existsSync(dir)) cpSync(dir, staticDir, { recursive: true });
  }
}

export function resolveOutputDir(options: NodeAdapterOptions): string {
  const projectRoot = options.projectRoot ?? process.cwd();
  return options.outputDir ?? join(projectRoot, "dist-node");
}
