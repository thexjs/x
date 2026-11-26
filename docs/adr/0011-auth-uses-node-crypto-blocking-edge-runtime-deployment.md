---

## status: open-constraint

# @thexjs/auth depends on node:crypto and TCP-backed session stores, which blocks Edge Function deployment

`getSession()` — called on every `requireAuth`/`requireRole`/`requirePermission` — uses `node:crypto` for HMAC/timing-safe comparison and, by default, a TCP-backed session store (`bun:sqlite`/`@thexjs/core/data`). Neither import exists in an Edge runtime's JS engine.

This isn't a decision we're recording after the fact so much as a known constraint worth writing down before someone wires `requireAuth` into an Edge Function/Middleware (the natural place to want it) and hits an import failure with no explanation. `@thexjs/adapter-vercel` only emits `nodejs*.x` functions today, so nothing breaks in current production use — but per ADR-0001, Bun-native and Edge-runtime-compatible are two different compatibility questions, and this is where that gap is concrete rather than theoretical.

Tracked as issue [#171](https://github.com/thexjs/x/issues/171): the planned fix is Web Crypto (`crypto.subtle`) for the HMAC/compare primitives plus a pluggable `SessionStore` interface with a documented web/HTTP-KV-backed option, so auth can run at the edge without dropping the Node-targeted defaults for everyone else. Update this ADR's status once that lands.
