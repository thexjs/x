---
"@thexjs/core": minor
---

Allow `islands` map entries to be a module specifier string, not just a live component reference: `export const islands = { Foo: "../../components/foo" }`. When used, the client hydration entry imports that file directly instead of re-importing the whole route module.

This closes a real leak: a route combining a server-only `loader` (reading a database, auth, etc.) with a *co-located* island used to pull the loader's imports (e.g. `node:crypto`) into the client bundle, because resolving `Route.islands?.[name]` at hydration time required evaluating the entire route module, loader included. Declaring the island's value as a path string sidesteps that — the route file is never imported into the browser bundle for that island. Existing live-component-reference islands are unaffected and keep working exactly as before.
