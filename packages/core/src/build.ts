import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { type ComponentType, createElement, type ReactNode } from "react";
import { type ContentEntry, renderMarkdown, scanContent } from "./content";
import { createIslandRegistry, IslandProvider } from "./island";
import { bundleRouteIslandsToDisk } from "./island-bundle";
import { renderStaticPage } from "./render";
import {
  findLayoutChain,
  type RouteEntry,
  scanApiDir,
  scanLayouts,
  scanLayoutsDir,
  scanPages,
  scanRoutes,
} from "./router";
import {
  type GenerateSeo,
  generateRobotsTxt,
  generateSitemapXml,
  type SeoConfig,
  type SeoData,
  type SitemapEntry,
} from "./seo";

import { registerServerFunctions } from "./server-functions";

export type RouteMode = "static" | "server";

export interface BuildOptions {
  routesDir?: string;
  pagesDir?: string;
  apiDir?: string;
  layoutsDir?: string;
  actionsDir?: string;
  contentDir?: string;
  outDir?: string;
  /**
   * Absolute path to the project's x.config.ts/js/mjs, if any. When set, the
   * generated production server entry re-imports it at startup and forwards
   * its runtime `security`/`observability`/`images`/`backpressure` fields into
   * `createApp()` — those fields can hold live values (rate-limit key
   * functions, error reporters, health checks) that can't be serialized into
   * the generated file directly.
   */
  configPath?: string;
  /** sitemap.xml/robots.txt generation. See `SeoConfig` in `./seo`. */
  seo?: SeoConfig;
}

interface LoadedPage {
  entry: RouteEntry;
  mode: RouteMode;
  filePath: string;
  seo: SeoData | undefined;
  generateSeo: GenerateSeo | undefined;
  Component: ComponentType<{ params: Record<string, string> }>;
  layoutModules: ComponentType<{ children: ReactNode }>[];
  layoutFilePaths: string[];
}

