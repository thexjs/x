---

## status: accepted

# A forwarded host only becomes CSRF's "self" origin when the app has opted into trusting it

`requestOrigin()` (CSRF's definition of "self") reads whatever host the incoming `Request`'s own `url` carries. Each adapter's Node-to-Web bridge decides what that `url` is built from — and per ADR-0003, `x-forwarded-host` is only consulted there when `isTrustedProxy()` says to trust it.

This is a sharper, security-critical instance of ADR-0003's general rule, worth recording on its own: format-validating a forwarded header (rejecting malformed or comma-joined values) is not the same as trust-authenticating it, and the two are easy to conflate because a validated header _looks_ safe to use. Format validation alone would still let an attacker send a well-formed `x-forwarded-host: evil.com` paired with a matching `Origin: https://evil.com` — if that host became "self," the CSRF check would wrongly see the request as same-origin. Gating consumption behind the same trust flag ADR-0003 already established closes that specific path without inventing a second trust mechanism.
