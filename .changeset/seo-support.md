---
"@thexjs/core": minor
"@thexjs/cli": patch
---

Add built-in SEO support. Every page previously rendered `<title>x app</title>` with no description, Open Graph, Twitter card, canonical, or structured-data tags unless an app hand-built this itself — every example app included.

- Pages can now export `seo` (a static `SeoData` object) or `generateSeo({ params, loaderData })` (computed per-request, so a dynamic route like `/blog/[slug]` can title itself from the data its own `loader` fetched) for description, canonical, `robots`, Open Graph, Twitter card, and JSON-LD.
- `x.config.ts` gets a `seo` option (`siteUrl`, `sitemap`, `robots`) consumed by `x build`: static-mode pages and content-collection entries (both enumerable at build time) are written into `sitemap.xml` automatically, plus a `robots.txt` with a `Sitemap:` directive. `seo.sitemap.extraUrls` adds routes the build can't enumerate on its own (e.g. a dynamic route backed by a database). `mode: "server"` routes with dynamic params are excluded from the sitemap by default since there's no way to enumerate their possible values at build time.
- Content-collection entries map their frontmatter `description` field into the page's meta description automatically.
- The 404 page now ships `robots: noindex`.

Fully additive: a page with no `seo`/`generateSeo` export renders exactly as before.
