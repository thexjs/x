import { isTrustedProxy } from "./trusted-proxy";

/**
 * True when a request should be treated as HTTPS for deciding whether a
 * cookie needs the `Secure` flag. Checks, in order:
 *
 * 1. The request URL's own protocol. Every adapter bridge (adapter-node,
 *    adapter-vercel) and `Bun.serve` itself already resolve this correctly
 *    for direct TLS termination — `req.url` reads `https:` whenever the
 *    process itself holds the TLS connection, with no trust decision
 *    involved.
 * 2. `X-Forwarded-Proto`, but only when the application has opted in to
 *    trusting forwarded headers (`configureTrustedProxy({
 *    trustForwardedHeaders: true })`) — the same trust boundary
 *    `clientIpFromRequest` (`security/ip.ts`) already gates on. Without
 *    this gate a client could set the header to downgrade the check at
 *    will; with it, a reverse-proxy deployment that terminates TLS in
 *    front of a plain-HTTP Bun process is correctly recognized as secure.
 *
 * This is meant to be used *alongside* an explicit `NODE_ENV === "production"`
 * / `forceSecureCookie` check, not as a replacement for one — a request can
 * be genuinely HTTPS in a non-"production" environment (a staging
 * deployment, a platform that names its env var something else), and this
 * closes exactly that gap.
 */
export function isSecureRequest(req: Request): boolean {
  if (new URL(req.url).protocol === "https:") return true;
  if (!isTrustedProxy()) return false;
  return req.headers.get("x-forwarded-proto") === "https";
}
