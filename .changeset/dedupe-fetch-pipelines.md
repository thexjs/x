---
"@thexjs/core": patch
---

Dedupe the dev and prod request pipelines in `createApp`. Both previously carried near-identical ~90-line copies of the same health-check -> metrics -> rate-limit -> revalidation -> hydration-mismatch -> server-functions -> static-assets -> islands -> image-proxy -> route-match -> 404 chain, which had already drifted out of sync once. They now share a single `buildFetchInner(devExtras?)`, with dev's one real behavioral difference — the `/__x/reload` SSE endpoint — injected at the same point dev has always had it. No behavioral change; the outer hardening/rate-limit/tracing/logging/metrics wrappers are untouched.
