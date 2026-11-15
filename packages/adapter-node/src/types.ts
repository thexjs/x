import type { AdapterOptions } from "@thexjs/core/adapter";

export type {
  AdapterOptions,
  BuildManifest,
  CompiledModuleRef,
  ResolvedAction,
  ResolvedRoute,
} from "@thexjs/core/adapter";

export interface NodeAdapterOptions extends AdapterOptions {
  /** Where to emit the standalone output tree. Defaults to `<projectRoot>/dist-node`. */
  outputDir?: string;
  /** Port the generated server listens on if `PORT` isn't set in the environment. Defaults to 3000. */
  port?: number;
  /**
   * Trust `X-Forwarded-*` headers for client IP / protocol / host resolution
   * (brute-force guards, audit trails, CSRF origin checks). Only enable this
   * when the generated server sits behind a proxy/load balancer you control
   * that strips or overwrites these headers on the way in -- unlike Vercel's
   * adapter, a generic Node deployment can't assume any specific proxy, so
   * this defaults to `false` (trust only the raw socket).
   */
  trustProxy?: boolean;
  /** Extra directories to copy verbatim into static/ (in addition to public/). */
  additionalStaticDirs?: string[];
}
