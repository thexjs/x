import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "./build";

/**
 * build()'s SEO output: per-page <head> tags baked into the static HTML,
 * and sitemap.xml/robots.txt generated from everything the build can see
 * statically (static-mode pages, content-collection entries) plus whatever
 * seo.sitemap.extraUrls supplies for routes it can't enumerate on its own.
 */
const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/seo-build");
const ROUTES_DIR = join(FIXTURE_DIR, "src/routes");
const CONTENT_DIR = join(FIXTURE_DIR, "content");
const OUT_DIR = join(FIXTURE_DIR, "dist");

function touch(dir: string, relPath: string, content: string) {
  const full = join(dir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeAll(() => {
  touch(
    ROUTES_DIR,
    "index.tsx",
    `export const mode = 'static';
export const seo = {
  title: "Home — Example",
  description: "The home page.",
  openGraph: { image: "/home-og.png" },
};
export default function Home() {
  return <h1>Home</h1>;
}
`,
  );
  touch(
    ROUTES_DIR,
    "about.tsx",
    `export const mode = 'server';
export default function About() {
  return <h1>About</h1>;
}
`,
  );
  touch(
    ROUTES_DIR,
    "products/[id].tsx",
    `export const mode = 'server';
export default function Product() {
  return <h1>Product</h1>;
}
`,
  );
  touch(
    CONTENT_DIR,
    "blog/hello.md",
    `---
title: Hello Blog
description: An introductory post.
---

This is a blog post.
`,
  );
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe("build(): per-page SEO head tags", () => {
  test("a static page's seo export lands in the rendered <head>", async () => {
    await build({
      routesDir: ROUTES_DIR,
      outDir: OUT_DIR,
      seo: { siteUrl: "https://example.com" },
    });
    const html = readFileSync(join(OUT_DIR, "client/index.html"), "utf-8");
    expect(html).toContain("<title>Home — Example</title>");
    expect(html).toContain('<meta name="description" content="The home page." />');
    expect(html).toContain('<meta property="og:image" content="/home-og.png" />');
  });

  test("a content entry's frontmatter description becomes its meta description", async () => {
    await build({
      routesDir: ROUTES_DIR,
      contentDir: CONTENT_DIR,
      outDir: OUT_DIR,
      seo: { siteUrl: "https://example.com" },
    });
    const html = readFileSync(join(OUT_DIR, "client/blog/hello/index.html"), "utf-8");
    expect(html).toContain('<meta name="description" content="An introductory post." />');
  });
});

describe("build(): sitemap.xml and robots.txt", () => {
  test("includes static pages and content entries, excludes server-mode dynamic routes", async () => {
    await build({
      routesDir: ROUTES_DIR,
      contentDir: CONTENT_DIR,
      outDir: OUT_DIR,
      seo: { siteUrl: "https://example.com" },
    });
    const xml = readFileSync(join(OUT_DIR, "client/sitemap.xml"), "utf-8");
    expect(xml).toContain("<loc>https://example.com</loc>");
    expect(xml).toContain("<loc>https://example.com/blog/hello</loc>");
    // "server" mode: /about and the dynamic /products/[id] can't be
    // enumerated at build time and must not appear automatically.
    expect(xml).not.toContain("/about");
    expect(xml).not.toContain("/products");
  });

  test("extraUrls adds routes the build can't discover on its own, as a static list or an async function", async () => {
    await build({
      routesDir: ROUTES_DIR,
      outDir: OUT_DIR,
      seo: {
        siteUrl: "https://example.com",
        sitemap: { extraUrls: () => Promise.resolve(["/products/1", "/products/2"]) },
      },
    });
    const xml = readFileSync(join(OUT_DIR, "client/sitemap.xml"), "utf-8");
    expect(xml).toContain("<loc>https://example.com/products/1</loc>");
    expect(xml).toContain("<loc>https://example.com/products/2</loc>");
  });

  test("no siteUrl means no sitemap.xml, but robots.txt is still written", async () => {
    rmSync(join(OUT_DIR, "client/sitemap.xml"), { force: true });
    await build({ routesDir: ROUTES_DIR, outDir: OUT_DIR });
    expect(existsSync(join(OUT_DIR, "client/sitemap.xml"))).toBe(false);
    const robots = readFileSync(join(OUT_DIR, "client/robots.txt"), "utf-8");
    expect(robots).toContain("User-agent: *");
    expect(robots).not.toContain("Sitemap:");
  });

  test("seo.robots: false disables robots.txt generation entirely", async () => {
    rmSync(join(OUT_DIR, "client/robots.txt"), { force: true });
    await build({ routesDir: ROUTES_DIR, outDir: OUT_DIR, seo: { robots: false } });
    expect(existsSync(join(OUT_DIR, "client/robots.txt"))).toBe(false);
  });

  test("seo.sitemap: false disables sitemap.xml even when siteUrl is set", async () => {
    rmSync(join(OUT_DIR, "client/sitemap.xml"), { force: true });
    await build({
      routesDir: ROUTES_DIR,
      outDir: OUT_DIR,
      seo: { siteUrl: "https://example.com", sitemap: false },
    });
    expect(existsSync(join(OUT_DIR, "client/sitemap.xml"))).toBe(false);
  });

  test("a custom robots string is written verbatim instead of the generated default", async () => {
    await build({
      routesDir: ROUTES_DIR,
      outDir: OUT_DIR,
      seo: { robots: "User-agent: *\nDisallow: /\n" },
    });
    const robots = readFileSync(join(OUT_DIR, "client/robots.txt"), "utf-8");
    expect(robots).toBe("User-agent: *\nDisallow: /\n");
  });
});
