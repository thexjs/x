---
"@thexjs/cli": minor
---

Add `x build --adapter node`, wiring the new `@thexjs/adapter-node` package into the CLI the same way `--adapter vercel` is wired to `@thexjs/adapter-vercel` (optional peer dependency, dynamic import with a friendly error if it isn't installed).
