---
"create-thexjs-app": minor
---

`bun create thexjs-app --auth` now scaffolds real `@thexjs/auth` (a credentials provider against a hashed-password `users` table, HMAC'd sessions, brute-force-guarded sign-in, CSRF-checked actions) instead of a hardcoded `admin`/`admin` demo with plaintext comparison and no session expiry. Adds a `/signup` page and `POST /api/auth/signup` endpoint since `defineAuth` has no "create user" API of its own.
