import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSecurityHeaders } from "@thexjs/core";
import type { BuildManifest, VercelAdapterOptions } from "./types";

export interface VercelConfigRoute {
  handle?: "filesystem";
  src?: string;
  dest?: string;
}

/**
 * The `render.func` function response already gets the app's security
 * headers from `withResponseHardening` inside the real `createApp()` it
 * runs. Static assets never reach that function -- Vercel's filesystem
 * routing (the `{ handle: "filesystem" }` route above) serves them straight
 * from the CDN -- so without this, every prerendered HTML page and asset
 * would ship with none of the app's CSP/HSTS/X-Frame-Options/etc. Emitting
 * them as a native Build Output API `headers` rule applies them at the edge
 * for the static tier, the same way the render function applies them at
 * request time. No per-request CSP nonce exists for a precomputed static
 * file, matching how any other no-nonce response already behaves elsewhere
 * in the framework.
 */
function staticHeadersConfig(
  security: BuildManifest["security"],
): { source: string; headers: { key: string; value: string }[] }[] {
  const headersOption = (security as { headers?: unknown } | undefined)?.headers;
  if (headersOption === false) return [];
  const built = buildSecurityHeaders(
    (headersOption ?? {}) as Parameters<typeof buildSecurityHeaders>[0],
  );
  const headers: { key: string; value: string }[] = [];
  // Headers.entries() exists at runtime in Bun/Node but isn't in the DOM lib
  // types tsup builds against -- cast the same way security/headers.ts does.
  for (const [key, value] of built as unknown as IterableIterator<[string, string]>) {
    headers.push({ key, value });
  }
  if (headers.length === 0) return [];
  return [{ source: "/(.*)", headers }];
}

/** `.vercel/output/config.json` -- static assets first, then (only if the
 *  app has any server-mode pages / API routes / actions) fall back every
 *  remaining request to the render function. Apps that are 100% static
 *  (SSG only) get NO function at all -- filesystem routing is enough.
 *
 *  When the app allow-lists remote hosts for /_x/image, the native Vercel
 *  `images` config is emitted too, which turns on the platform's Image
 *  Optimization API at /_vercel/image for those same domains. */
export function writeConfigJson(outputDir: string, manifest: BuildManifest): void {
  mkdirSync(outputDir, { recursive: true });
  const routes: VercelConfigRoute[] = [{ handle: "filesystem" }];
  if (manifest.hasServerSurface) {
    routes.push({ src: "/(.*)", dest: "/render" });
  }
  const config: Record<string, unknown> = { version: 3, routes };
  const headers = staticHeadersConfig(manifest.security);
  if (headers.length > 0) config.headers = headers;
  const remoteHosts = manifest.images?.remoteHosts;
  if (remoteHosts && remoteHosts.length > 0) {
    config.images = {
      sizes: [640, 750, 828, 1080, 1200],
      domains: remoteHosts,
      minimumCacheTTL: 60,
    };
  }
  writeFileSync(join(outputDir, "config.json"), JSON.stringify(config, null, 2), "utf-8");
}

/** `.vercel/output/functions/render.func/.vc-config.json` */
export function writeFunctionConfig(functionDir: string, runtime: string): void {
  writeFileSync(
    join(functionDir, ".vc-config.json"),
    JSON.stringify(
      {
        runtime,
        handler: "index.mjs",
        launcherType: "Nodejs",
        shouldAddHelpers: true,
      },
      null,
      2,
    ),
    "utf-8",
  );
}

/** Copies the client build output (already produced by `@thexjs/core`'s
 *  `build()` into `<outDir>/client`) plus any additional static dirs into
 *  `.vercel/output/static/`. */
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

export function resolveOutputDir(options: VercelAdapterOptions): string {
  const projectRoot = options.projectRoot ?? process.cwd();
  return options.outputDir ?? join(projectRoot, ".vercel", "output");
}
