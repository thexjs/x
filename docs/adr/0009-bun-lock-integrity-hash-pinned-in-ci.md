---

## status: accepted

# bun.lock carries a committed integrity hash, deliberately updated, checked in CI

`.github/bun-lock.sha256` pins a SHA-256 of `bun.lock`. CI's "Verify bun.lock integrity hash" step fails whenever `bun.lock` changes without that hash being updated in the same commit — `bun run update:bun-hash` (or `shasum -a 256 bun.lock`) is the deliberate, manual step that updates it.

This is on top of (not a replacement for) Bun's own `--frozen-lockfile` enforcement in `bun install`, which only proves the lockfile is internally consistent with `package.json` — it says nothing about whether the _content_ of a lockfile change was reviewed by a human. The hash exists so an unreviewed hand-edit of `bun.lock` fails CI even when it happens to stay internally consistent; the cost is that every dependency bump (including routine Dependabot PRs) fails CI once on the integrity-hash step until a human runs the update script, which is the point, not a bug in the check.
