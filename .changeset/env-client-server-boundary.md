---
"@thexjs/env": minor
---

`createEnv()` now also returns `client` and `server` structural sub-objects alongside the existing flat top-level keys. `env.client` contains only the keys that passed the `clientPrefix` check — it's the structurally-safe shape to serialize for a hydration payload (`window.__ENV__ = env.client`), since it can never carry a server secret even if the schema grows one later. `env.server` mirrors the server-only keys, for symmetry. This is additive: every existing flat `env.SOME_KEY` access keeps working unchanged.
