import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface Frontmatter {
  title?: string;
  [key: string]: unknown;
}

export interface ContentEntry {
  filePath: string;
  routePath: string;
  slug: string;
  frontmatter: Frontmatter;
  body: string;
}

const CONTENT_FILE = /\.(md|mdx)$/;

export function scanContent(rootDir: string): ContentEntry[] {
  const entries: ContentEntry[] = [];

  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      const stat = statSync(full);

      if (stat.isDirectory()) {
        walk(full);
        continue;
      }

      if (!CONTENT_FILE.test(name)) continue;

      const raw = readFileSync(full, "utf-8");
      let frontmatter: Frontmatter;
      let body: string;
      try {
        ({ frontmatter, body } = parseFrontmatter(raw));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        throw new Error(`${message} (in ${full})`);
      }
      const rel = relative(rootDir, full).replace(CONTENT_FILE, "");
      const slug = name.replace(CONTENT_FILE, "");
      const routePath = toContentRoutePath(rel);

      entries.push({ filePath: full, routePath, slug, frontmatter, body });
    }
  }

  walk(rootDir);
  return entries;
}

function toContentRoutePath(relPath: string): string {
  const segments = relPath.split(sep).filter((s) => s !== "index");
  const joined = segments.join("/");
  return joined.length === 0 ? "/" : `/${joined}`;
}

