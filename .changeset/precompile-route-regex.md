---
"@thexjs/core": patch
---

Precompile each route's matching `RegExp` once (at scan/registration time) instead of rebuilding it from the route pattern on every candidate checked for every request. Routing previously called `routePatternToRegex` — a fresh `new RegExp(...)` — for every route in the (precedence-sorted) handler list up to and including the one that matched, on every single request; for an app with many routes this meant repeated, immediately-garbage-collected regex compilations per request, adding GC pressure and P99 latency that scaled with routes × requests.

`RouteEntry` now carries a `matcher: RegExp` compiled once by `scanRoutes`/`scanApiDir`, and `extractParams` takes that precompiled matcher instead of a route-path string, doing a pure match with no construction. `server-functions.ts`'s action dispatch compiles its matcher once in `registerServerFunctions` and reuses it from the (per-request) registry snapshot instead of re-deriving a regex per action lookup. Adapter-generated entries (`@thexjs/adapter-node`, `@thexjs/adapter-vercel`) splice the compiled matcher in as a `new RegExp(...)` literal alongside the route's JSON-serializable fields, so the same precompilation survives into prebuilt serverless/edge bundles.

No behavior change for matching semantics — only how often the `RegExp` backing it gets built.
