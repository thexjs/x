---
"@thexjs/cli": minor
---

Add a `Reporter` abstraction (`packages/cli/src/reporter.ts`) that every CLI command path now routes through instead of calling `console.log` ad hoc. `x dev` prints a settled startup summary (local/network URL, route count, startup time) followed by live request lines; `x build` prints a step-by-step list with per-step timing ending in the existing `N static, N server, N api routes -> <dir>` summary; `x start` prints a single clean "production server running at `<url>`" line. ANSI colors are now automatically stripped when stdout isn't a TTY (piped to a file/tool) or `NO_COLOR` is set.

Adds a machine-readable mode: `--json` (or `--format json`) emits one JSON object per line (NDJSON) on stdout for events like `build:start`/`build:step`/`build:complete`, `dev:ready`/`dev:request`/`dev:rebuild`, and `start:ready`; errors go to stderr as `{"event":"...:error","message","stack"}`. Exit codes are unchanged — a failed build still fails. `--format text` is the default, human-readable mode; an unknown `--format` value fails with a clear error, matching the existing `--adapter` error style.
