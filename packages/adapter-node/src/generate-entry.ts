import type { BuildManifest } from "@thexjs/core/adapter";
import { generateAdapterEntry } from "@thexjs/core/adapter";

/**
 * Emits the source for the Node adapter's standalone server entry:
 * `@thexjs/core`'s generic adapter entry (which builds the real `createApp()`
 * with a pre-resolved manifest) + a Node <-> Web Request/Response bridge +
 * a static-file layer (there's no separate CDN/filesystem tier like
 * Vercel's, so this one process must serve both) + an `http.createServer`
 * listen loop, since nothing else will invoke the handler on a generic host.
 */
export function generateEntrySource(
  manifest: BuildManifest,
  entryDir: string,
  options: { trustProxy: boolean; port: number },
): string {
  const bridge = `
// -- Trusted-proxy config --------------------------------------------------
// Unlike Vercel's adapter, a generic Node deployment can't assume any
// specific proxy sits in front of it, so this is explicit opt-in (see
// NodeAdapterOptions.trustProxy) rather than always-on.
import { buildSecurityHeaders, configureTrustedProxy } from "@thexjs/core";
const __x_trustProxy = ${JSON.stringify(options.trustProxy)};
if (__x_trustProxy) configureTrustedProxy({ trustForwardedHeaders: true });

// -- Static-asset security headers -----------------------------------------
// __x_app.fetch() (below) applies the app's configured security headers to
// every response it handles, including its own static-asset route -- but
// static GET/HEAD requests here are served directly, before __x_app.fetch()
// ever runs (see the request handler below), so they'd otherwise ship with
// none of that. Build the same headers once, from the same __x_security
// config the generated createApp() call above already received, so a static
// HTML/asset response gets the identical CSP/HSTS/X-Frame-Options/etc. a
// server-rendered response would. No per-request CSP nonce is available for
// a precomputed static file, matching how any other no-nonce response
// (405s, 500s, etc.) already behaves elsewhere in the framework.
const __x_staticHeaders =
  __x_security.headers === false ? null : buildSecurityHeaders(__x_security.headers || {});

import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

// The bundled entry lives at <outputDir>/server/index.mjs; static assets
// (prerendered HTML, island JS, public/) were copied to <outputDir>/static/
// by the adapter's write-output step -- a fixed, documented relative layout.
const __x_staticDir = fileURLToPath(new URL("../static", import.meta.url));

const __x_mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/** Resolves a request pathname to a file under __x_staticDir, the same way
 *  @thexjs/core's own public/ asset resolver does: decode once, reject any
 *  path that escapes the static root after normalization (no "..", no
 *  absolute-path overrides), and try an index.html fallback for directory-
 *  style routes (prerendered static pages ship as "<route>/index.html"). */
function stripSlashes(value) {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "/") start++;
  while (end > start && value[end - 1] === "/") end--;
  return value.slice(start, end);
}

function resolveStaticFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const trimmed = stripSlashes(decoded);
  const candidates = trimmed === "" ? ["index.html"] : [trimmed, trimmed + "/index.html"];

  for (const candidate of candidates) {
    const target = normalize(join(__x_staticDir, candidate));
    if (!target.startsWith(normalize(__x_staticDir) + sep) && target !== normalize(__x_staticDir)) {
      continue;
    }
    if (existsSync(target) && statSync(target).isFile()) return target;
  }
  return null;
}

function serveStaticFile(filePath, res) {
  const type = __x_mimeTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  res.statusCode = 200;
  res.setHeader("Content-Type", type);
  if (__x_staticHeaders) {
    for (const [key, value] of __x_staticHeaders) res.setHeader(key, value);
  }
  createReadStream(filePath).pipe(res);
}

// -- Node <-> Web Request/Response bridge ----------------------------------
function forwardedHeader(req, name) {
  const value = req.headers[name];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (value.length !== 1) return undefined;
    const single = String(value[0]).trim();
    return /^[a-zA-Z0-9._\\-:]+$/.test(single) ? single : undefined;
  }
  const single = String(value).trim();
  if (single.includes(",")) return undefined;
  return /^[a-zA-Z0-9._\\-:]+$/.test(single) ? single : undefined;
}

function nodeRequestToWebRequest(req) {
  const proto = __x_trustProxy ? forwardedHeader(req, "x-forwarded-proto") : undefined;
  const protocol = proto === "http" || proto === "https" ? proto : (req.socket && req.socket.encrypted ? "https" : "http");
  const forwardedHost = __x_trustProxy ? forwardedHeader(req, "x-forwarded-host") : undefined;
  const host = forwardedHost || req.headers.host || "localhost";
  const url = \`\${protocol}://\${host}\${req.url}\`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) { for (const v of value) headers.append(key, v); }
    else headers.append(key, value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? req : undefined,
    duplex: hasBody ? "half" : undefined,
  });
}

async function sendWebResponse(response, res) {
  res.statusCode = response.status;
  // See @thexjs/adapter-vercel's identical bridge for why Content-Length is
  // never copied verbatim for streamed bodies.
  const isPartial = response.status === 206;
  for (const [key, value] of response.headers) {
    const lower = key.toLowerCase();
    if (lower === "set-cookie") continue;
    if (lower === "content-length") continue;
    res.setHeader(key, value);
  }
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  if (cookies.length > 0) res.setHeader("Set-Cookie", cookies);
  if (!response.body) { res.end(); return; }

  const reader = response.body.getReader();
  let cancelled = false;
  const cancel = () => { cancelled = true; reader.cancel().catch(() => {}); };
  res.on("close", cancel);
  res.on("error", cancel);
  try {
    if (isPartial) {
      const chunks = [];
      let total = 0;
      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled) break;
        chunks.push(value);
        total += value.byteLength;
      }
      if (!cancelled) {
        res.setHeader("Content-Length", String(total));
        for (const chunk of chunks) res.write(chunk);
      }
    } else {
      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled) break;
        if (!res.write(value)) {
          await new Promise((resolve) => res.once("drain", resolve));
        }
      }
    }
  } finally {
    res.off("close", cancel);
    res.off("error", cancel);
  }
  if (!cancelled) res.end();
}

const __x_server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" || req.method === "HEAD") {
      const staticFile = resolveStaticFile(url.pathname);
      if (staticFile) {
        serveStaticFile(staticFile, res);
        return;
      }
    }
    const request = nodeRequestToWebRequest(req);
    const response = await __x_app.fetch(request);
    await sendWebResponse(response, res);
  } catch (err) {
    console.error("[x] fatal error handling request:", err);
    if (res.headersSent) { res.destroy(); return; }
    res.statusCode = 500;
    res.end("Internal server error");
  }
});

const __x_port = parseInt(process.env.PORT || "${String(options.port)}", 10);
__x_server.listen(__x_port, () => {
  console.log(\`[x] listening on http://localhost:\${__x_port}\`);
});

export { __x_server };
`;
  return `${generateAdapterEntry(manifest, entryDir)}\n${bridge}`;
}
