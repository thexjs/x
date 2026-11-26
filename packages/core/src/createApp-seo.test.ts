import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./createApp";

/**
 * Per-page SEO (`seo`/`generateSeo` exports) through the real request
 * pipeline -- not just the pure `buildSeoHeadTags` unit tests in seo.test.ts
 * or the static-build path in seo-build.test.ts. `generateSeo` specifically
 * needs a live `loader` result to prove a dynamic route can title itself
 * from the data it loaded, which a static `seo` object can't do.
 */
const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/createApp-seo");
const PAGES_DIR = join(FIXTURE_DIR, "pages");

function touch(relPath: string, content: string) {
  const full = join(PAGES_DIR, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeAll(() => {
  touch(
    "index.tsx",
    `export const mode = "static";
export const seo = {
  title: "Welcome",
  description: "The home page.",
};
export default function Home() {
  return <h1>Home</h1>;
}
`,
  );
  touch(
    "plain.tsx",
    `export const mode = "server";
export default function Plain() {
  return <h1>No SEO here</h1>;
}
`,
  );
  touch(
    "blog/[slug].tsx",
    `export const mode = "server";
const POSTS = {
  "hello-world": { title: "Hello World", summary: "The first post." },
};
export async function loader({ params }) {
  return { post: POSTS[params.slug] };
}
export function generateSeo({ loaderData }) {
  const post = loaderData.post;
  if (!post) return { robots: "noindex" };
  return {
    title: \`\${post.title} — Blog\`,
    description: post.summary,
    openGraph: { type: "article" },
  };
}
export default function BlogPost({ loaderData }) {
  return <h1>{loaderData.post?.title ?? "Not found"}</h1>;
}
`,
  );
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe("createApp: per-page SEO through the real request pipeline", () => {
  test("a static page's seo export lands in the response HTML", async () => {
    const app = await createApp({ pagesDir: PAGES_DIR, development: false });
    const res = await app.fetch(new Request("http://localhost/"));
    const html = await res.text();
    expect(html).toContain("<title>Welcome</title>");
    expect(html).toContain('<meta name="description" content="The home page." />');
  });

  test("a page with no seo export renders exactly as before -- fallback title, no extra tags", async () => {
    const app = await createApp({ pagesDir: PAGES_DIR, development: false });
    const res = await app.fetch(new Request("http://localhost/plain"));
    const html = await res.text();
    expect(html).toContain("<title>x app</title>");
    expect(html).not.toContain('<meta name="description"');
  });

  test("generateSeo titles a dynamic route from the data its own loader fetched", async () => {
    const app = await createApp({ pagesDir: PAGES_DIR, development: false });
    const res = await app.fetch(new Request("http://localhost/blog/hello-world"));
    const html = await res.text();
    expect(html).toContain("<title>Hello World — Blog</title>");
    expect(html).toContain('<meta name="description" content="The first post." />');
    expect(html).toContain('<meta property="og:type" content="article" />');
  });

  test("generateSeo can react to a loader miss (e.g. noindex an unknown slug) just like the page component does", async () => {
    const app = await createApp({ pagesDir: PAGES_DIR, development: false });
    const res = await app.fetch(new Request("http://localhost/blog/does-not-exist"));
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex" />');
  });
});
