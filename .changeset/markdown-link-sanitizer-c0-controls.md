---
"@thexjs/core": patch
---

Close a `javascript:` link sanitizer bypass in `renderMarkdown`: a leading C0 control character other than tab/newline/CR (e.g. `\x01`) survived the old `stripUrlControlChars` (which only stripped `\t\n\r`), so a markdown link like `[x](\x01javascript:alert(1))` was treated as a safe relative URL and emitted as a live `javascript:` href — real browsers strip leading C0 controls before scheme parsing (WHATWG URL spec), so the link executed on click despite the sanitizer seeing no recognizable scheme. `stripUrlControlChars` now strips the full C0 control range (`\x00`-`\x1F`), not just tab/newline/CR.
