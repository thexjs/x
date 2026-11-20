import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guards the committed root `fly.toml` (the Fly.io reference deployment in
 * DEPLOY.md's "Deploy to Fly.io" section) against silently drifting from the
 * Dockerfile it builds. There's no `flyctl` available in CI to actually
 * validate the manifest, so this does the next best thing with plain string
 * checks rather than pulling in a TOML parser dependency for one file:
 *   - `[build] dockerfile` points at a file that exists.
 *   - `[http_service] internal_port` matches the Dockerfile's `EXPOSE`.
 *   - the Dockerfile's `CMD` is the Bun entry point DEPLOY.md documents,
 *     not `@thexjs/adapter-node`'s output -- see the comment in fly.toml
 *     for why this example intentionally stays on the Bun/Docker path.
 */

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const flyToml = readFileSync(join(rootDir, "fly.toml"), "utf8");
const dockerfile = readFileSync(join(rootDir, "Dockerfile"), "utf8");

function tomlValue(toml: string, key: string): string | undefined {
  const match = toml.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n]+)"?\\s*$`, "m"));
  return match?.[1]?.trim();
}

describe("fly.toml", () => {
  test("[build] dockerfile points at a file that exists", () => {
    const dockerfilePath = tomlValue(flyToml, "dockerfile");
    expect(dockerfilePath).toBe("Dockerfile");
    expect(() => readFileSync(join(rootDir, dockerfilePath as string))).not.toThrow();
  });

  test("[http_service] internal_port matches the Dockerfile's EXPOSE", () => {
    const internalPort = tomlValue(flyToml, "internal_port");
    const exposeMatch = dockerfile.match(/^EXPOSE\s+(\d+)/m);
    expect(exposeMatch).not.toBeNull();
    expect(internalPort).toBe(exposeMatch?.[1]);
  });

  test("builds the Bun entry point, not the Node-adapter output", () => {
    // examples/basic uses connectSQLite (bun:sqlite), which refuses to run
    // under plain Node -- see DEPLOY.md's Node-host caveat. If the
    // Dockerfile's CMD ever switches to dist-node/server/index.mjs, this
    // file's rationale comment (and DEPLOY.md) need to be revisited too.
    expect(dockerfile).toMatch(/CMD\s*\[\s*"bun",\s*"dist\/server\/index\.ts"\s*\]/);
  });
});
