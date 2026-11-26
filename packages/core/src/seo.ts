import { escapeHtml } from "./content";

export interface OpenGraphData {
  title?: string | undefined;
  description?: string | undefined;
  /** Absolute or root-relative image URL. */
  image?: string | undefined;
  /** Defaults to the page's own canonical/request URL when omitted. */
  url?: string | undefined;
  /** Defaults to "website". */
  type?: string | undefined;
  siteName?: string | undefined;
}

export interface TwitterCardData {
  /** Defaults to "summary_large_image" when an image is set, "summary" otherwise. */
  card?: "summary" | "summary_large_image" | undefined;
  title?: string | undefined;
  description?: string | undefined;
  image?: string | undefined;
}

/**
 * Per-page SEO data. Every field is optional -- a page that sets none of
 * these keeps rendering exactly as it did before this existed (title falls
 * back to "x app", no extra meta tags are emitted).
 */
export interface SeoData {
  title?: string | undefined;
  description?: string | undefined;
  /** Absolute or root-relative canonical URL for this page. */
  canonical?: string | undefined;
  /** e.g. "noindex, nofollow". Omitted entirely unless set. */
  robots?: string | undefined;
  openGraph?: OpenGraphData | undefined;
  twitter?: TwitterCardData | undefined;
  /**
   * Structured data for this page, emitted as a single
   * `<script type="application/ld+json">` tag. Pass an array to emit
   * multiple distinct JSON-LD objects in one script tag (a valid JSON-LD
   * document can be a single object or an array of them).
   */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[] | undefined;
}

/**
 * A page's `generateSeo` export: computed per-request from the same
 * `params`/`loaderData` a `loader` already produced, so a dynamic route
 * (`/blog/[slug]`) can set its title/description from the post it loaded
 * instead of a static, route-wide value.
 */
export type GenerateSeo = (ctx: {
  params: Record<string, string>;
  loaderData: Record<string, unknown>;
}) => SeoData | Promise<SeoData>;

function metaTag(name: string, content: string | undefined): string {
  return content
    ? `\n    <meta name="${escapeHtml(name)}" content="${escapeHtml(content)}" />`
    : "";
}

function metaProperty(property: string, content: string | undefined): string {
  return content
    ? `\n    <meta property="${escapeHtml(property)}" content="${escapeHtml(content)}" />`
    : "";
}

/**
 * Builds the extra `<head>` tags for one page's `SeoData` -- everything
 * except `<title>`, which the render shell already owns (so `seo.title`
 * flows through the same place `options.title` always has).
 */
export function buildSeoHeadTags(seo: SeoData | undefined): string {
  if (!seo) return "";

  const og = seo.openGraph;
  const twitter = seo.twitter;
  // A Twitter card is only worth emitting once there's something to show --
  // defaulting the card type with no title/description/image would just add
  // dead markup to every page that sets any other SEO field.
  const hasTwitterContent = twitter && (twitter.title || twitter.description || twitter.image);
  const twitterCard =
    twitter?.card ?? (twitter?.image || og?.image ? "summary_large_image" : "summary");

  return [
    metaTag("description", seo.description),
    metaTag("robots", seo.robots),
    seo.canonical ? `\n    <link rel="canonical" href="${escapeHtml(seo.canonical)}" />` : "",
    og
      ? [
          metaProperty("og:title", og.title ?? seo.title),
          metaProperty("og:description", og.description ?? seo.description),
          metaProperty("og:type", og.type ?? "website"),
          metaProperty("og:url", og.url ?? seo.canonical),
          metaProperty("og:image", og.image),
          metaProperty("og:site_name", og.siteName),
        ].join("")
      : "",
    hasTwitterContent
      ? [
          metaTag("twitter:card", twitterCard),
          metaTag("twitter:title", twitter?.title ?? seo.title),
          metaTag("twitter:description", twitter?.description ?? seo.description),
          metaTag("twitter:image", twitter?.image ?? og?.image),
        ].join("")
      : "",
    seo.jsonLd
      ? `\n    <script type="application/ld+json">${escapeJsonLd(seo.jsonLd)}</script>`
      : "",
  ].join("");
}

// `</script>` inside a JSON string would close the tag early -- escape the
// one character sequence that matters for a <script> body, same convention
// render.ts's escapeJsonForScript uses for island props.
function escapeJsonLd(data: Record<string, unknown> | Record<string, unknown>[]): string {
  return JSON.stringify(data).replace(/<\//g, "<\\/");
}

export interface SitemapEntry {
  /** Root-relative path, e.g. "/about" or "/blog/hello-world". */
  routePath: string;
  lastModified?: Date;
}

/**
 * Generates a sitemap.xml body from a list of statically-known routes.
 * `siteUrl` must not have a trailing slash (callers normalize this).
 */
export function generateSitemapXml(entries: SitemapEntry[], siteUrl: string): string {
  const urls = entries
    .map((entry) => {
      const loc = `${siteUrl}${entry.routePath === "/" ? "" : entry.routePath}`;
      const lastmod = entry.lastModified
        ? `\n    <lastmod>${entry.lastModified.toISOString().slice(0, 10)}</lastmod>`
        : "";
      return `  <url>\n    <loc>${escapeHtml(loc)}</loc>${lastmod}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * Generates a robots.txt body. Defaults to allow-everything plus a Sitemap
 * directive when `siteUrl` is set; pass `disallow` paths to block specific
 * routes (e.g. a staging deploy, or an internal-only section).
 */
export function generateRobotsTxt(options: {
  siteUrl?: string | undefined;
  disallow?: string[] | undefined;
}): string {
  const disallowLines = (options.disallow ?? []).map((path) => `Disallow: ${path}`);
  const lines = ["User-agent: *", ...(disallowLines.length > 0 ? disallowLines : ["Disallow:"])];
  if (options.siteUrl) {
    lines.push("", `Sitemap: ${options.siteUrl}/sitemap.xml`);
  }
  return `${lines.join("\n")}\n`;
}

/** `x.config.ts`'s `seo` option -- consumed by `x build`, not the dev/prod server. */
export interface SeoConfig {
  /** Canonical origin, no trailing slash, e.g. "https://example.com". Required for sitemap.xml/robots.txt generation. */
  siteUrl?: string;
  /**
   * `false` disables sitemap.xml generation even when `siteUrl` is set.
   * `extraUrls` adds root-relative paths the build can't discover on its
   * own (e.g. dynamic routes whose params come from a database) -- a static
   * list, or a function so they can be fetched at build time.
   */
  sitemap?: boolean | { extraUrls?: string[] | (() => Promise<string[]>) };
  /** Custom robots.txt content. `false` disables generating one entirely. */
  robots?: string | false;
}
