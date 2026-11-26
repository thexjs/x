# x

`x` is a full-stack React framework built natively on Bun: file-based routing, SSR/SSG/ISR, API routes, server functions, and islands-based hydration, with security defaults (CSP, CSRF, rate limiting, env isolation) baked into the framework rather than bolted on by each app.

## Language

**Island**:
An explicitly opt-in client-hydration boundary (`<Island name="..." client="...">`). Everything outside an island ships as static HTML with zero client JS; nothing hydrates unless wrapped in one.
_Avoid_: Component, widget, client component

**Server Function**:
An async function in `actionsDir` (default `src/actions`), called from the client via `POST /__x/actions/<routePath>/<fnName>` with CSRF origin verification enforced.
_Avoid_: Action, mutation, RPC (reserve "action" for server-function source files specifically; "mutation" implies a GraphQL-style contract this project doesn't have)

**API Route**:
A file under `apiDir` (default `pages/api/`) that exports HTTP-method handlers (`GET`, `POST`, ...) and returns a `Response` directly. Distinct from a Server Function: an API route is addressed by its own file path and speaks raw `Request`/`Response`; a Server Function is addressed by name and called through the actions dispatcher.
_Avoid_: Endpoint, handler (in isolation — "handler" is fine when qualified, e.g. "the GET handler")

**Page Route**:
A file under `pagesDir` (default `src/pages`) that default-exports a React component, optionally with `loader`, `mode`, `revalidate`, or `middleware` exports. Routed and matched the same way as an API route, but renders HTML rather than returning a raw `Response`.
_Avoid_: View, screen

**Route Entry**:
The compiled, in-memory record for one page or API route, built once when the route tree is scanned. Distinct from the route's source file.
_Avoid_: Route, route object (too generic — "Route Entry" specifically means the compiled record, not the source file)

**Adapter**:
A build target that turns `x build`'s generic manifest into a deployable artifact for one hosting platform. Each adapter makes its own decision about whether to trust that platform's forwarded headers.
_Avoid_: Target, platform (reserve "platform" for the actual hosting platform, e.g. "Vercel's platform")

**Trusted Proxy**:
The explicit, adapter- or app-level opt-in (`configureTrustedProxy({ trustForwardedHeaders: true })`) that allows `X-Forwarded-For`/`X-Forwarded-Proto`/`X-Forwarded-Host` to be read as fact rather than ignored. Off by default everywhere except `@thexjs/adapter-vercel`, which opts in because Vercel's edge always sets these correctly.
_Avoid_: Reverse proxy support, proxy trust (both too vague — the point is specifically that trust is an opt-in flag, not an assumption)

**ISR** (Incremental Static Regeneration):
A page rendered once, cached, and re-rendered in the background after `revalidate` seconds/hours elapse — serves stale-while-revalidating, not stale-then-block.
_Avoid_: Cache (too generic — "ISR" names the specific page-level revalidation mechanism, distinct from the rate-limit/brute-force stores which are also caches)

**Content Collection**:
Markdown/MDX files under `contentDir`, scanned at build/dev time via `scanContent()`, each becoming its own route.
_Avoid_: CMS, content model