export async function build(options: BuildOptions): Promise<void> {
  const outDir = options.outDir ?? join(process.cwd(), ".x");
  const clientDir = join(outDir, "client");
  const serverDir = join(outDir, "server");
  const islandsDir = join(clientDir, "_islands");

  mkdirSync(clientDir, { recursive: true });
  mkdirSync(serverDir, { recursive: true });
  mkdirSync(islandsDir, { recursive: true });

  const pagesDir = options.pagesDir ?? options.routesDir ?? "";
  const apiDir = options.apiDir;
  const actionsDir = options.actionsDir;
  const layoutsDir = options.layoutsDir ?? pagesDir;

  // Resolve public/ the same way the dev server does (createApp.ts),
  // so static builds ship the same stylesheet/assets dev mode serves.
  const projectRoot = pagesDir ? join(pagesDir, "..", "..") : process.cwd();
  const publicDir = join(projectRoot, "public");
  const hasPublicDir = existsSync(publicDir);
  const stylesheetHref =
    hasPublicDir && existsSync(join(publicDir, "styles.css")) ? "/styles.css" : undefined;

  if (hasPublicDir) {
    cpSync(publicDir, clientDir, { recursive: true });
    console.log(`[x] build: copied public/ -> ${relative(process.cwd(), clientDir)}`);
  }

  let routeEntries: RouteEntry[] = [];
  if (pagesDir && existsSync(pagesDir)) {
    routeEntries = scanPages(pagesDir);
  }
  if (apiDir && existsSync(apiDir)) {
    routeEntries.push(...scanApiDir(apiDir));
  }
  const legacyApiDir = pagesDir ? join(pagesDir, "api") : "";
  if (legacyApiDir && existsSync(legacyApiDir) && legacyApiDir !== apiDir) {
    routeEntries.push(...scanApiDir(legacyApiDir));
  }

  // Scan actions. Every action file is registered server-side (below) AND
  // recorded in `actionModules`, keyed by its absolute file path. The island
  // bundler uses that map to intercept any client-side import of an action
  // file and swap it for a generated fetch() client instead — so a component
  // can `import { subscribeUser } from "../actions/subscribe"` and call it
  // directly, without the real (db-touching) implementation ever reaching
  // the browser bundle.
  const actionModules = new Map<string, { parentPath: string; fnNames: string[] }>();
  if (actionsDir && existsSync(actionsDir)) {
    for (const actionFile of scanRoutes(actionsDir)) {
      const mod = (await import(actionFile.filePath)) as Record<string, unknown>;
      const segments = actionFile.routePath.split("/").filter(Boolean);
      const parentPath = `/${segments.slice(0, -1).join("/")}`;
      const fnNames: string[] = [];

      const actions = mod.actions as
        | Record<string, (...args: unknown[]) => Promise<unknown>>
        | undefined;
      if (actions) {
        registerServerFunctions(parentPath, actionFile.paramNames, actions);
        fnNames.push(...Object.keys(actions));
      }
      for (const [key, value] of Object.entries(mod)) {
        if (key === "default" || key === "actions" || typeof value !== "function") continue;
        registerServerFunctions(parentPath, actionFile.paramNames, {
          [key]: value as (...args: unknown[]) => Promise<unknown>,
        });
        fnNames.push(key);
      }

      if (fnNames.length > 0) {
        actionModules.set(actionFile.filePath, { parentPath, fnNames });
      }
    }
  }

  // Layouts: dedicated dir + nested _layout.tsx
  const dedicatedLayouts =
    layoutsDir && layoutsDir !== pagesDir && existsSync(layoutsDir)
      ? scanLayoutsDir(layoutsDir)
      : [];
  const nestedLayouts = pagesDir && existsSync(pagesDir) ? scanLayouts(pagesDir) : [];
  const layouts = [...dedicatedLayouts, ...nestedLayouts];

  const staticPages: LoadedPage[] = [];
  const serverPages: LoadedPage[] = [];
  const apiRoutes: RouteEntry[] = [];

  for (const entry of routeEntries) {
    if (entry.isApi) {
      apiRoutes.push(entry);
      continue;
    }

    const mod = (await import(entry.filePath)) as {
      default?: ComponentType<{ params: Record<string, string> }>;
      mode?: RouteMode;
      seo?: SeoData;
      generateSeo?: GenerateSeo;
    };
    const Component = mod.default;
    if (!Component) {
      console.warn(`[x] ${entry.filePath} has no default export -- skipping`);
      continue;
    }

    const mode = mod.mode ?? "server";
    const layoutChain = findLayoutChain(entry.filePath, layouts, pagesDir);
    for (const rootLayout of dedicatedLayouts) {
      if (!layoutChain.some((l) => l.filePath === rootLayout.filePath)) {
        layoutChain.unshift(rootLayout);
      }
    }
    const layoutModules: ComponentType<{ children: ReactNode }>[] = [];
    for (const l of layoutChain) {
      const layoutMod = (await import(l.filePath)) as {
        default?: ComponentType<{ children: ReactNode }>;
      };
      if (layoutMod.default) layoutModules.push(layoutMod.default);
    }

    const page: LoadedPage = {
      entry,
      filePath: entry.filePath,
      mode,
      seo: mod.seo,
      generateSeo: mod.generateSeo,
      Component,
      layoutModules,
      layoutFilePaths: layoutChain.map((l) => l.filePath),
    };

    if (mode === "static") {
      staticPages.push(page);
    } else {
      serverPages.push(page);
    }
  }

  let contentEntries: ContentEntry[] = [];
  if (options.contentDir) {
    contentEntries = scanContent(options.contentDir);
  }

  console.log(
    `[x] build: ${staticPages.length} static, ${serverPages.length} server, ${contentEntries.length} content pages`,
  );

  const writtenPaths = new Set<string>();

  const sitemapEntries: SitemapEntry[] = [];

  for (const page of staticPages) {
    const params: Record<string, string> = {};
    const seo = page.generateSeo ? await page.generateSeo({ params, loaderData: {} }) : page.seo;
    const registry = createIslandRegistry();
    const pageContent = renderPageWithLayout(page.Component, params, page.layoutModules);
    const content = createElement(IslandProvider, { registry }, pageContent);
    const _html = renderStaticPage(content, { seo, stylesheet: stylesheetHref });

    const outPath =
      page.entry.routePath === "/" ? "/index.html" : `${page.entry.routePath}/index.html`;
    const fullPath = join(clientDir, outPath);
    mkdirSync(join(fullPath, ".."), { recursive: true });

    if (writtenPaths.has(outPath)) {
      console.warn(`  [warn] collision: ${page.entry.routePath} overwrites existing output`);
    }
    writtenPaths.add(outPath);

    let islandScripts: string[] = [];
    if (registry.entries.length > 0) {
      const uniqueNames = [...new Set(registry.entries.map((e) => e.name))];
      islandScripts = await bundleRouteIslandsToDisk(
        page.filePath,
        page.layoutFilePaths,
        uniqueNames,
        islandsDir,
        actionModules,
      );
      console.log(
        `  [islands] ${uniqueNames.length} island(s) on ${page.entry.routePath} -> ${islandScripts.join(", ")}`,
      );
    }

    const finalHtml = renderStaticPage(content, {
      seo,
      islandScripts,
      stylesheet: stylesheetHref,
    });
    writeFileSync(fullPath, finalHtml, "utf-8");
    console.log(`  [static] ${page.entry.routePath} -> ${outPath}`);
    sitemapEntries.push({ routePath: page.entry.routePath });
  }

  for (const content of contentEntries) {
    const registry = createIslandRegistry();
    const bodyHtml = renderMarkdown(content.body);
    const pageContent = createElement(StaticContentPage, {
      content,
      bodyHtml,
    });
    const rendered = createElement(IslandProvider, { registry }, pageContent);
    const title = (content.frontmatter.title as string) ?? content.slug;
    const html = renderStaticPage(rendered, {
      title,
      seo: { title, description: content.frontmatter.description as string | undefined },
      stylesheet: stylesheetHref,
    });

    const outPath = content.routePath === "/" ? "/index.html" : `${content.routePath}/index.html`;
    const fullPath = join(clientDir, outPath);
    mkdirSync(join(fullPath, ".."), { recursive: true });

    if (writtenPaths.has(outPath)) {
      console.warn(`  [warn] collision: content ${content.routePath} overwrites existing output`);
    }
    writtenPaths.add(outPath);
    sitemapEntries.push({ routePath: content.routePath });

    writeFileSync(fullPath, html, "utf-8");
    console.log(`  [content] ${content.routePath} -> ${outPath}`);
  }

  if (pagesDir || options.routesDir || options.contentDir) {
    const srvOpts: Record<string, string | undefined> = {
      pagesDir: pagesDir || options.routesDir || "",
    };
    if (options.apiDir) srvOpts.apiDir = options.apiDir;
    if (options.layoutsDir) srvOpts.layoutsDir = options.layoutsDir;
    if (options.actionsDir) srvOpts.actionsDir = options.actionsDir;
    if (options.contentDir) srvOpts.contentDir = options.contentDir;

    const configImportPath = options.configPath
      ? relativeImportPath(serverDir, options.configPath)
      : undefined;

    const serverEntry = buildServerEntry(
      srvOpts as {
        pagesDir: string;
        apiDir?: string;
        layoutsDir?: string;
        actionsDir?: string;
        contentDir?: string;
      },
      configImportPath,
      stylesheetHref,
    );
    const serverEntryPath = join(serverDir, "index.ts");
    writeFileSync(serverEntryPath, serverEntry, "utf-8");
    console.log(
      `  [server] ${serverPages.length} page routes, ${apiRoutes.length} api routes -> server/index.ts`,
    );
  }

  // robots.txt/sitemap.xml cover what the build can see statically: static
  // pages and content-collection entries, both enumerable here, plus
  // whatever `seo.sitemap.extraUrls` supplies. `mode: "server"` routes with
  // dynamic params (e.g. `/blog/[slug].tsx` backed by a database rather than
  // a content collection) are not enumerable at build time and are not
  // included automatically -- extraUrls is the escape hatch for those.
  if (options.seo?.robots !== false) {
    const robotsTxt =
      typeof options.seo?.robots === "string"
        ? options.seo.robots
        : generateRobotsTxt({ siteUrl: options.seo?.siteUrl });
    writeFileSync(join(clientDir, "robots.txt"), robotsTxt, "utf-8");
    console.log("  [seo] robots.txt");
  }

  const sitemapConfig = options.seo?.sitemap;
  if (options.seo?.siteUrl && sitemapConfig !== false) {
    const extraUrlsConfig = typeof sitemapConfig === "object" ? sitemapConfig.extraUrls : undefined;
    const extraUrls =
      typeof extraUrlsConfig === "function" ? await extraUrlsConfig() : (extraUrlsConfig ?? []);
    const allEntries: SitemapEntry[] = [
      ...sitemapEntries,
      ...extraUrls.map((routePath) => ({ routePath })),
    ];
    const siteUrl = options.seo.siteUrl.replace(/\/$/, "");
    writeFileSync(join(clientDir, "sitemap.xml"), generateSitemapXml(allEntries, siteUrl), "utf-8");
    console.log(`  [seo] sitemap.xml (${allEntries.length} urls)`);
  }

  console.log(`[x] build complete -> ${outDir}`);
}

