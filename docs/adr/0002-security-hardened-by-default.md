---

## status: accepted

# Security defaults are on by default; apps opt out, not in

CSP, HSTS, X-Frame-Options, CSRF origin verification, rate limiting, and the build-time env-isolation scanner are all enabled the moment `createApp()` runs, with no configuration required. An app that wants a given protection off must say so explicitly (`security: { headers: false }`, `security: { rateLimit: false }`), never the reverse.

Most frameworks ship these as opt-in middleware an app author has to know to reach for, which means most apps never do. We inverted that because the cost of a forgotten security header is a silent vulnerability, while the cost of an unwanted default is a one-line config override — the failure modes aren't symmetric, so the default shouldn't be either.