export function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  const trimmed = raw.trimStart();

  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, body: trimmed };
  }

  // The closing delimiter is a `---` on its own line. Searching for `---`
  // anywhere would match a value like `title: a---b` mid-line and silently
  // truncate the frontmatter.
  const rest = trimmed.slice(3);
  const endMatch = /^---[ \t]*$/m.exec(rest);
  if (endMatch === null) {
    return { frontmatter: {}, body: trimmed };
  }

  const fmRaw = rest.slice(0, endMatch.index);
  const body = rest.slice(endMatch.index + endMatch[0].length).trimStart();

  let frontmatter: Frontmatter;
  try {
    frontmatter = parseYaml(fmRaw);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid YAML in frontmatter: ${message}`);
  }

  return { frontmatter, body };
}

/**
 * Parses frontmatter as YAML via Bun's native parser (full YAML 1.2 subset:
 * nested mappings, block scalars `|`/`>`, `- item` sequences, and scalar type
 * coercion like `draft: true` → boolean). Top-level values must be a mapping —
 * a scalar or array is rejected loudly instead of being silently dropped.
 */
function parseYaml(raw: string): Frontmatter {
  const parsed: unknown = Bun.YAML.parse(raw);
  if (parsed === undefined || parsed === null) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("expected a top-level mapping of key/value pairs");
  }
  return parsed as Frontmatter;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface ListLine {
  indent: number;
  type: "ul" | "ol";
  content: string;
}

function parseListLine(line: string): ListLine | null {
  let m = /^(\s*)[-*]\s+(.*)$/.exec(line);
  if (m) return { indent: m[1]?.length ?? 0, type: "ul", content: m[2] ?? "" };
  m = /^(\s*)\d+\.\s+(.*)$/.exec(line);
  if (m) return { indent: m[1]?.length ?? 0, type: "ol", content: m[2] ?? "" };
  return null;
}

/**
 * Converts a contiguous block of `- item` / `1. item` lines into a `<ul>` /
 * `<ol>` element, recursing into more-indented runs of lines to build nested
 * lists (indentation-based, like the rest of this hand-rolled parser — not a
 * full CommonMark list-item parser). Returns the block untouched when it
 * isn't a list at all.
 */
function renderListBlock(block: string): string {
  const rawLines = block.split("\n");
  const lines: ListLine[] = [];
  for (const l of rawLines) {
    const parsed = parseListLine(l);
    if (!parsed) return block;
    lines.push(parsed);
  }
  if (lines.length === 0) return block;

  let i = 0;
  function parseLevel(indent: number): string {
    // biome-ignore lint/style/noNonNullAssertion: guarded by the while loop's own `i < lines.length` check
    const type = lines[i]!.type;
    let out = "";
    while (i < lines.length) {
      const item = lines[i];
      if (!item || item.indent !== indent) break;
      i++;
      let itemHtml = item.content;
      const next = lines[i];
      if (next && next.indent > indent) {
        itemHtml += parseLevel(next.indent);
      }
      out += `<li>${itemHtml}</li>`;
    }
    return `<${type}>${out}</${type}>`;
  }
  // biome-ignore lint/style/noNonNullAssertion: lines.length === 0 already returned above
  return parseLevel(lines[0]!.indent);
}

/**
 * Converts a contiguous block of `> ...` lines into a `<blockquote>`.
 * Note: this only handles a single flat paragraph per blockquote — nested
 * blockquotes (`>>`) and multi-paragraph blockquotes are not supported (see
 * the PR description for the full list of deferred GFM constructs).
 */
function renderBlockquote(block: string): string {
  const lines = block.split("\n");
  // `>` was escaped to `&gt;` by the upfront `escapeHtml` pass, so detection
  // and stripping operate on the escaped form.
  if (!lines.every((l) => /^&gt;/.test(l.trim()))) return block;
  const stripped = lines.map((l) => l.trim().replace(/^&gt;[ \t]?/, "")).join("\n");
  return `<blockquote><p>${applyHardBreaks(stripped)}</p></blockquote>`;
}

/**
 * Splits one `| a | b |` table row into trimmed cell strings, tolerating a
 * missing leading/trailing pipe.
 */
function parseTableRow(line: string): string[] {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|")) l = l.slice(0, -1);
  return l.split("|").map((c) => c.trim());
}

const TABLE_ALIGN_CELL_RE = /^:?-{1,}:?$/;

/**
 * Renders a GFM pipe table (header row + `|---|:--:|` alignment row + body
 * rows) into `<table>`. Returns `null` when the block isn't a table, so the
 * caller can fall through to the next block kind.
 *
 * Known limitation: a `|` inside a cell (e.g. in inline code or a link) is
 * not escapable here and will be read as a column separator — the same
 * trade-off GFM table parsers make without a dedicated escape pass.
 */
function renderTableBlock(lines: string[]): string | null {
  if (lines.length < 2 || !lines[0]?.includes("|")) return null;
  const sepLine = lines[1];
  if (!sepLine) return null;
  const sepCells = parseTableRow(sepLine);
  if (sepCells.length === 0 || !sepCells.every((c) => TABLE_ALIGN_CELL_RE.test(c))) return null;

  const headerCells = parseTableRow(lines[0]);
  const aligns = sepCells.map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });

  const cellAttr = (i: number) => (aligns[i] ? ` style="text-align:${aligns[i]}"` : "");
  const thead = `<thead><tr>${headerCells
    .map((c, i) => `<th${cellAttr(i)}>${c}</th>`)
    .join("")}</tr></thead>`;
  const bodyRows = lines
    .slice(2)
    .map((line) => {
      const cells = parseTableRow(line);
      return `<tr>${cells.map((c, i) => `<td${cellAttr(i)}>${c}</td>`).join("")}</tr>`;
    })
    .join("");

  return `<table>${thead}<tbody>${bodyRows}</tbody></table>`;
}

/**
 * Converts a trailing hard line break — two or more spaces, or a backslash,
 * immediately before a newline — into `<br>`, GFM-style.
 */
function applyHardBreaks(text: string): string {
  return text.replace(/( {2,}|\\)\n/g, "<br>\n");
}

const ALLOWED_LINK_SCHEMES = new Set(["http", "https", "mailto"]);
const LINK_SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

/**
 * Percent-decodes a link URL for validation, tolerating malformed escapes.
 * Decoding runs repeatedly until the string stops changing (bounded): a
 * URL encoded twice — `java%2573cript:alert(1)` → `java%73cript:alert(1)` —
 * still yields its real scheme after the second pass, so the double- and
 * triple-encoded `javascript:` bypasses are rejected like every other
 * encoding trick this sanitizer already defends against.
 */
function decodeLinkUrl(url: string): string {
  let prev = url;
  for (let i = 0; i < 5; i++) {
    let next: string;
    try {
      next = decodeURIComponent(prev);
    } catch {
      // Malformed escape — give up decoding; the remaining literal `%`
      // keeps any hidden scheme from parsing as a live scheme.
      return prev;
    }
    if (next === prev) return next;
    prev = next;
  }
  return prev;
}

/**
 * Strips every C0 control character (U+0000–U+001F, which includes tab,
 * newline, and carriage return) from a URL wherever it occurs, before scheme
 * parsing. A control character embedded in — or leading — the scheme portion
 * defeats a naive scheme regex (which sees no scheme and assumes the link is
 * safe) while a real browser still executes the resulting `javascript:`
 * link: the WHATWG URL spec's basic parser strips leading/trailing C0
 * controls (and tab/newline/CR everywhere) before scheme detection, so
 * `\x01javascript:alert(1)` and `java\tscript:alert(1)` both resolve to a
 * live `javascript:` URL in a real browser even though this function's
 * output still shows no recognizable scheme to a naive regex. Stripping the
 * full C0 range rather than only tab/newline/CR closes that gap; no
 * legitimate `http`/`https`/`mailto` URL contains a raw control character; in
 * particular, this closes the C0-control variant of the javascript: bypass
 * this file already defends against (double-percent-encoding, scheme-
 * embedded tab/newline). The strip must happen before scheme detection and
 * before the value is written into the emitted `href` so no raw control
 * character leaks into the output either way.
 */
function stripUrlControlChars(url: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the whole point of this regex is matching C0 control characters -- that's the exact bypass class it closes (see the doc comment above), not an accidental literal control character in the source.
  return url.replace(/[\x00-\x1F]/g, "");
}

/**
 * True when a markdown link URL is safe to emit in an `href` attribute.
 * `escapeHtml` neutralizes `& < > "` but not URL schemes, so an href like
 * `javascript:alert(1)` — including a percent-encoded variant such as
 * `javascript:alert%281%29` or `java%73cript:...` — would otherwise produce a
 * live `javascript:` link that executes on click. Only the `http`, `https`
 * and `mailto` schemes are allowed; any other scheme-prefixed URL is rejected.
 * Relative and scheme-relative URLs (`/foo`, `./foo`, `../foo`, `#anchor`,
 * `?q=1`, `//cdn.example.com`) carry no scheme and pass through.
 */
function isSafeLinkUrl(url: string): boolean {
  const clean = stripUrlControlChars(url);
  const scheme = LINK_SCHEME_RE.exec(decodeLinkUrl(clean.trim()))?.[1]?.toLowerCase();
  return scheme === undefined || ALLOWED_LINK_SCHEMES.has(scheme);
}

/**
 * Matches a reference-link definition line, e.g. `[ref]: https://example.com`
 * (optionally followed by a quoted/parenthesized title, which this parser
 * ignores — titles are a deferred GFM detail, see the PR description).
 */
const REF_DEFINITION_RE =
  /^[ \t]{0,3}\[([^\]]+)\]:[ \t]*(\S+)[ \t]*(?:"[^"]*"|'[^']*'|\([^)]*\))?[ \t]*$/gm;

