import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { humanReporter, jsonReporter } from "./reporter.js";

/**
 * Reporter is tested in isolation from the CLI commands (per #73's
 * acceptance criteria): no `index.ts`, no spawning a real process — just
 * capture what each implementation writes to stdout/stderr for a given call.
 */

let stdoutChunks: string[] = [];
let stderrChunks: string[] = [];
let originalStdoutWrite: typeof process.stdout.write;
let originalStderrWrite: typeof process.stderr.write;
let originalIsTTY: boolean | undefined;
let originalNoColor: string | undefined;

beforeEach(() => {
  stdoutChunks = [];
  stderrChunks = [];
  originalStdoutWrite = process.stdout.write.bind(process.stdout);
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  originalIsTTY = process.stdout.isTTY;
  originalNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  // Force non-TTY by default so tests are deterministic about ANSI; the
  // dedicated color tests below flip this back on explicitly.
  (process.stdout as unknown as { isTTY: boolean }).isTTY = false;
  process.stdout.write = ((chunk: string) => {
    stdoutChunks.push(chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    stderrChunks.push(chunk.toString());
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
  (process.stdout as unknown as { isTTY: boolean | undefined }).isTTY = originalIsTTY;
  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;
});

describe("humanReporter", () => {
  test("info/success/warn/error write legible, glyph-prefixed lines", () => {
    const reporter = humanReporter();
    reporter.info("hello");
    reporter.success("done");
    reporter.warn("careful");
    reporter.error("broken");

    expect(stdoutChunks.join("")).toContain("[x] hello");
    expect(stdoutChunks.join("")).toContain("✓ done");
    expect(stderrChunks.join("")).toContain("⚠ careful");
    expect(stderrChunks.join("")).toContain("✗ broken");
  });

  test("buildStep formats step, message and duration", () => {
    const reporter = humanReporter();
    reporter.buildStep({ step: "static", status: "ok", message: "/about -> ...", durationMs: 12 });
    const out = stdoutChunks.join("");
    expect(out).toContain("static:");
    expect(out).toContain("/about -> ...");
    expect(out).toContain("12ms");
  });

  test("buildStep with status 'error' writes to stderr", () => {
    const reporter = humanReporter();
    reporter.buildStep({ step: "server", status: "error", message: "boom" });
    expect(stderrChunks.join("")).toContain("boom");
    expect(stdoutChunks.join("")).toBe("");
  });

  test("buildComplete summarizes counts and outDir", () => {
    const reporter = humanReporter();
    reporter.buildComplete({
      durationMs: 500,
      outDir: ".x",
      staticCount: 2,
      serverCount: 3,
      apiCount: 1,
      contentCount: 0,
    });
    const out = stdoutChunks.join("");
    expect(out).toContain("2 static");
    expect(out).toContain("3 server");
    expect(out).toContain("1 api routes");
    expect(out).toContain(".x");
    expect(out).toContain("500ms");
  });

  test("devReady prints local/network URL and route count", () => {
    const reporter = humanReporter();
    reporter.devReady({
      url: "http://localhost:3000",
      networkUrl: "http://192.168.1.5:3000",
      routeCount: 8,
      startupMs: 120,
    });
    const out = stdoutChunks.join("");
    expect(out).toContain("http://localhost:3000");
    expect(out).toContain("http://192.168.1.5:3000");
    expect(out).toContain("8 route(s)");
    expect(out).toContain("120ms");
  });

  test("devRequest reflects status via glyph/stream choice", () => {
    const reporter = humanReporter();
    reporter.devRequest({ method: "GET", path: "/", status: 200, durationMs: 3 });
    reporter.devRequest({ method: "GET", path: "/missing", status: 404, durationMs: 2 });
    reporter.devRequest({ method: "GET", path: "/boom", status: 500, durationMs: 1 });
    expect(stdoutChunks.join("")).toContain("GET / 200 3ms");
    expect(stderrChunks.join("")).toContain("GET /missing 404 2ms");
    expect(stderrChunks.join("")).toContain("GET /boom 500 1ms");
  });

  test("startReady prints a single clean ready line", () => {
    const reporter = humanReporter();
    reporter.startReady({ url: "http://localhost:3000" });
    expect(stdoutChunks.join("")).toContain("production server running at http://localhost:3000");
  });

  test("strips ANSI codes when stdout is not a TTY", () => {
    const reporter = humanReporter();
    reporter.success("no color here");
    const out = stdoutChunks.join("");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting ANSI codes are absent
    expect(/\x1b\[/.test(out)).toBe(false);
  });

  test("emits ANSI codes when stdout is a TTY", () => {
    (process.stdout as unknown as { isTTY: boolean }).isTTY = true;
    const reporter = humanReporter();
    reporter.success("colorful");
    const out = stdoutChunks.join("");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting ANSI codes are present
    expect(/\x1b\[/.test(out)).toBe(true);
  });

  test("strips ANSI codes when NO_COLOR is set, even on a TTY", () => {
    (process.stdout as unknown as { isTTY: boolean }).isTTY = true;
    process.env.NO_COLOR = "1";
    const reporter = humanReporter();
    reporter.success("no color via NO_COLOR");
    const out = stdoutChunks.join("");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting ANSI codes are absent
    expect(/\x1b\[/.test(out)).toBe(false);
  });
});

describe("jsonReporter", () => {
  function lastStdoutLine(): Record<string, unknown> {
    const lines = stdoutChunks.join("").trim().split("\n");
    return JSON.parse(lines[lines.length - 1] as string);
  }
  function lastStderrLine(): Record<string, unknown> {
    const lines = stderrChunks.join("").trim().split("\n");
    return JSON.parse(lines[lines.length - 1] as string);
  }

  test("every call emits exactly one line of valid JSON on stdout", () => {
    const reporter = jsonReporter();
    reporter.buildStart();
    reporter.buildStep({ step: "static", status: "ok", message: "/about", durationMs: 5 });
    reporter.buildComplete({
      durationMs: 10,
      outDir: ".x",
      staticCount: 1,
      serverCount: 0,
      apiCount: 0,
      contentCount: 0,
    });

    const lines = stdoutChunks.join("").trim().split("\n");
    expect(lines.length).toBe(3);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  test("buildStart emits a build:start event with a timestamp", () => {
    const reporter = jsonReporter();
    reporter.buildStart();
    const event = lastStdoutLine();
    expect(event.event).toBe("build:start");
    expect(typeof event.timestamp).toBe("string");
  });

  test("buildStep with status 'ok' goes to stdout; 'error' goes to stderr", () => {
    const reporter = jsonReporter();
    reporter.buildStep({ step: "static", status: "ok", message: "fine" });
    reporter.buildStep({ step: "server", status: "error", message: "broken" });

    const stdoutEvent = lastStdoutLine();
    expect(stdoutEvent.event).toBe("build:step");
    expect(stdoutEvent.status).toBe("ok");

    const stderrEvent = lastStderrLine();
    expect(stderrEvent.event).toBe("build:step");
    expect(stderrEvent.status).toBe("error");
    expect(stderrEvent.message).toBe("broken");
  });

  test("dev:ready / dev:request / dev:rebuild carry their structured fields", () => {
    const reporter = jsonReporter();
    reporter.devReady({ url: "http://localhost:3000", routeCount: 3, startupMs: 50 });
    expect(lastStdoutLine()).toMatchObject({
      event: "dev:ready",
      url: "http://localhost:3000",
      routeCount: 3,
      startupMs: 50,
    });

    reporter.devRequest({ method: "GET", path: "/about", status: 200, durationMs: 4 });
    expect(lastStdoutLine()).toMatchObject({
      event: "dev:request",
      method: "GET",
      path: "/about",
      status: 200,
      durationMs: 4,
    });

    reporter.devRebuild({ reason: "file-change", file: "src/pages/about.tsx", durationMs: 12 });
    expect(lastStdoutLine()).toMatchObject({
      event: "dev:rebuild",
      reason: "file-change",
      file: "src/pages/about.tsx",
      durationMs: 12,
    });
  });

  test("error() writes {event, message, stack?} to stderr", () => {
    const reporter = jsonReporter();
    reporter.error("something broke", new Error("boom"));
    const event = lastStderrLine();
    expect(event.event).toBe("error");
    expect(event.message).toBe("something broke");
    expect(typeof event.stack).toBe("string");
  });

  test("banner() is a no-op (no decorative UI in --json mode)", () => {
    const reporter = jsonReporter();
    reporter.banner();
    expect(stdoutChunks.join("")).toBe("");
    expect(stderrChunks.join("")).toBe("");
  });

  test("never emits ANSI escape codes, regardless of TTY/NO_COLOR", () => {
    (process.stdout as unknown as { isTTY: boolean }).isTTY = true;
    const reporter = jsonReporter();
    reporter.success("plain");
    reporter.buildComplete({
      durationMs: 1,
      outDir: ".x",
      staticCount: 0,
      serverCount: 0,
      apiCount: 0,
      contentCount: 0,
    });
    const all = stdoutChunks.join("") + stderrChunks.join("");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting ANSI codes are absent
    expect(/\x1b\[/.test(all)).toBe(false);
  });
});
