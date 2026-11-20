// Real auth, backed by @thexjs/auth -- a credentials (email + password)
// provider against a local `users` table, Argon2id password hashing, and
// HMAC'd sessions in a SQLite-backed store. See @thexjs/auth's README for
// OAuth providers, roles/permissions, and swapping in Postgres.
//
// Set AUTH_SECRET in production (any stable random string) -- without it,
// sessions are HMAC'd with a per-process random secret and every restart
// invalidates them. defineAuth throws on boot if it's missing in production;
// in development a random one is generated for you automatically.

import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AuthUser,
  createSQLiteSessionStore,
  defineAuth,
  hashPassword,
  verifyPassword,
} from "@thexjs/auth";
import { connectSQLite, runSQLiteMigrations } from "@thexjs/core/data";

// `import.meta.dir` is Bun-only -- it's `undefined` under plain Node, which
// breaks this file once @thexjs/adapter-node or @thexjs/adapter-vercel
// transpile it for a Node runtime (Bun.build's `target: "node"` does not
// polyfill it). `fileURLToPath(new URL(".", import.meta.url))` resolves to
// the same directory on both Bun and Node.
const __dirname = fileURLToPath(new URL(".", import.meta.url));

let db: Database | null = null;

function getDb(): Database {
  if (db) return db;
  const dbPath = join(__dirname, "..", "..", "data", "dev.db");
  mkdirSync(dirname(dbPath), { recursive: true });
  db = connectSQLite({ path: dbPath });
  runSQLiteMigrations(db, join(__dirname, "migrations"));
  return db;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
}

/**
 * Creates a user with a hashed password. `defineAuth` itself has no
 * "create user" API -- that's always app-specific -- so this is what
 * `src/api/auth/signup.ts` calls. Throws if the email is already taken.
 */
export async function createUser(
  email: string,
  password: string,
  name?: string,
): Promise<AuthUser> {
  const database = getDb();
  const existing = database.prepare("SELECT id FROM users WHERE email = ?1").get(email);
  if (existing) throw new Error("An account with that email already exists");

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  database.run("INSERT INTO users (id, email, password_hash, name) VALUES (?1, ?2, ?3, ?4)", [
    id,
    email,
    passwordHash,
    name ?? null,
  ] as unknown as string[]);
  return name !== undefined ? { id, email, name } : { id, email };
}

export const auth = defineAuth({
  ...(process.env.AUTH_SECRET ? { secret: process.env.AUTH_SECRET } : {}),
  store: createSQLiteSessionStore({ db: getDb() }),
  successRedirect: "/dashboard",
  providers: [
    {
      id: "local",
      name: "Local",
      type: "credentials",
      async authorize({ email, password }) {
        if (!email || !password) return null;
        const database = getDb();
        const row = database
          .prepare("SELECT id, email, password_hash, name FROM users WHERE email = ?1")
          .get(email) as UserRow | null;
        if (!row) return null;
        const valid = await verifyPassword(password, row.password_hash);
        if (!valid) return null;
        return row.name !== null
          ? { id: row.id, email: row.email, name: row.name }
          : { id: row.id, email: row.email };
      },
    },
  ],
});