/** Matches a line that is only `---`, `***`, or `___` (3+ chars) — a horizontal rule. */
const HORIZONTAL_RULE_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm;

export function renderMarkdown(md: string): string {
  const inlineCodes: string[] = [];
  const fences: string[] = [];
  // Escape the entire source before any markup pass runs. `escapeHtml` only
  // touches `&`, `<`, `>`, `"` so every markdown construct (headings, code
  // fences, backticks, brackets) survives untouched, but raw `<script>` or
  // HTML tags in prose, fenced code, and inline code all arrive pre-escaped.
  // The tags we emit below are introduced after escaping, so they stay real
  // HTML while user content can never execute. Without this, markdown bodies
  // were injected via dangerouslySetInnerHTML with unescaped prose, so a
  // `<script>` in a .md/.mdx file ran in the visitor's browser.

  // Pull fenced code blocks out into unique placeholders immediately after
  // escaping, before any markup pass runs. The heading / inline-formatting /
  // list / link regexes must never see fence contents: a `# heading`,
  // `**bold**`, `*italic*`, or `[link](url)` inside a ``` block is literal
  // code, not markdown, and converting it would break the block's verbatim
  // promise. The placeholders are restored to their `<pre><code>` form
  // (already escaped, never re-processed) right before paragraph wrapping.
  let html = escapeHtml(md).replace(/`{3}(\w*)\n([\s\S]*?)`{3}/gm, (_m, _lang, code) => {
    // The fence body was already escaped up front — re-escaping here would
    // double-encode the `&` → `&amp;` entities just produced.
    fences.push(`<pre><code>${code.trim()}</code></pre>`);
    return `__X_FENCE_${fences.length - 1}__`;
  });

  // Reference-style link definitions (`[ref]: url`) can appear anywhere in
  // the document, so pull them into a lookup map — keyed case-insensitively,
  // per the GFM spec — before any other pass runs, and drop the definition
  // lines themselves (they render nothing).
  const refs = new Map<string, string>();
  html = html.replace(REF_DEFINITION_RE, (_m, ref, url) => {
    refs.set(String(ref).toLowerCase(), url);
    return "";
  });

  html = html
    .replace(HORIZONTAL_RULE_RE, "<hr>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/`([^`]+)`/g, (_m, code) => {
      inlineCodes.push(code);
      return `__X_CODE_${inlineCodes.length - 1}__`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    // Images MUST be processed before inline links: both use `[text](url)`,
    // differing only by the leading `!`, and the link regex below would
    // otherwise match the `[alt](src)` portion of `![alt](src)` and leave a
    // stray, un-linked `!` behind. Same URL-scheme sanitizer as links — an
    // image is just as capable of carrying a `javascript:` URL as a link is
    // (the attribute itself is inert, but we reject on principle and to stay
    // consistent with every other URL-accepting construct here).
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
      const clean = stripUrlControlChars(src);
      return isSafeLinkUrl(clean) ? `<img src="${clean}" alt="${alt}">` : alt;
    })
    // Reference-style links: `[text][ref]` resolves against the `refs` map
    // collected above; `[text][]` is the shortcut form that reuses `text` as
    // the ref. An unresolved reference is left as literal text (its brackets
    // included) rather than silently dropped.
    .replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (m, text, ref) => {
      const key = String(ref || text).toLowerCase();
      const url = refs.get(key);
      if (url === undefined) return m;
      const clean = stripUrlControlChars(url);
      return isSafeLinkUrl(clean) ? `<a href="${clean}">${text}</a>` : text;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => {
      const clean = stripUrlControlChars(href);
      return isSafeLinkUrl(clean) ? `<a href="${clean}">${text}</a>` : text;
    })
    // Autolinks: `<https://example.com>` / `<mailto:a@b.com>` survive the
    // upfront `escapeHtml` pass as `&lt;...&gt;`, so they're matched in their
    // escaped form. Scheme-prefixed autolinks still run through the same
    // sanitizer as every other URL-accepting construct; the scheme is
    // already constrained by the regex, but this keeps one code path for
    // "is this URL safe to emit" rather than two.
    .replace(/&lt;((?:https?|mailto):\S+?)&gt;/gi, (m, url) => {
      const clean = stripUrlControlChars(url);
      return isSafeLinkUrl(clean) ? `<a href="${clean}">${clean}</a>` : m;
    })
    // Bare-email autolinks (`<a@example.com>`) are always rendered as
    // `mailto:` — there's no scheme in the source to validate.
    .replace(/&lt;([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})&gt;/g, (_m, email) => {
      return `<a href="mailto:${email}">${email}</a>`;
    })
    .replace(/__X_CODE_(\d+)__/g, (_m, i) => `<code>${inlineCodes[Number.parseInt(i, 10)]}</code>`);

  html = html.replace(/__X_FENCE_(\d+)__/g, (_m, i) => fences[Number.parseInt(i, 10)] ?? "");

  const blocks = html.split(/\n\n+/);
  html = blocks
    .map((b) => {
      const t = b.trim();
      if (!t) return "";

      const lines = t.split("\n");
      const table = renderTableBlock(lines);
      if (table !== null) return table;

      const blockquote = renderBlockquote(t);
      if (blockquote !== t) return blockquote;

      const listBlock = renderListBlock(t);
      if (listBlock !== t) return listBlock;

      if (
        t.startsWith("<h") ||
        t.startsWith("<pre") ||
        t.startsWith("<ul") ||
        t.startsWith("<ol") ||
        t === "<hr>"
      )
        return t;
      return `<p>${applyHardBreaks(t)}</p>`;
    })
    .join("\n");

  return html;
}
