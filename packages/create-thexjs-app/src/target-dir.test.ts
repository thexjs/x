import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTargetDir } from "./templates";

describe("createTargetDir", () => {
  let fixtureRoot: string;

  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "x-target-dir-"));
  });

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  test("creates a missing target directory", () => {
    const targetDir = join(fixtureRoot, "fresh-app");
    createTargetDir(targetDir);
    expect(existsSync(targetDir)).toBe(true);
  });

  test("accepts a pre-existing empty target directory", () => {
    const targetDir = join(fixtureRoot, "empty-app");
    mkdirSync(targetDir);
    expect(() => createTargetDir(targetDir)).not.toThrow();
  });

  test("rejects a target directory another run filled after the initial check", () => {
    // Simulates a concurrent invocation creating the project between the
    // empty-dir check and the create step.
    const targetDir = join(fixtureRoot, "raced-app");
    mkdirSync(targetDir);
    writeFileSync(join(targetDir, "package.json"), "{}");

    expect(() => createTargetDir(targetDir)).toThrow(/already exists and is not empty/);
    expect(readFileSync(join(targetDir, "package.json"), "utf8")).toBe("{}");
  });
});
