import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  rollbackPostgresMigrations,
  rollbackSQLiteMigrations,
  runPostgresMigrations,
  runSQLiteMigrations,
} from "./migrate";
import { connectPostgres, type PostgresClient } from "./postgres";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/migrations");

// Real-Postgres integration coverage for runPostgresMigrations(). Requires a
// DATABASE_URL (set in CI via a postgres service, or locally against any
// Postgres) and skips cleanly when it's absent — no mocked Bun.SQL, since that
// would only test the mock. Each test runs in a freshly created database so
// they stay isolated on a shared server.
const PG_TEST_URL = process.env.DATABASE_URL;

function resetFixtures() {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });
}

function writeMigration(name: string, sql: string) {
  writeFileSync(join(FIXTURE_DIR, name), sql);
}

function tableExists(db: Database, name: string): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
    .get(name) as { name: string } | null;
  // bun:sqlite's `.get()` returns `null` (not `undefined`) for no match --
  // rollback tests below are the first callers that hit the "doesn't exist"
  // branch, so `!== undefined` (which is always true against `null`) never
  // got exercised before.
  return row !== null;
}

function appliedNames(db: Database): string[] {
  const rows = db.query("SELECT name FROM _x_migrations ORDER BY name").all() as {
    name: string;
  }[];
  return rows.map((r) => r.name);
}

