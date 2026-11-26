---
"@thexjs/cli": patch
---

Wrap the CLI's top-level `main()` in an error boundary (`main().catch(...)`) so any uncaught rejection — a throwing `x.config.ts`, an `EACCES` port bind, a resolve failure — reports through the same styled `xError` output as the rest of the CLI, instead of a raw native stack trace. Also pre-flight `Bun.resolveSync("@thexjs/core", ...)` in `cmdDev`/`cmdBuild` so a project missing `node_modules` gets a friendly "run `bun install`" hint instead of a raw `ResolveError`.
