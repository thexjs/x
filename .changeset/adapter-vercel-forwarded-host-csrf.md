---
"@thexjs/adapter-vercel": patch
---

Gate `x-forwarded-proto`/`x-forwarded-host` consumption in the generated entry's Node-to-Web `Request` bridge behind `isTrustedProxy()`. Format validation alone isn't a trust decision — the forwarded host feeds the `url` that CSRF's `requestOrigin()` later reads as the request's "self" origin, so without the gate, a spoofed `x-forwarded-host` (paired with a matching `Origin` header) would self-authenticate as same-origin for CSRF if this bridge ever ran somewhere that doesn't strip client-supplied forwarded headers.
