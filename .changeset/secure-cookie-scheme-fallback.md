---
"@thexjs/core": patch
"@thexjs/auth": patch
---

Fix the `Secure` cookie flag silently dropping on any deployment where `NODE_ENV` isn't the exact literal string `"production"` — a platform that names its env var something else, or a staging deployment genuinely served over HTTPS, no longer loses `Secure` on the CSRF double-submit cookie, the session cookie, or the OAuth state/PKCE cookies. Added `isSecureRequest(req)` to `@thexjs/core`, checking the request's own URL scheme (and `X-Forwarded-Proto`, only when `configureTrustedProxy({ trustForwardedHeaders: true })` is set — the same trust boundary `clientIpFromRequest` already uses) as an independent signal alongside the existing `NODE_ENV`/`forceSecureCookie` checks, not a replacement for them.
