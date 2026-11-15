---
"@thexjs/core": patch
---

Redis rate-limit store now increments and sets the window TTL in one atomic Lua script (`EVAL`), so a dropped connection can no longer leave a counter without an expiry. It also cuts the store to one round trip per request. Counters already stranded without a TTL are repaired on their next hit. If the Redis server denies scripting (disabled, or an ACL without `EVAL`), the store falls back to the previous multi-command path instead of failing.
