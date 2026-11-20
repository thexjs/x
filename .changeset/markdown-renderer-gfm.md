---
"@thexjs/core": minor
---

`renderMarkdown` now supports images (`![alt](src)`), GFM pipe tables with column alignment, blockquotes, horizontal rules (`---`/`***`/`___`), nested/multi-level lists, hard line breaks (trailing double-space or backslash), autolinks (`<https://example.com>`, `<user@example.com>`), reference-style links (`[text][ref]` + `[ref]: url`), and strikethrough (`~~text~~`). Images and autolinks reuse the existing `javascript:`/`data:`-URL sanitizer, so an unsafe image `src` or autolink renders as plain text instead of a live element.
