---

## status: accepted

# All @thexjs/* packages release in lockstep on a single versioning cycle

There is no independent release cadence per package — every package bumps together, every cycle, even one that had no code change (see `VERSIONING.md`, `SUPPORT.md`).

Independent per-package versioning was the obvious path and was rejected: with nine packages that reference each other across workspace boundaries (`@thexjs/cli` imports `@thexjs/core`, `@thexjs/adapter-vercel` and `@thexjs/adapter-node` both depend on `@thexjs/core`'s adapter surface), letting them drift independently would mean every consumer has to reason about a compatibility matrix instead of "one version, guaranteed to work together." The cost is noisier changelogs for packages that didn't actually change — judged worth it for the simpler mental model.
