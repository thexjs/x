---

## status: accepted

# Forwarded headers (X-Forwarded-For/-Proto, X-Real-IP) are untrusted unless explicitly opted into

`configureTrustedProxy({ trustForwardedHeaders: true })` is the only way IP-based rate limiting, brute-force guards, audit trails, and (per ADR-0006) a request's CSRF "self" origin ever read these headers as fact. Left unset, they're ignored entirely — a client can set `X-Forwarded-For` to anything, so trusting it blindly lets an attacker spoof their IP and defeat IP-based protections, or (worse) self-authenticate a forged `X-Forwarded-Host` as same-origin.

This was a deliberate deviation from the obvious path (most frameworks read these headers unconditionally). The real cost: a non-Vercel deployment behind any reverse proxy (NGINX, Cloudflare, an ALB) silently loses IP-based protection unless the deploy explicitly opts in — easy to miss, and worth the easy-to-miss cost rather than the alternative.

## Consequences

`@thexjs/adapter-vercel` opts in unconditionally at module load (Vercel's edge always sets these headers correctly, so there's no client to spoof them before they arrive). Every other adapter and direct `x start` deployment defaults to untrusted and must opt in deliberately once the deployment topology is known.
