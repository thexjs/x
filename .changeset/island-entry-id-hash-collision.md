---
"@thexjs/core": patch
---

Fix a potential island bundle id collision: `islandEntryId` combined a route file's basename with a hand-rolled 32-bit rolling hash of its full path, which had a real (if small) chance of colliding for two different route files sharing a basename (e.g. two `index.tsx` files in different directories) on an app with many routes -- silently overwriting each other's compiled island bundle on disk. The hash now uses `Bun.hash` (64-bit, truncated to 16 hex characters), making this effectively impossible at any realistic route count. No caller changes needed.
