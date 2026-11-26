# Architecture Decision Records

Each file here records one decision: what we chose, why, and what it costs. Numbered sequentially (`0001-slug.md`, `0002-slug.md`, ...); see [`.claude/skills/domain-modeling/ADR-FORMAT.md`](../../.claude/skills/domain-modeling/ADR-FORMAT.md) for the authoring format and the bar a decision has to clear to get one.

| #                                                                                   | Decision                                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [0001](./0001-bun-native-runtime.md)                                                | Bun-native runtime, not a Node framework that happens to run under Bun                |
| [0002](./0002-security-hardened-by-default.md)                                      | Security defaults are on by default; apps opt out, not in                             |
| [0003](./0003-forwarded-header-trust-is-explicit-opt-in.md)                         | Forwarded headers are untrusted unless explicitly opted into                          |
| [0004](./0004-in-memory-stores-by-default.md)                                       | Rate limiting, ISR cache, and the brute-force guard default to in-memory stores       |
| [0005](./0005-layoutsdir-wraps-globally-nested-layout-is-the-scoping-mechanism.md)  | `layoutsDir` wraps every route globally; `_layout.tsx` is the scoping mechanism       |
| [0006](./0006-island-path-string-declaration-for-co-located-server-only-imports.md) | Islands co-located with server-only code must be declared as a path string            |
| [0007](./0007-forwarded-host-gated-behind-trusted-proxy-for-csrf-self-origin.md)    | A forwarded host only becomes CSRF's "self" origin when trust is opted into           |
| [0008](./0008-lockstep-versioning-across-all-packages.md)                           | All `@thexjs/*` packages release in lockstep on one versioning cycle                  |
| [0009](./0009-bun-lock-integrity-hash-pinned-in-ci.md)                              | `bun.lock` carries a committed integrity hash, deliberately updated                   |
| [0010](./0010-createenv-client-server-boundary-is-additive-not-breaking.md)         | `createEnv()`'s client/server boundary was added additively, not as a breaking change |
| [0011](./0011-auth-uses-node-crypto-blocking-edge-runtime-deployment.md)            | `@thexjs/auth` depends on `node:crypto`, blocking Edge Function deployment (open)     |

Most of these were written in one pass to backfill decisions that already existed in code and documentation (`AGENTS.md`'s Gotchas section, `VERSIONING.md`, `SUPPORT.md`) but had never been recorded as a standalone, linkable decision. From here on, add a new ADR when a decision is made, not in a retroactive batch — see the "When to offer an ADR" section of the format doc.
