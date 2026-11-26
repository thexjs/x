---

## status: accepted

# createEnv()'s client/server structural boundary was added additively, not as a breaking change

`createEnv()` now returns `client` and `server` sub-objects alongside its existing flat top-level keys (issue #172). `env.client` is structurally incapable of containing a server secret — the safe shape to serialize for a hydration payload — while every existing `env.SOME_KEY` access keeps working unchanged.

The issue that prompted this explicitly proposed making `{ server, client }` the _only_ return shape, as a breaking change shipped alongside a deprecated flat export for one major version. We chose the additive form instead: every current call site in this monorepo (and any external consumer) keeps working with no deprecation cycle, migration guide, or major-version bump required, and the safety goal — a shape that can't leak a secret — is achieved just as completely by `env.client` existing at all. The breaking version would have been "more correct" in the sense of eventually removing the footgun entirely; we judged the non-breaking version's lower cost (zero migration burden, available immediately) worth more than that eventual removal, especially this early in the project's life.
