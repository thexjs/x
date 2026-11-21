---
"@thexjs/core": patch
---

Reconnect the dev live-reload `EventSource` with bounded exponential backoff after an error and perform a full page reload on reconnect so open tabs recover with fresh HTML when the dev server restarts.