beforeAll(() => {
  resetFixtures();
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe("runSQLiteMigrations", () => {
  test("applies migrations in filename order", () => {
    resetFixtures();
    writeMigration(
      "001_create_users.sql",
      "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);",
    );
    writeMigration(
      "002_add_profiles.sql",
      "CREATE TABLE profiles (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id));",
    );

    const db = new Database(":memory:");
    const result = runSQLiteMigrations(db, FIXTURE_DIR);

    expect(result.applied).toEqual(["001_create_users.sql", "002_add_profiles.sql"]);
    expect(result.skipped).toEqual([]);
    expect(tableExists(db, "users")).toBe(true);
    expect(tableExists(db, "profiles")).toBe(true);
    expect(appliedNames(db)).toEqual(["001_create_users.sql", "002_add_profiles.sql"]);
    db.close();
  });

  test("orders migrations numerically, not lexically (10 before 2)", () => {
    resetFixtures();
    writeMigration("10_add_ten.sql", "CREATE TABLE ten (id INTEGER PRIMARY KEY);");
    writeMigration("2_add_two.sql", "CREATE TABLE two (id INTEGER PRIMARY KEY);");

    const db = new Database(":memory:");
    const result = runSQLiteMigrations(db, FIXTURE_DIR);

    expect(result.applied).toEqual(["2_add_two.sql", "10_add_ten.sql"]);
    expect(tableExists(db, "two")).toBe(true);
    expect(tableExists(db, "ten")).toBe(true);
    db.close();
  });

  test("skips migrations that were already applied", () => {
    resetFixtures();
    writeMigration("001_create_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY);");

    const db = new Database(":memory:");
    const first = runSQLiteMigrations(db, FIXTURE_DIR);
    expect(first.applied).toEqual(["001_create_users.sql"]);

    const second = runSQLiteMigrations(db, FIXTURE_DIR);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(["001_create_users.sql"]);
    db.close();
  });

  test("rolls back a migration that fails partway", () => {
    resetFixtures();
    writeMigration(
      "001_create_items.sql",
      "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
    );
    // The second statement violates the primary key — the whole file must
    // fail as one unit inside its transaction: no partial rows and no
    // bookkeeping record, so a retry replays it against a clean schema.
    writeMigration(
      "002_broken.sql",
      "INSERT INTO items (id, name) VALUES (1, 'first');\nINSERT INTO items (id, name) VALUES (1, 'duplicate');",
    );

    const db = new Database(":memory:");
    expect(() => runSQLiteMigrations(db, FIXTURE_DIR)).toThrow();

    // The earlier migration is still applied and its data is intact...
    expect(appliedNames(db)).toEqual(["001_create_items.sql"]);
    // ...but the failed migration left no trace: rows it inserted were rolled
    // back and it was never recorded as applied.
    const rows = db.query("SELECT COUNT(*) AS c FROM items").get() as { c: number };
    expect(rows.c).toBe(0);
    db.close();
  });

  test("retries a previously failed migration after a fix", () => {
    resetFixtures();
    writeMigration(
      "001_create_items.sql",
      "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
    );
    writeMigration(
      "002_broken.sql",
      "INSERT INTO items (id, name) VALUES (1, 'first');\nINSERT INTO items (id, name) VALUES (1, 'duplicate');",
    );

    const db = new Database(":memory:");
    expect(() => runSQLiteMigrations(db, FIXTURE_DIR)).toThrow();

    writeMigration(
      "002_broken.sql",
      "INSERT INTO items (id, name) VALUES (1, 'first');\nINSERT INTO items (id, name) VALUES (2, 'second');",
    );

    const retry = runSQLiteMigrations(db, FIXTURE_DIR);
    expect(retry.applied).toEqual(["002_broken.sql"]);
    expect(appliedNames(db)).toEqual(["001_create_items.sql", "002_broken.sql"]);
    const rows = db.query("SELECT name FROM items ORDER BY id").all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(["first", "second"]);
    db.close();
  });

  test("records a content checksum for each applied migration", () => {
    resetFixtures();
    writeMigration("001_create_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY);");

    const db = new Database(":memory:");
    runSQLiteMigrations(db, FIXTURE_DIR);

    const rows = db.query("SELECT name, checksum FROM _x_migrations").all() as {
      name: string;
      checksum: string | null;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
    db.close();
  });

  test("warns (but continues) when an applied migration file changed on disk", () => {
    resetFixtures();
    writeMigration("001_create_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY);");

    const db = new Database(":memory:");
    runSQLiteMigrations(db, FIXTURE_DIR);

    writeMigration(
      "001_create_users.sql",
      "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);",
    );

    const second = runSQLiteMigrations(db, FIXTURE_DIR);
    expect(second.applied).toEqual([]);
    expect(second.drifted).toEqual(["001_create_users.sql"]);
    expect(second.skipped).toEqual(["001_create_users.sql"]);
    db.close();
  });

  test("hard-fails on drift when onDrift is 'fail'", () => {
    resetFixtures();
    writeMigration("001_create_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY);");

    const db = new Database(":memory:");
    runSQLiteMigrations(db, FIXTURE_DIR);

    writeMigration(
      "001_create_users.sql",
      "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);",
    );

    expect(() => runSQLiteMigrations(db, FIXTURE_DIR, { onDrift: "fail" })).toThrow(
      /different content/,
    );
    db.close();
  });

  test("treats pre-checksum rows as unknown content and never fails on them", () => {
    resetFixtures();
    writeMigration("001_legacy.sql", "CREATE TABLE legacy (id INTEGER PRIMARY KEY);");

    const db = new Database(":memory:");
    // Simulate a deployment that recorded migrations before checksums existed:
    // old table shape, no checksum column, no hash stored.
    db.run(`CREATE TABLE _x_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )`);
    db.run("INSERT INTO _x_migrations (name) VALUES ('001_legacy.sql')");
    db.run("CREATE TABLE legacy (id INTEGER PRIMARY KEY)");

    // The runner backfills the column and reports the row as unknown content
    // even in hard-fail mode — never a hard error.
    const result = runSQLiteMigrations(db, FIXTURE_DIR, { onDrift: "fail" });
    expect(result.unknownContent).toEqual(["001_legacy.sql"]);
    expect(result.skipped).toEqual(["001_legacy.sql"]);
    expect(result.drifted).toEqual([]);
    db.close();
  });

  test("unmodified applied migrations skip silently with no drift flags", () => {
    resetFixtures();
    writeMigration("001_create_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY);");

    const db = new Database(":memory:");
    runSQLiteMigrations(db, FIXTURE_DIR);

    const second = runSQLiteMigrations(db, FIXTURE_DIR);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(["001_create_users.sql"]);
    expect(second.drifted).toEqual([]);
    expect(second.unknownContent).toEqual([]);
    db.close();
  });
});

describe("rollbackSQLiteMigrations", () => {
  test("rolling back an applied migration actually reverts the schema", () => {
    resetFixtures();
    writeMigration("001_create_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY);");
    writeMigration("001_create_users.down.sql", "DROP TABLE users;");

    const db = new Database(":memory:");
    runSQLiteMigrations(db, FIXTURE_DIR);
    expect(tableExists(db, "users")).toBe(true);

    const result = rollbackSQLiteMigrations(db, FIXTURE_DIR);
    expect(result.rolledBack).toEqual(["001_create_users.sql"]);
    expect(result.skipped).toEqual([]);
    // The table is actually gone -- not just "the function returned".
    expect(tableExists(db, "users")).toBe(false);
    expect(appliedNames(db)).toEqual([]);
    db.close();
  });

  test("rolls back multiple steps in reverse-applied order", () => {
    resetFixtures();
    writeMigration("001_create_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY);");
    writeMigration("001_create_users.down.sql", "DROP TABLE users;");
    writeMigration(
      "002_add_profiles.sql",
      "CREATE TABLE profiles (id INTEGER PRIMARY KEY, user_id INTEGER);",
    );
    writeMigration("002_add_profiles.down.sql", "DROP TABLE profiles;");

    const db = new Database(":memory:");
    runSQLiteMigrations(db, FIXTURE_DIR);

    const result = rollbackSQLiteMigrations(db, FIXTURE_DIR, 2);
    expect(result.rolledBack).toEqual(["002_add_profiles.sql", "001_create_users.sql"]);
    expect(tableExists(db, "users")).toBe(false);
    expect(tableExists(db, "profiles")).toBe(false);
    expect(appliedNames(db)).toEqual([]);
    db.close();
  });

  test("stops (no-op with a warning) at a migration with no down file, instead of silently skipping it", () => {
    resetFixtures();
    writeMigration("001_create_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY);");
    // No "001_create_users.down.sql" -- this migration can't be reverted.
    writeMigration(
      "002_add_profiles.sql",
      "CREATE TABLE profiles (id INTEGER PRIMARY KEY, user_id INTEGER);",
    );
    writeMigration("002_add_profiles.down.sql", "DROP TABLE profiles;");

    const db = new Database(":memory:");
    runSQLiteMigrations(db, FIXTURE_DIR);

    // Ask to roll back both, but 001 has no down file: 002 rolls back, then
    // rollback stops instead of silently leaving 001 unreverted-but-dropped.
    const result = rollbackSQLiteMigrations(db, FIXTURE_DIR, 2);
    expect(result.rolledBack).toEqual(["002_add_profiles.sql"]);
    expect(result.skipped).toEqual(["001_create_users.sql"]);
    expect(tableExists(db, "profiles")).toBe(false);
    // 001 is untouched: table still there, bookkeeping row still there.
    expect(tableExists(db, "users")).toBe(true);
    expect(appliedNames(db)).toEqual(["001_create_users.sql"]);
    db.close();
  });

  test("a down-migration file is never picked up as its own up migration", () => {
    resetFixtures();
    writeMigration("001_create_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY);");
    writeMigration("001_create_users.down.sql", "DROP TABLE users;");

    const db = new Database(":memory:");
    const result = runSQLiteMigrations(db, FIXTURE_DIR);
    expect(result.applied).toEqual(["001_create_users.sql"]);
    db.close();
  });

  test("defaults to rolling back exactly one step", () => {
    resetFixtures();
    writeMigration("001_create_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY);");
    writeMigration("001_create_users.down.sql", "DROP TABLE users;");
    writeMigration(
      "002_add_profiles.sql",
      "CREATE TABLE profiles (id INTEGER PRIMARY KEY, user_id INTEGER);",
    );
    writeMigration("002_add_profiles.down.sql", "DROP TABLE profiles;");

    const db = new Database(":memory:");
    runSQLiteMigrations(db, FIXTURE_DIR);

    const result = rollbackSQLiteMigrations(db, FIXTURE_DIR);
    expect(result.rolledBack).toEqual(["002_add_profiles.sql"]);
    expect(tableExists(db, "profiles")).toBe(false);
    expect(tableExists(db, "users")).toBe(true);
    db.close();
  });

  test("rolling back with nothing applied is a no-op", () => {
    resetFixtures();
    const db = new Database(":memory:");
    const result = rollbackSQLiteMigrations(db, FIXTURE_DIR);
    expect(result.rolledBack).toEqual([]);
    expect(result.skipped).toEqual([]);
    db.close();
  });
});

// Real-Postgres integration tests. Skipped unless DATABASE_URL is set (see
// PG_TEST_URL above); CI provides one through a postgres service container.
describe.if(Boolean(PG_TEST_URL))("runPostgresMigrations", () => {
  let admin: PostgresClient;

  beforeAll(() => {
    admin = connectPostgres({ url: PG_TEST_URL as string, max: 1 });
  });

  afterAll(() => {
    (admin as unknown as { close(): void }).close();
  });

  /** Creates a throwaway database, runs `fn` against it, and drops it. */
  async function withDatabase<T>(
    fn: (client: PostgresClient, url: string) => Promise<T>,
  ): Promise<T> {
    const dbName = `x_mig_${crypto.randomUUID().replace(/-/g, "")}`;
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    const url = new URL(PG_TEST_URL as string);
    url.pathname = `/${dbName}`;
    const urlString = url.toString();
    const client = connectPostgres({ url: urlString, max: 1 });
    try {
      return await fn(client, urlString);
    } finally {
      (client as unknown as { close(): void }).close();
      await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    }
  }

  async function tableExists(client: PostgresClient, name: string): Promise<boolean> {
    const rows = (await client.unsafe(
      "SELECT 1 AS found FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
      [name],
    )) as { found: number }[];
    return rows.length > 0;
  }

  async function appliedNames(client: PostgresClient): Promise<string[]> {
    const rows = (await client.unsafe("SELECT name FROM _x_migrations ORDER BY name")) as {
      name: string;
    }[];
    return rows.map((r) => r.name);
  }

  test("applies migrations in filename order", async () => {
    resetFixtures();
    writeMigration(
      "001_create_users.sql",
      "CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL);",
    );
    writeMigration(
      "002_add_profiles.sql",
      "CREATE TABLE profiles (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id));",
    );

    await withDatabase(async (client) => {
      const result = await runPostgresMigrations(client, FIXTURE_DIR);

      expect(result.applied).toEqual(["001_create_users.sql", "002_add_profiles.sql"]);
      expect(result.skipped).toEqual([]);
      expect(await tableExists(client, "users")).toBe(true);
      expect(await tableExists(client, "profiles")).toBe(true);
      expect(await appliedNames(client)).toEqual(["001_create_users.sql", "002_add_profiles.sql"]);
    });
  });

  test("skips migrations that were already applied", async () => {
    resetFixtures();
    writeMigration("001_create_users.sql", "CREATE TABLE users (id SERIAL PRIMARY KEY);");

    await withDatabase(async (client) => {
      const first = await runPostgresMigrations(client, FIXTURE_DIR);
      expect(first.applied).toEqual(["001_create_users.sql"]);

      const second = await runPostgresMigrations(client, FIXTURE_DIR);
      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual(["001_create_users.sql"]);
    });
  });

  test("rolls back a migration that fails partway", async () => {
    resetFixtures();
    writeMigration(
      "001_create_items.sql",
      "CREATE TABLE items (id SERIAL PRIMARY KEY, name TEXT NOT NULL);",
    );
    // The second file creates a table (a schema change), inserts a valid row,
    // then violates the primary key — the whole file must fail as one unit
    // inside its transaction: no partial schema, no partial rows, and no
    // bookkeeping record, so a retry replays it against a clean schema.
    writeMigration(
      "002_broken.sql",
      "CREATE TABLE audit_log (id SERIAL PRIMARY KEY);\nINSERT INTO items (id, name) VALUES (1, 'first');\nINSERT INTO items (id, name) VALUES (1, 'duplicate');",
    );

    await withDatabase(async (client) => {
      await expect(runPostgresMigrations(client, FIXTURE_DIR)).rejects.toThrow();

      // The earlier migration is still applied and its data is intact...
      expect(await appliedNames(client)).toEqual(["001_create_items.sql"]);
      // ...but the failed migration left no trace: its schema change was rolled
      // back, its rows were rolled back, and it was never recorded as applied.
      expect(await tableExists(client, "audit_log")).toBe(false);
      const rows = (await client.unsafe("SELECT COUNT(*) AS c FROM items")) as {
        c: number | string;
      }[];
      expect(Number(rows[0]?.c)).toBe(0);
    });
  });

  test("retries a previously failed migration after a fix", async () => {
    resetFixtures();
    writeMigration(
      "001_create_items.sql",
      "CREATE TABLE items (id SERIAL PRIMARY KEY, name TEXT NOT NULL);",
    );
    writeMigration(
      "002_broken.sql",
      "INSERT INTO items (id, name) VALUES (1, 'first');\nINSERT INTO items (id, name) VALUES (1, 'duplicate');",
    );

    await withDatabase(async (client) => {
      await expect(runPostgresMigrations(client, FIXTURE_DIR)).rejects.toThrow();

      writeMigration(
        "002_broken.sql",
        "INSERT INTO items (id, name) VALUES (1, 'first');\nINSERT INTO items (id, name) VALUES (2, 'second');",
      );

      const retry = await runPostgresMigrations(client, FIXTURE_DIR);
      expect(retry.applied).toEqual(["002_broken.sql"]);
      expect(await appliedNames(client)).toEqual(["001_create_items.sql", "002_broken.sql"]);
      const rows = (await client.unsafe("SELECT name FROM items ORDER BY id")) as {
        name: string;
      }[];
      expect(rows.map((r) => r.name)).toEqual(["first", "second"]);
    });
  });

  test("two concurrent runs against the same database don't crash the loser", async () => {
    resetFixtures();
    writeMigration(
      "001_create_users.sql",
      "CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL);",
    );

    await withDatabase(async (client, url) => {
      // Two separate pools on the same database, started at the same time —
      // the multi-replica boot pattern. Without the advisory lock, whichever
      // pool commits second hits the `_x_migrations` PRIMARY KEY on its
      // bookkeeping INSERT and rejects out of `runPostgresMigrations` (a
      // crash-loop). With the lock, one run applies and the other sees the
      // record and skips.
      const second = connectPostgres({ url, max: 1 });
      try {
        const [a, b] = await Promise.all([
          runPostgresMigrations(client, FIXTURE_DIR),
          runPostgresMigrations(second, FIXTURE_DIR),
        ]);

        // Exactly one run applied the migration; the other legitimately skipped.
        const appliedCount = a.applied.length + b.applied.length;
        expect(appliedCount).toBe(1);
        expect(await tableExists(client, "users")).toBe(true);
        expect(await appliedNames(client)).toEqual(["001_create_users.sql"]);
      } finally {
        (second as unknown as { close(): void }).close();
      }
    });
  });

  test("records a content checksum and detects drift after an edit", async () => {
    resetFixtures();
    writeMigration("001_create_users.sql", "CREATE TABLE users (id SERIAL PRIMARY KEY);");

    await withDatabase(async (client) => {
      await runPostgresMigrations(client, FIXTURE_DIR);
      const rows = (await client.unsafe("SELECT name, checksum FROM _x_migrations")) as {
        name: string;
        checksum: string | null;
      }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);

      writeMigration(
        "001_create_users.sql",
        "CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL);",
      );

      const second = await runPostgresMigrations(client, FIXTURE_DIR);
      expect(second.applied).toEqual([]);
      expect(second.drifted).toEqual(["001_create_users.sql"]);
      expect(second.skipped).toEqual(["001_create_users.sql"]);

      await expect(runPostgresMigrations(client, FIXTURE_DIR, { onDrift: "fail" })).rejects.toThrow(
        /different content/,
      );
    });
  });

  test("treats pre-checksum rows as unknown content and never fails on them", async () => {
    resetFixtures();
    writeMigration("001_legacy.sql", "CREATE TABLE legacy (id SERIAL PRIMARY KEY);");

    await withDatabase(async (client) => {
      // Old table shape: name + applied_at, no checksum column.
      await client.unsafe(
        "CREATE TABLE _x_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMP DEFAULT NOW())",
      );
      await client.unsafe("INSERT INTO _x_migrations (name) VALUES ('001_legacy.sql')");
      await client.unsafe("CREATE TABLE legacy (id SERIAL PRIMARY KEY)");

      const result = await runPostgresMigrations(client, FIXTURE_DIR, { onDrift: "fail" });
      expect(result.unknownContent).toEqual(["001_legacy.sql"]);
      expect(result.skipped).toEqual(["001_legacy.sql"]);
      expect(result.drifted).toEqual([]);
    });
  });

  test("rolling back an applied migration actually reverts the schema", async () => {
    resetFixtures();
    writeMigration("001_create_users.sql", "CREATE TABLE users (id SERIAL PRIMARY KEY);");
    writeMigration("001_create_users.down.sql", "DROP TABLE users;");

    await withDatabase(async (client) => {
      await runPostgresMigrations(client, FIXTURE_DIR);
      expect(await tableExists(client, "users")).toBe(true);

      const result = await rollbackPostgresMigrations(client, FIXTURE_DIR);
      expect(result.rolledBack).toEqual(["001_create_users.sql"]);
      expect(result.skipped).toEqual([]);
      // The table is actually gone -- not just "the function returned".
      expect(await tableExists(client, "users")).toBe(false);
      expect(await appliedNames(client)).toEqual([]);
    });
  });

  test("rolls back multiple steps in reverse-applied order", async () => {
    resetFixtures();
    writeMigration("001_create_users.sql", "CREATE TABLE users (id SERIAL PRIMARY KEY);");
    writeMigration("001_create_users.down.sql", "DROP TABLE users;");
    writeMigration(
      "002_add_profiles.sql",
      "CREATE TABLE profiles (id SERIAL PRIMARY KEY, user_id INTEGER);",
    );
    writeMigration("002_add_profiles.down.sql", "DROP TABLE profiles;");

    await withDatabase(async (client) => {
      await runPostgresMigrations(client, FIXTURE_DIR);

      const result = await rollbackPostgresMigrations(client, FIXTURE_DIR, 2);
      expect(result.rolledBack).toEqual(["002_add_profiles.sql", "001_create_users.sql"]);
      expect(await tableExists(client, "users")).toBe(false);
      expect(await tableExists(client, "profiles")).toBe(false);
      expect(await appliedNames(client)).toEqual([]);
    });
  });

  test("stops at a migration with no down file instead of silently skipping it", async () => {
    resetFixtures();
    writeMigration("001_create_users.sql", "CREATE TABLE users (id SERIAL PRIMARY KEY);");
    // No "001_create_users.down.sql" -- this migration can't be reverted.
    writeMigration(
      "002_add_profiles.sql",
      "CREATE TABLE profiles (id SERIAL PRIMARY KEY, user_id INTEGER);",
    );
    writeMigration("002_add_profiles.down.sql", "DROP TABLE profiles;");

    await withDatabase(async (client) => {
      await runPostgresMigrations(client, FIXTURE_DIR);

      const result = await rollbackPostgresMigrations(client, FIXTURE_DIR, 2);
      expect(result.rolledBack).toEqual(["002_add_profiles.sql"]);
      expect(result.skipped).toEqual(["001_create_users.sql"]);
      expect(await tableExists(client, "profiles")).toBe(false);
      expect(await tableExists(client, "users")).toBe(true);
      expect(await appliedNames(client)).toEqual(["001_create_users.sql"]);
    });
  });
});
