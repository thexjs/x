import { describe, expect, test } from "bun:test";
import { buildSeoHeadTags, generateRobotsTxt, generateSitemapXml } from "./seo";

describe("buildSeoHeadTags", () => {
  test("empty/undefined seo emits nothing", () => {
    expect(buildSeoHeadTags(undefined)).toBe("");
    expect(buildSeoHeadTags({})).toBe("");
  });

  test("description, canonical, and robots each emit their own tag only when set", () => {
    const html = buildSeoHeadTags({
      description: "A page about things.",
      canonical: "https://example.com/things",
      robots: "noindex, nofollow",
    });
    expect(html).toContain('<meta name="description" content="A page about things." />');
    expect(html).toContain('<link rel="canonical" href="https://example.com/things" />');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  test("HTML-sensitive characters are escaped in attribute values", () => {
    const html = buildSeoHeadTags({ description: `"quoted" & <tagged>` });
    expect(html).toContain("&quot;quoted&quot; &amp; &lt;tagged&gt;");
    expect(html).not.toContain('"quoted"');
  });

  test("openGraph falls back to the page's title/description/canonical when its own fields are unset", () => {
    const html = buildSeoHeadTags({
      title: "Page Title",
      description: "Page description.",
      canonical: "https://example.com/page",
      openGraph: {},
    });
    expect(html).toContain('<meta property="og:title" content="Page Title" />');
    expect(html).toContain('<meta property="og:description" content="Page description." />');
    expect(html).toContain('<meta property="og:url" content="https://example.com/page" />');
    expect(html).toContain('<meta property="og:type" content="website" />');
  });

  test("openGraph's own fields win over the page-level fallback", () => {
    const html = buildSeoHeadTags({
      title: "Page Title",
      openGraph: { title: "OG-specific title", type: "article" },
    });
    expect(html).toContain('<meta property="og:title" content="OG-specific title" />');
    expect(html).not.toContain('content="Page Title"');
    expect(html).toContain('<meta property="og:type" content="article" />');
  });

  test("no twitter card is emitted unless there's actual twitter/OG content to show", () => {
    expect(buildSeoHeadTags({ title: "Just a title" })).not.toContain("twitter:card");
  });

  test("twitter card defaults to summary_large_image when an image is present, summary otherwise", () => {
    const withImage = buildSeoHeadTags({ twitter: { title: "T", image: "/og.png" } });
    expect(withImage).toContain('<meta name="twitter:card" content="summary_large_image" />');

    const withoutImage = buildSeoHeadTags({ twitter: { title: "T" } });
    expect(withoutImage).toContain('<meta name="twitter:card" content="summary" />');
  });

  test("twitter image falls back to openGraph's image", () => {
    const html = buildSeoHeadTags({
      openGraph: { image: "/shared.png" },
      twitter: { title: "T" },
    });
    expect(html).toContain('<meta name="twitter:image" content="/shared.png" />');
  });

  test("jsonLd renders a single object as one script tag", () => {
    const html = buildSeoHeadTags({
      jsonLd: { "@context": "https://schema.org", "@type": "Article", headline: "Hi" },
    });
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"Article"');
  });

  test("jsonLd renders an array of objects in one script tag", () => {
    const html = buildSeoHeadTags({
      jsonLd: [{ "@type": "Article" }, { "@type": "BreadcrumbList" }],
    });
    const match = html.match(/<script type="application\/ld\+json">(.*)<\/script>/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match?.[1] ?? "[]");
    expect(parsed).toHaveLength(2);
  });

  test("jsonLd escapes a closing </script> sequence embedded in string values", () => {
    const html = buildSeoHeadTags({
      jsonLd: { description: "</script><script>alert(1)</script>" },
    });
    expect(html).not.toContain("</script><script>alert(1)</script>");
    expect(html).toContain("<\\/script>");
  });
});

describe("generateSitemapXml", () => {
  test("emits one <url> per entry with an absolute <loc>", () => {
    const xml = generateSitemapXml(
      [{ routePath: "/about" }, { routePath: "/blog/hello" }],
      "https://example.com",
    );
    expect(xml).toContain("<loc>https://example.com/about</loc>");
    expect(xml).toContain("<loc>https://example.com/blog/hello</loc>");
  });

  test("the root route resolves to the bare site URL, not a trailing slash", () => {
    const xml = generateSitemapXml([{ routePath: "/" }], "https://example.com");
    expect(xml).toContain("<loc>https://example.com</loc>");
    expect(xml).not.toContain("<loc>https://example.com/</loc>");
  });

  test("lastModified becomes a <lastmod> date, omitted when unset", () => {
    const withDate = generateSitemapXml(
      [{ routePath: "/about", lastModified: new Date("2026-01-15T00:00:00Z") }],
      "https://example.com",
    );
    expect(withDate).toContain("<lastmod>2026-01-15</lastmod>");

    const withoutDate = generateSitemapXml([{ routePath: "/about" }], "https://example.com");
    expect(withoutDate).not.toContain("<lastmod>");
  });

  test("is well-formed XML with the sitemap namespace", () => {
    const xml = generateSitemapXml([{ routePath: "/" }], "https://example.com");
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  });
});

describe("generateRobotsTxt", () => {
  test("defaults to allow-everything with no Sitemap directive when siteUrl is unset", () => {
    const txt = generateRobotsTxt({});
    expect(txt).toContain("User-agent: *");
    expect(txt).toContain("Disallow:");
    expect(txt).not.toContain("Sitemap:");
  });

  test("adds a Sitemap directive pointing at sitemap.xml when siteUrl is set", () => {
    const txt = generateRobotsTxt({ siteUrl: "https://example.com" });
    expect(txt).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  test("disallow paths replace the default blanket allow", () => {
    const txt = generateRobotsTxt({ disallow: ["/admin", "/internal"] });
    expect(txt).toContain("Disallow: /admin");
    expect(txt).toContain("Disallow: /internal");
    expect(txt).not.toContain("Disallow:\n");
  });
});
