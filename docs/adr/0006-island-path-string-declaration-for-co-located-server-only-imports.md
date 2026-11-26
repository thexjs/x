---

## status: accepted

# Islands co-located with server-only code must be declared as a path string, not a live component reference

`export const islands = { Foo: "../../components/foo" }` — a path string — tells the client-side hydration bundler to import that file directly. `export const islands = { Foo }` — a live reference to an imported component — makes the bundler re-import the _whole route module_, loader and all, for the browser target too.

The obvious-looking live-reference form breaks the moment a route combines a server-only `loader` or module-level side effect (a database client, `defineAuth()`) with a co-located island: the client bundle ends up evaluating that server-only code for the browser, which fails the build or silently falls back to a non-interactive stub. We didn't make the path-string form mandatory everywhere, because for a route with no server-only imports either form works identically — the path-string requirement only bites exactly where the live-reference form would otherwise leak server code, so we left both forms available rather than forcing the more verbose one on every island unconditionally.
