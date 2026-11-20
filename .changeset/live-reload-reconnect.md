---
"@thexjs/core": patch
---

Reconnect the dev live-reload `EventSource` with bounded exponential backoff after an error and reload the page on reconnect so open tabs recover when the dev server restarts.