function renderPageWithLayout(
  Component: ComponentType<{ params: Record<string, string> }>,
  params: Record<string, string>,
  layoutModules: ComponentType<{ children: ReactNode }>[],
): ReactNode {
  let content: ReactNode = createElement(Component, { params });
  // layoutModules is ordered outermost-first (root layout first). Wrapping
  // sequentially would leave the last layout outermost (inverted nesting),
  // so wrap in reverse -- matching createApp's wrapWithLayouts.
  for (const Layout of [...layoutModules].reverse()) {
    content = createElement(Layout, null, content);
  }
  return content;
}

function StaticContentPage({ content, bodyHtml }: { content: ContentEntry; bodyHtml: string }) {
  return createElement(
    "article",
    null,
    content.frontmatter.title
      ? createElement("h1", null, content.frontmatter.title as string)
      : null,
    createElement("div", {
      // biome-ignore lint/security/noDangerouslySetInnerHtml: body is markdown rendered to HTML
      dangerouslySetInnerHTML: { __html: bodyHtml },
    }),
  );
}

function buildServerEntry(
  opts: Record<string, string>,
  configImportPath?: string,
  stylesheetHref?: string,
): string {
  const dirKeys = ["pagesDir", "apiDir", "layoutsDir", "actionsDir", "contentDir"];
  const lines = [
    "// Auto-generated by @thexjs/core build",
    'import { createApp } from "@thexjs/core";',
  ];

  if (configImportPath) {
    lines.push("", "let userConfig = {};", "try {");
    lines.push(`  const mod = await import(${JSON.stringify(configImportPath)});`);
    lines.push("  userConfig = mod.default ?? {};");
    lines.push("} catch (err) {");
    lines.push('  console.warn("[x] failed to load x.config runtime options:", err);');
    lines.push("}");
  }

  lines.push("", "const app = await createApp({");
  for (const key of dirKeys) {
    const val = opts[key];
    if (val) lines.push(`  ${key}: ${JSON.stringify(val)},`);
  }
  if (stylesheetHref) lines.push(`  stylesheetHref: ${JSON.stringify(stylesheetHref)},`);
  lines.push('  port: parseInt(process.env.PORT || "3000", 10),', "  development: false,");
  if (configImportPath) {
    // Runtime options can hold live values (rate-limit key functions, error
    // reporters, health checks), so these come from the user's own config
    // module at runtime rather than being inlined as JSON above.
    lines.push("  ...(userConfig.security ? { security: userConfig.security } : {}),");
    lines.push(
      "  ...(userConfig.observability ? { observability: userConfig.observability } : {}),",
    );
    lines.push("  ...(userConfig.images ? { images: userConfig.images } : {}),");
    lines.push(
      "  ...(userConfig.backpressure !== undefined ? { backpressure: userConfig.backpressure } : {}),",
    );
  }
  lines.push(
    "});",
    "",
    "const server = Bun.serve(app);",
    "",
    "console.log(`[x] production server running at " +
      // biome-ignore lint/suspicious/noTemplateCurlyInString: emitted code uses a runtime template literal
      "${server.url}`);",
    "",
    "// Graceful shutdown: stop accepting new connections, flush the error",
    "// reporter, then exit after in-flight requests have a moment to drain.",
    "let shuttingDown = false;",
    "async function shutdown(signal: string): Promise<void> {",
    "  if (shuttingDown) return;",
    "  shuttingDown = true;",
    "  console.log(`[x] received " +
      // biome-ignore lint/suspicious/noTemplateCurlyInString: emitted code uses a runtime template literal
      "${signal} - shutting down`);",
    "  try {",
    '    const { getErrorReporter } = await import("@thexjs/core");',
    "    await getErrorReporter().flush?.();",
    "  } catch {}",
    "  server.stop(true);",
    "  const exit = () => process.exit(0);",
    "  const drainTimer = setTimeout(exit, 3000);",
    "  drainTimer.unref?.();",
    "}",
    'process.on("SIGTERM", () => shutdown("SIGTERM"));',
    'process.on("SIGINT", () => shutdown("SIGINT"));',
    "",
    "// Request-level errors are caught inside createApp's fetch boundary;",
    "// anything that still escapes (a throw outside the request lifecycle,",
    "// a rejected promise from a background sweep) is reported through the",
    "// error reporter so the box reports instead of dying silently.",
    'const { installProcessCrashHandlers } = await import("@thexjs/core");',
    // Fail fast on an uncaughtException: the singleton state may be corrupted,
    // so drain and let the orchestrator restart clean (see crash-handlers).
    "installProcessCrashHandlers({ exitOnCrash: true });",
  );
  return lines.join("\n");
}

/** Relative import specifier from `fromDir` to `toFile`, POSIX-separated and extensionless. */
function relativeImportPath(fromDir: string, toFile: string): string {
  const rel = relative(fromDir, toFile)
    .replace(/\\/g, "/")
    .replace(/\.(ts|js|mjs)$/, "");
  return rel.startsWith(".") ? rel : `./${rel}`;
}
