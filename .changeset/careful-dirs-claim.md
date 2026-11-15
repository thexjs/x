---
"create-thexjs-app": patch
---

Close a check-then-create race when scaffolding into an existing directory: the target directory is now created atomically and a directory filled by a concurrent run is rejected instead of being written into.
