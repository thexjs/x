import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, renderMarkdown, scanContent } from "./content";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/content");

function touch(relPath: string, content: string) {
  const full = join(FIXTURE_DIR, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeAll(() => {
  touch(
    "hello.md",
    `---
title: Hello World
date: 2025-01-01
---

# Hello

This is the body.
`,
  );
  touch(
    "blog/post-one.md",
    `---
title: Post One
tags: a, b
---

Post body.
`,
  );
  touch("plain.txt", "not a content file");
  touch(".hidden.md", "should be skipped");
});

afterAll(() => {
  rmSync(join(import.meta.dir, "__fixtures__"), { recursive: true, force: true });
});

describe("parseFrontmatter", () => {
  test("parses frontmatter and body", () => {
    const { frontmatter, body } = parseFrontmatter(`---
title: Test
---

Body content
`);
    expect(frontmatter.title).toBe("Test");
    expect(body.trim()).toBe("Body content");
  });

  test("returns empty frontmatter when no delimiter", () => {
    const { frontmatter, body } = parseFrontmatter("Just content");
    expect(frontmatter).toEqual({});
    expect(body).toBe("Just content");
  });

  test("parses nested object frontmatter", () => {
    const { frontmatter } = parseFrontmatter(`---
seo:
  title: Page Title
  description: A description
author: Jane
---
Body
`);
    expect(frontmatter).toEqual({
      seo: { title: "Page Title", description: "A description" },
      author: "Jane",
    });
  });

  test("parses block scalars and sequences", () => {
    const { frontmatter } = parseFrontmatter(`---
tags:
  - one
  - two
summary: |
  First line.
  Second line.
---
Body
`);
    expect(frontmatter).toEqual({
      tags: ["one", "two"],
      summary: "First line.\nSecond line.\n",
    });
  });

  test("coerces YAML scalar types", () => {
    const { frontmatter } = parseFrontmatter(`---
draft: true
priority: 10
ratio: 1.5
price: null
---
Body
`);
    expect(frontmatter).toEqual({
      draft: true,
      priority: 10,
      ratio: 1.5,
      price: null,
    });
  });

  test("does not split the closing delimiter out of a value line", () => {
    const { frontmatter, body } = parseFrontmatter(`---
title: a---b
---
Body
`);
    expect(frontmatter.title).toBe("a---b");
    expect(body.trim()).toBe("Body");
  });

  test("rejects syntactically invalid YAML instead of dropping it silently", () => {
    expect(() =>
      parseFrontmatter(`---
title: "unclosed
---
Body
`),
    ).toThrow("Invalid YAML in frontmatter");
  });

  test("rejects a non-mapping top-level value", () => {
    expect(() =>
      parseFrontmatter(`---
- just
- a
- list
---
Body
`),
    ).toThrow("expected a top-level mapping");
  });
});

describe("scanContent", () => {
  test("discovers markdown files with frontmatter", () => {
    const entries = scanContent(FIXTURE_DIR);
    const routes = entries.map((e) => e.routePath).sort();
    expect(routes).toEqual(["/blog/post-one", "/hello"]);
  });

  test("parses frontmatter for each entry", () => {
    const entries = scanContent(FIXTURE_DIR);
    const hello = entries.find((e) => e.routePath === "/hello");
    expect(hello?.frontmatter.title).toBe("Hello World");
  });

  test("skips non-markdown files", () => {
    const entries = scanContent(FIXTURE_DIR);
    expect(entries.some((e) => e.filePath.endsWith("plain.txt"))).toBe(false);
  });

  test("surfaces the offending file path when frontmatter is invalid", () => {
    const badDir = join(import.meta.dir, "__fixtures__/content-bad");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(
      join(badDir, "broken.md"),
      `---
title: "unclosed
---
Body
`,
    );
    try {
      expect(() => scanContent(badDir)).toThrow("broken.md");
    } finally {
      rmSync(badDir, { recursive: true, force: true });
    }
  });
});

describe("renderMarkdown", () => {
  test("escapes raw HTML in prose so scripts cannot execute", () => {
    const html = renderMarkdown("# Hello\n\n<script>alert('xss')</script>\n\nSafe.");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<h1>Hello</h1>");
  });

  test("escapes raw HTML in fenced code blocks without double-escaping", () => {
    const html = renderMarkdown("```html\n<div>hi</div>\n```");
    expect(html).toContain("<pre><code>&lt;div&gt;hi&lt;/div&gt;</code></pre>");
    expect(html).not.toContain("&amp;lt;");
  });

  test("escapes content inside inline code spans", () => {
    const html = renderMarkdown("Use `\u003cscript\u003e` inline.");
    expect(html).toContain("<code>&lt;script&gt;</code>");
    expect(html).not.toContain("<script>");
  });

  test("keeps a heading inside a fenced code block as literal text", () => {
    const html = renderMarkdown("```\n# not a heading\n```");
    expect(html).toContain("<pre><code># not a heading</code></pre>");
    expect(html).not.toContain("<h1>");
  });

  test("keeps subheadings inside a fenced code block as literal text", () => {
    const html = renderMarkdown("```\n## two\n### three\n```");
    expect(html).toContain("<pre><code>## two\n### three</code></pre>");
    expect(html).not.toContain("<h2>");
    expect(html).not.toContain("<h3>");
  });

  test("keeps bold/italic inside a fenced code block as literal text", () => {
    const html = renderMarkdown("```\n**not bold** and *not italic*\n```");
    expect(html).toContain("<pre><code>**not bold** and *not italic*</code></pre>");
    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("<em>");
  });

  test("keeps a markdown link inside a fenced code block as literal text", () => {
    const html = renderMarkdown("```\n[not a link](https://example.com)\n```");
    expect(html).toContain("<pre><code>[not a link](https://example.com)</code></pre>");
    expect(html).not.toContain("<a");
  });

  test("keeps a fenced block intact when prose follows it", () => {
    const html = renderMarkdown("```\n# heading\n```\n\nAfter, with **bold**.");
    expect(html).toContain("<pre><code># heading</code></pre>");
    expect(html).not.toContain("<h1>");
    expect(html).toContain("<p>After, with <strong>bold</strong>.</p>");
  });

  test("escapes entity-like text without double-encoding ampersands", () => {
    const html = renderMarkdown("a & b");
    expect(html).toContain("a &amp; b");
    expect(html).not.toContain("&amp;amp;");
  });

  test("renders unordered lists from '- item' lines", () => {
    const html = renderMarkdown("- one\n- two\n- three");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
    expect(html).toContain("<li>three</li>");
    expect(html).toContain("</ul>");
  });

  test("renders ordered lists from '1. item' lines", () => {
    const html = renderMarkdown("1. first\n2. second\n3. third");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<li>second</li>");
    expect(html).toContain("</ol>");
  });

  test("applies inline formatting inside list items", () => {
    const html = renderMarkdown("- **bold** and `code`");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li><strong>bold</strong> and <code>code</code></li>");
  });

  test("escapes markup in list items to prevent injection", () => {
    const html = renderMarkdown("- \u003cscript\u003ealert(1)\u003c/script\u003e");
    expect(html).toContain("<ul>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderMarkdown link URL sanitization", () => {
  test("renders a javascript: link as plain text, never as an anchor", () => {
    const html = renderMarkdown("[run](javascript:alert(1))");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href");
    expect(html).toContain("run");
  });

  test("rejects an uppercase JavaScript: scheme", () => {
    const html = renderMarkdown("[run](JavaScript:alert(1))");
    expect(html).not.toContain("<a");
    expect(html).toContain("run");
  });

  test("rejects a percent-encoded javascript: URL", () => {
    const html = renderMarkdown("[run](javascript:alert%281%29)");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href");
    expect(html).toContain("run");
  });

  test("rejects a scheme-encoded (mixed) javascript: URL", () => {
    const html = renderMarkdown("[run](java%73cript:alert(1))");
    expect(html).not.toContain("<a");
    expect(html).toContain("run");
  });

  test("rejects a double-encoded javascript: URL", () => {
    const html = renderMarkdown("[run](java%2573cript:alert(1))");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href");
    expect(html).toContain("run");
  });

  test("rejects a triple-encoded javascript: URL", () => {
    const html = renderMarkdown("[run](java%252573cript:alert(1))");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href");
    expect(html).toContain("run");
  });

  test("rejects a javascript: URL with a literal tab splitting the scheme", () => {
    const html = renderMarkdown("[run](java\tscript:alert%281%29)");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href");
    expect(html).toContain("run");
  });

  test("rejects a javascript: URL with a literal carriage return splitting the scheme", () => {
    const html = renderMarkdown("[run](java\rscript:alert%281%29)");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href");
    expect(html).toContain("run");
  });

  test("rejects a javascript: URL with a literal newline splitting the scheme", () => {
    const html = renderMarkdown("[run](java\nscript:alert%281%29)");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href");
    expect(html).toContain("run");
  });

  test("rejects a tab-split scheme with encoded parens and mixed-cased scheme", () => {
    const html = renderMarkdown("[run](JaVa\tscript:alert%281%29)");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href");
    expect(html).toContain("run");
  });

  test("strips control characters from a safe URL and renders the cleaned href", () => {
    const html = renderMarkdown("[docs](https://example.com/\tdocs)");
    expect(html).toContain('<a href="https://example.com/docs">docs</a>');
    expect(html).not.toContain("\t");
  });

  test("rejects a javascript: URL hidden behind a leading C0 control character", () => {
    // A leading \x01 (not tab/LF/CR) used to survive the sanitizer: the
    // scheme regex saw no recognizable scheme and isSafeLinkUrl treated the
    // whole thing as a safe relative URL, emitting a live javascript: href.
    // Real browsers strip leading C0 controls before scheme parsing (WHATWG
    // URL spec), so this executed on click despite looking "safe" here.
    const html = renderMarkdown("[run](\x01javascript:alert(document.cookie))");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href");
    expect(html).toContain("run");
  });

  test("rejects a javascript: URL with a C0 control character splitting the scheme", () => {
    const html = renderMarkdown("[run](java\x0Bscript:alert(1))");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href");
    expect(html).toContain("run");
  });

  test("strips a non-tab/newline C0 control character from a safe URL and renders the cleaned href", () => {
    const html = renderMarkdown("[docs](https://example.com/\x01docs)");
    expect(html).toContain('<a href="https://example.com/docs">docs</a>');
    expect(html).not.toContain("\x01");
  });

  test("rejects a data: URL", () => {
    const html = renderMarkdown(
      "[x](data:text/html,\u003cscript\u003ealert(1)\u003c/script\u003e)",
    );
    expect(html).not.toContain("<a");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("href");
  });

  test("rejects vbscript: and other unknown schemes", () => {
    const html = renderMarkdown("[x](vbscript:msgbox(1)) [y](ftp://files.example.com/a)");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href");
  });

  test("keeps http/https links as anchors", () => {
    const html = renderMarkdown("[docs](https://example.com) [api](http://localhost/api?x=1&y=2)");
    expect(html).toContain('<a href="https://example.com">docs</a>');
    expect(html).toContain('<a href="http://localhost/api?x=1&amp;y=2">api</a>');
  });

  test("keeps mailto and relative links as anchors", () => {
    const html = renderMarkdown(
      "[mail](mailto:hi@example.com) [home](/foo) [rel](./bar) [up](../up) [anchor](#top) [proto](//cdn.example.com/x)",
    );
    expect(html).toContain('<a href="mailto:hi@example.com">mail</a>');
    expect(html).toContain('<a href="/foo">home</a>');
    expect(html).toContain('<a href="./bar">rel</a>');
    expect(html).toContain('<a href="../up">up</a>');
    expect(html).toContain('<a href="#top">anchor</a>');
    expect(html).toContain('<a href="//cdn.example.com/x">proto</a>');
  });
});

describe("renderMarkdown images", () => {
  test("renders an image with escaped alt text", () => {
    const html = renderMarkdown("![a cat](https://example.com/cat.png)");
    expect(html).toContain('<img src="https://example.com/cat.png" alt="a cat">');
  });

  test("rejects a javascript: image src and renders only the alt text", () => {
    const html = renderMarkdown("![bad](javascript:alert(1))");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("src=");
    expect(html).toContain("bad");
  });

  test("rejects a data: image src", () => {
    const html = renderMarkdown("![bad](data:text/html,<script>alert(1)</script>)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
  });

  test("does not let an image swallow a following inline link", () => {
    const html = renderMarkdown(
      "![alt](https://example.com/img.png) and [a link](https://example.com)",
    );
    expect(html).toContain('<img src="https://example.com/img.png" alt="alt">');
    expect(html).toContain('<a href="https://example.com">a link</a>');
  });

  test("escapes markup in alt text to prevent injection", () => {
    const html = renderMarkdown("![<script>alert(1)</script>](https://example.com/x.png)");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderMarkdown GFM tables", () => {
  test("renders a basic table with header and body rows", () => {
    const html = renderMarkdown("| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<thead><tr><th>Name</th><th>Age</th></tr></thead>");
    expect(html).toContain("<td>Alice</td>");
    expect(html).toContain("<td>Bob</td>");
    expect(html).toContain("</table>");
  });

  test("applies column alignment from the separator row", () => {
    const html = renderMarkdown("| L | C | R |\n|:---|:---:|---:|\n| a | b | c |");
    expect(html).toContain('<th style="text-align:left">L</th>');
    expect(html).toContain('<th style="text-align:center">C</th>');
    expect(html).toContain('<th style="text-align:right">R</th>');
  });

  test("tolerates missing leading/trailing pipes", () => {
    const html = renderMarkdown("a | b\n---|---\n1 | 2");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>1</td>");
  });

  test("leaves a non-table block alone", () => {
    const html = renderMarkdown("Just a | pipe in prose, not a table.");
    expect(html).not.toContain("<table>");
    expect(html).toContain("<p>Just a | pipe in prose, not a table.</p>");
  });
});

describe("renderMarkdown blockquotes", () => {
  test("renders a single-line blockquote", () => {
    const html = renderMarkdown("> A quoted line.");
    expect(html).toContain("<blockquote><p>A quoted line.</p></blockquote>");
  });

  test("renders a multi-line blockquote as one block", () => {
    const html = renderMarkdown("> Line one\n> Line two");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("Line one");
    expect(html).toContain("Line two");
    expect(html).toContain("</blockquote>");
  });

  test("escapes markup inside a blockquote", () => {
    const html = renderMarkdown("> <script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderMarkdown horizontal rules", () => {
  test("renders --- as an hr", () => {
    const html = renderMarkdown("Above\n\n---\n\nBelow");
    expect(html).toContain("<hr>");
  });

  test("renders *** and ___ as an hr", () => {
    expect(renderMarkdown("***")).toContain("<hr>");
    expect(renderMarkdown("___")).toContain("<hr>");
  });
});

describe("renderMarkdown nested lists", () => {
  test("renders a nested unordered list", () => {
    const html = renderMarkdown("- one\n  - nested one\n  - nested two\n- two");
    expect(html).toContain("<li>one<ul><li>nested one</li><li>nested two</li></ul></li>");
    expect(html).toContain("<li>two</li>");
  });

  test("renders a flat list the same as before (no regression)", () => {
    const html = renderMarkdown("- one\n- two\n- three");
    expect(html).toBe("<ul><li>one</li><li>two</li><li>three</li></ul>");
  });
});

describe("renderMarkdown hard line breaks", () => {
  test("converts two trailing spaces before a newline into <br>", () => {
    const html = renderMarkdown("line one  \nline two");
    expect(html).toContain("line one<br>");
    expect(html).toContain("line two");
  });

  test("converts a trailing backslash before a newline into <br>", () => {
    const html = renderMarkdown("line one\\\nline two");
    expect(html).toContain("line one<br>");
  });

  test("does not add <br> for a single trailing space", () => {
    const html = renderMarkdown("line one \nline two");
    expect(html).not.toContain("<br>");
  });
});

describe("renderMarkdown autolinks", () => {
  test("renders a bare https autolink", () => {
    const html = renderMarkdown("See <https://example.com> for docs.");
    expect(html).toContain('<a href="https://example.com">https://example.com</a>');
  });

  test("renders a bare email autolink as mailto", () => {
    const html = renderMarkdown("Contact <jane@example.com>.");
    expect(html).toContain('<a href="mailto:jane@example.com">jane@example.com</a>');
  });

  test("does not autolink an unsafe scheme", () => {
    const html = renderMarkdown("<javascript:alert(1)>");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href");
  });
});

describe("renderMarkdown reference-style links", () => {
  test("resolves a reference link against its definition", () => {
    const html = renderMarkdown(
      "See [the docs][docs-ref].\n\n[docs-ref]: https://example.com/docs",
    );
    expect(html).toContain('<a href="https://example.com/docs">the docs</a>');
    expect(html).not.toContain("[docs-ref]:");
  });

  test("resolves the shortcut reference form [text][]", () => {
    const html = renderMarkdown("See [Example][].\n\n[Example]: https://example.com");
    expect(html).toContain('<a href="https://example.com">Example</a>');
  });

  test("is case-insensitive when matching the reference label", () => {
    const html = renderMarkdown("See [docs][DOCS-REF].\n\n[docs-ref]: https://example.com/docs");
    expect(html).toContain('<a href="https://example.com/docs">docs</a>');
  });

  test("rejects an unsafe scheme in a reference link definition", () => {
    const html = renderMarkdown("[run][x]\n\n[x]: javascript:alert(1)");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href");
    expect(html).toContain("run");
  });

  test("leaves an unresolved reference link as literal text", () => {
    const html = renderMarkdown("[nothing][missing-ref]");
    expect(html).not.toContain("<a");
    expect(html).toContain("[nothing][missing-ref]");
  });
});

describe("renderMarkdown strikethrough", () => {
  test("renders ~~text~~ as <del>", () => {
    const html = renderMarkdown("~~deleted~~ text");
    expect(html).toContain("<del>deleted</del> text");
  });
});
