---
"@thexjs/env": patch
---

Document why the `input as T` cast in `oneOf()` is safe (it relies on the preceding `values.includes()` guard). Docs-only, no behavior change.
