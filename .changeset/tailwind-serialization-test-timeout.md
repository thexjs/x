---
"@thexjs/cli": patch
---

Give the Tailwind-compile serialization test an explicit 15s timeout. Its `pollLog` helper has its own 5s deadline and is awaited twice in sequence, so the test had no margin against bun:test's 5s per-test default — flaky under CI resource contention, with no code defect behind it (confirmed: it isn't exercising the real Tailwind CLI, just a mocked `bunx`).
