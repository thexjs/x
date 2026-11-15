---
"@thexjs/core": minor
---

Add an opt-in `requestTimeoutMs` option to `createApp`: a handler that exceeds the budget returns 504 Gateway Timeout (reported via the configured error reporter/metrics) instead of being able to stall every other request in the process indefinitely. Unset by default -- no behavior change unless you opt in.
