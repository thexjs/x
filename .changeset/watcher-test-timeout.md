---
"@thexjs/core": patch
---

Give the dev-mode route-tree watcher test an explicit 20s timeout. It polls for up to 8s twice (new route appearing, then removed route disappearing) but had no timeout of its own, so it was at the mercy of bun:test's 5s default — flaky under CI resource contention, with no code defect behind it.
