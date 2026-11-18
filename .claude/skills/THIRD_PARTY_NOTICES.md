# Third-party notices

Every skill folder under `.claude/skills/` (except `framework-stability-review`,
which is specific to this repo) is vendored from
[mattpocock/skills](https://github.com/mattpocock/skills), MIT licensed:

```
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Vendored as a flat copy (no `engineering/`/`productivity`/etc. category
subfolders, matching this repo's existing `.opencode/skills/` convention) at
the commit current when this notice was added. These are editable files, not
an auto-updating plugin — see the upstream repo's README for an
auto-updating Claude Code plugin install instead
(`claude plugin install mattpocock-skills@claude-plugins-official`), if
that's preferred over a repo-committed, hand-updated copy.
