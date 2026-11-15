import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { join } from "node:path";
import { generateEntrySource } from "./generate-entry";
import { buildNodeOutput } from "./index";
import type { BuildManifest } from "./types";
import { copyStaticAssets } from "./write-output";

/**
 * Mirrors @thexjs/adapter-vercel's test suite: unit tests for the generated
 * entry source (string assertions on things that must always be true of the
 * emitted JS), eval-based tests that pull a function out of the generated
 * source and run it for real against a real socket/filesystem, and one
 * end-to-end integration test that builds a real fixture app and actually
 * starts the generated server, hitting it with real HTTP requests.
 */

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/adapter");
const PAGES_DIR = join(FIXTURE_DIR, "src/pages");
const API_DIR = join(FIXTURE_DIR, "src/api");
const PUBLIC_DIR = join(FIXTURE_DIR, "public");
const OUTPUT_DIR = join(FIXTURE_DIR, "dist-node");

function touch(dir: string, relPath: string, content: string) {
  const full = join(dir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

function unitManifest(overrides: Partial<BuildManifest> = {}): BuildManifest {
  return {
    projectRoot: "/fixture",
    pagesDirLabel: "src/pages",
    routes: [
      {
        routePath: "/about",
        paramNames: [],
        isApi: false,
        mode: "server",
        route: {
          sourcePath: "/fixture/about.tsx",
          compiledPath: "/fixture/compiled/about.mjs",
          identifier: "route_about",
        },
        layoutChain: [],
        middlewareChain: [],
      },
    ],
    actions: [],
    hasServerSurface: true,
    ...overrides,
  };
}

describe("copyStaticAssets", () => {
  const clientDir = join(FIXTURE_DIR, "__unit-client");
  const out = join(FIXTURE_DIR, "__unit-out");

  beforeAll(() => {
    touch(clientDir, "index.html", "<h1>static</h1>");
  });
  afterAll(() => {
    rmSync(clientDir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  test("copies the client build output into static/", () => {
    copyStaticAssets(out, clientDir);
    expect(readFileSync(join(out, "static", "index.html"), "utf-8")).toContain("<h1>static</h1>");
  });
});

describe("generateEntrySource", () => {
  const entryOpts = { trustProxy: false, port: 3000 };

  test("bakes the stylesheetHref into the createApp call", () => {
    const src = generateEntrySource(
      unitManifest({ stylesheetHref: "/styles.css" }),
      "/tmp/e",
      entryOpts,
    );
    expect(src).toContain('stylesheetHref: "/styles.css"');
  });

  test("emits preloaded routes with no dynamic import(path) anywhere", () => {
    const src = generateEntrySource(unitManifest(), "/tmp/e", entryOpts);
    expect(src).toContain("__x_preloadedRoutes");
    expect(src).toContain('"routePath":"/about"');
    expect(src).toContain("module: route_about");
    expect(src).not.toContain("import(");
  });

  test("bakes trustProxy: false by default -- no configureTrustedProxy call", () => {
    const src = generateEntrySource(unitManifest(), "/tmp/e", entryOpts);
    expect(src).toContain("const __x_trustProxy = false;");
    expect(src).toContain("if (__x_trustProxy) configureTrustedProxy(");
  });

  test("bakes trustProxy: true when explicitly opted in", () => {
    const src = generateEntrySource(unitManifest(), "/tmp/e", { trustProxy: true, port: 3000 });
    expect(src).toContain("const __x_trustProxy = true;");
  });

  test("bakes the configured default port, overridable by $PORT at runtime", () => {
    const src = generateEntrySource(unitManifest(), "/tmp/e", { trustProxy: false, port: 4321 });
    expect(src).toContain('process.env.PORT || "4321"');
  });

  test("starts an http server and serves static files before falling through to the app", () => {
    const src = generateEntrySource(unitManifest(), "/tmp/e", entryOpts);
    expect(src).toContain("createServer(async (req, res)");
    expect(src).toContain("resolveStaticFile(url.pathname)");
    expect(src).toContain("__x_server.listen(__x_port");
  });

  test("validates forwarded headers instead of trusting them blindly", () => {
    const src = generateEntrySource(unitManifest(), "/tmp/e", { trustProxy: true, port: 3000 });
    expect(src).toContain("/^[a-zA-Z0-9._\\-:]+$/.test(single)");
    expect(src).toContain('single.includes(",")');
  });

  test("does not write a 500 after headers have already been sent", () => {
    const src = generateEntrySource(unitManifest(), "/tmp/e", entryOpts);
    expect(src).toContain("if (res.headersSent)");
    expect(src).toContain("res.destroy");
  });
});

describe("generated bridge functions (eval'd from the real generated source, exercised for real)", () => {
  function extractFunction(src: string, marker: string): string {
    const startIdx = src.indexOf(marker);
    if (startIdx === -1) throw new Error(`${marker} not found in generated entry`);
    const open = src.indexOf("{", startIdx);
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end === -1) throw new Error(`could not find end of ${marker}`);
    return src.slice(startIdx, end);
  }

  test("resolveStaticFile resolves an index.html fallback and refuses to escape the static root", () => {
    const staticDir = join(FIXTURE_DIR, "__eval-static");
    touch(staticDir, "about/index.html", "<h1>about</h1>");
    touch(staticDir, "styles.css", "body{}");

    const src = generateEntrySource(unitManifest(), "/tmp/e", { trustProxy: false, port: 3000 });
    const stripSlashesFn = extractFunction(src, "function stripSlashes(value)");
    const resolveFn = extractFunction(src, "function resolveStaticFile(pathname)");
    const compile = new Function(
      "existsSync",
      "statSync",
      "join",
      "normalize",
      "sep",
      "__x_staticDir",
      `${stripSlashesFn}\n${resolveFn}\nreturn resolveStaticFile;`,
    );
    const { existsSync, statSync } = require("node:fs") as typeof import("node:fs");
    const { join: nodeJoin, normalize, sep } = require("node:path") as typeof import("node:path");
    const resolveStaticFile = compile(
      existsSync,
      statSync,
      nodeJoin,
      normalize,
      sep,
      staticDir,
    ) as (pathname: string) => string | null;

    expect(resolveStaticFile("/about")).toBe(nodeJoin(staticDir, "about/index.html"));
    expect(resolveStaticFile("/about/")).toBe(nodeJoin(staticDir, "about/index.html"));
    expect(resolveStaticFile("/styles.css")).toBe(nodeJoin(staticDir, "styles.css"));
    expect(resolveStaticFile("/missing.css")).toBeNull();
    // Path traversal must be refused even though "../secret" normalizes to
    // something outside staticDir -- this is the same safety property
    // @thexjs/core's own public/ resolver enforces.
    expect(resolveStaticFile("/../__eval-static-sibling/secret.txt")).toBeNull();

    rmSync(staticDir, { recursive: true, force: true });
  });

  test("sendWebResponse drops a stale Content-Length on a short streamed body", async () => {
    const src = generateEntrySource(unitManifest(), "/tmp/e", { trustProxy: false, port: 3000 });
    const fnSrc = extractFunction(src, "async function sendWebResponse(response, res)");
    const compile = new Function(`${fnSrc}; return sendWebResponse;`);
    const sendWebResponse = compile() as (response: Response, res: ServerResponse) => Promise<void>;

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("short"));
        controller.close();
      },
    });
    const response = new Response(body, { status: 200, headers: { "content-length": "1000" } });

    const server = createServer((_req, res) => {
      sendWebResponse(response, res).catch((err) => res.destroy(err));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no listening address");
    try {
      const client = await fetch(`http://127.0.0.1:${addr.port}/`);
      expect(client.status).toBe(200);
      expect(await client.text()).toBe("short");
      expect(client.headers.get("content-length")).toBeNull();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("buildNodeOutput (integration, runs the real generated server)", () => {
  let serverProcess: ReturnType<typeof Bun.spawn> | null = null;
  const port = 34567;

  beforeAll(async () => {
    touch(
      PAGES_DIR,
      "index.tsx",
      `export const mode = "static";
export default function Home() {
  return <h1>Home</h1>;
}
`,
    );
    touch(
      PAGES_DIR,
      "about.tsx",
      `export const mode = "server";
export default function About() {
  return <h1>About</h1>;
}
`,
    );
    touch(
      API_DIR,
      "hello.ts",
      `export function GET() {
  return Response.json({ hello: "world" });
}
`,
    );
    touch(PUBLIC_DIR, "styles.css", "body { color: red; }\n");

    await buildNodeOutput({
      projectRoot: FIXTURE_DIR,
      outputDir: OUTPUT_DIR,
      pagesDir: PAGES_DIR,
      apiDir: API_DIR,
      port,
    });
  });

  afterAll(async () => {
    serverProcess?.kill();
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  test("produces static/ with prerendered HTML and copied public assets", () => {
    expect(existsSync(join(OUTPUT_DIR, "static/index.html"))).toBe(true);
    expect(readFileSync(join(OUTPUT_DIR, "static/index.html"), "utf-8")).toContain("<h1>Home</h1>");
    expect(readFileSync(join(OUTPUT_DIR, "static/styles.css"), "utf-8")).toContain("color: red");
  });

  test("produces a standalone server/index.mjs", () => {
    expect(existsSync(join(OUTPUT_DIR, "server/index.mjs"))).toBe(true);
    const bundle = readFileSync(join(OUTPUT_DIR, "server/index.mjs"), "utf-8");
    expect(bundle).toContain('"/about"');
  });

  test("the generated server, run under plain node, serves static AND server-mode routes on one port", async () => {
    serverProcess = Bun.spawn({
      cmd: ["node", join(OUTPUT_DIR, "server", "index.mjs")],
      env: { ...process.env, PORT: String(port) },
      // Ignored, not drained-then-abandoned: the child keeps writing a log
      // line per request for the rest of its life, and a reader that stops
      // consuming the stream (e.g. after seeing a "ready" marker) closes the
      // pipe underneath it, crashing the child with EPIPE on its next write.
      stdout: "ignore",
      stderr: "ignore",
    });

    // Poll for readiness instead of relying on stdout content.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        await fetch(`http://127.0.0.1:${port}/`);
        break;
      } catch {
        await Bun.sleep(50);
      }
    }

    const staticRes = await fetch(`http://127.0.0.1:${port}/`);
    expect(staticRes.status).toBe(200);
    expect(await staticRes.text()).toContain("<h1>Home</h1>");

    const serverRes = await fetch(`http://127.0.0.1:${port}/about`);
    expect(serverRes.status).toBe(200);
    expect(await serverRes.text()).toContain("<h1>About</h1>");

    const apiRes = await fetch(`http://127.0.0.1:${port}/api/hello`);
    expect(apiRes.status).toBe(200);
    expect(await apiRes.json()).toEqual({ hello: "world" });

    const notFound = await fetch(`http://127.0.0.1:${port}/does-not-exist`);
    expect(notFound.status).toBe(404);
  });
});
