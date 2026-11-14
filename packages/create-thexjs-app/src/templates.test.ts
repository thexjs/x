import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyAddon, FEATURES, type FeatureId, normalizeFeatures } from "./templates";

describe("normalizeFeatures", () => {
  test("shadcn alone keeps shadcn AND auto-enables tailwind", () => {
    // Regression: the old tailwind auto-enable built
    // ["tailwind", ...features.filter((f) => f !== "shadcn")], silently
    // dropping shadcn itself — no deps, no addon files, misleading warn.
    const { features, autoEnabled } = normalizeFeatures(["shadcn"]);
    expect(features).toEqual(["tailwind", "shadcn"]);
    expect(autoEnabled).toEqual([{ added: "tailwind", because: "shadcn" }]);
  });

  test("explicit tailwind + shadcn needs no auto-enable", () => {
    const { features, autoEnabled } = normalizeFeatures(["tailwind", "shadcn"]);
    expect(features).toEqual(["tailwind", "shadcn"]);
    expect(autoEnabled).toEqual([]);
  });

  test("selections without requirements pass through unchanged", () => {
    const { features, autoEnabled } = normalizeFeatures(["auth", "hooks"]);
    expect(features).toEqual(["auth", "hooks"]);
    expect(autoEnabled).toEqual([]);
  });

  test("dedupes repeated selections", () => {
    const { features, autoEnabled } = normalizeFeatures([
      "tailwind",
      "tailwind",
      "shadcn",
      "shadcn",
    ] as FeatureId[]);
    expect(features).toEqual(["tailwind", "shadcn"]);
    expect(autoEnabled).toEqual([]);
  });

  test("orders output by catalog order regardless of input order", () => {
    const { features } = normalizeFeatures(["hooks", "content", "auth", "tailwind", "shadcn"]);
    expect(features).toEqual(["tailwind", "shadcn", "auth", "content", "hooks"]);
  });

  test("empty selection stays empty", () => {
    const { features, autoEnabled } = normalizeFeatures([]);
    expect(features).toEqual([]);
    expect(autoEnabled).toEqual([]);
  });
});

describe("copyAddon (shadcn)", () => {
  let targetDir: string;

  beforeAll(() => {
    targetDir = mkdtempSync(join(tmpdir(), "x-shadcn-addon-"));
  });

  afterAll(() => {
    rmSync(targetDir, { recursive: true, force: true });
  });

  test("copies the shadcn addon files into the target dir", () => {
    copyAddon("shadcn", targetDir);
    // The shadcn addon ships src/lib/utils.ts; assert it landed.
    expect(existsSync(join(targetDir, "src", "lib", "utils.ts"))).toBe(true);
  });
});

describe("copyAddon (auth)", () => {
  let targetDir: string;

  beforeAll(() => {
    targetDir = mkdtempSync(join(tmpdir(), "x-auth-addon-"));
    copyAddon("auth", targetDir);
  });

  afterAll(() => {
    rmSync(targetDir, { recursive: true, force: true });
  });

  // Regression: the auth addon used to scaffold a hardcoded admin/admin
  // credential check with plaintext comparison and no password hashing --
  // a real security trap for anyone who shipped it as-is. It must now wire
  // the real @thexjs/auth package instead.
  test("wires real @thexjs/auth -- no admin/admin demo credentials anywhere", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(targetDir);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      expect(content).not.toMatch(/admin.*admin/i);
    }

    const authLib = readFileSync(join(targetDir, "src", "lib", "auth.ts"), "utf-8");
    expect(authLib).toContain('from "@thexjs/auth"');
    expect(authLib).toContain("defineAuth(");
    expect(authLib).toContain("hashPassword");
    expect(authLib).toContain("verifyPassword");
  });

  test("ships a users migration, not a hand-rolled sessions table", () => {
    const migrationsDir = join(targetDir, "src", "lib", "migrations");
    expect(existsSync(join(migrationsDir, "001_create_users.sql"))).toBe(true);
    expect(existsSync(join(migrationsDir, "001_create_sessions.sql"))).toBe(false);
    const sql = readFileSync(join(migrationsDir, "001_create_users.sql"), "utf-8");
    expect(sql).toContain("password_hash");
  });

  test("ships signup + a catch-all auth route delegating to auth.handleRequest", () => {
    expect(existsSync(join(targetDir, "src", "pages", "signup.tsx"))).toBe(true);
    expect(existsSync(join(targetDir, "src", "api", "auth", "signup.ts"))).toBe(true);
    const catchAll = readFileSync(join(targetDir, "src", "api", "auth", "[...auth].ts"), "utf-8");
    expect(catchAll).toContain("auth.handleRequest(req)");
  });

  test("the dashboard guard uses auth.requireAuth, not a hand-rolled cookie check", () => {
    const middleware = readFileSync(
      join(targetDir, "src", "pages", "dashboard", "_middleware.ts"),
      "utf-8",
    );
    expect(middleware).toContain("auth.requireAuth(");
  });
});

describe("FEATURES (auth)", () => {
  test("declares a real @thexjs/auth dependency, not an empty stub", () => {
    const auth = FEATURES.find((f) => f.id === "auth");
    expect(auth?.dependencies["@thexjs/auth"]).toBeDefined();
  });
});
