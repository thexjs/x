---
"@thexjs/core": patch
---

Batch `transpileModules`'s route/layout/middleware/action compilation into a single `Bun.build` call instead of one invocation per file. For an app with hundreds of routes this previously meant hundreds of sequential bundler invocations, each paying its own build-setup overhead. Each build output is mapped back to its destination file via the build's metafile (which records the absolute source path each output came from), not by array position, since `Bun.build`'s output order isn't guaranteed to match the entrypoints order. On a build failure, the specific offending source file is still named in the error (`failed to transpile <path>`), attributed via the failing log's file position, falling back to a per-file rebuild only to pinpoint the culprit when that information isn't available.
