---
---

Test-only: fix a flaky test in packages/auth (brute-force-redis.test.ts's FakeRedis clock drifted across sequential calls on slow CI runners). No behavioral change, no release needed.
