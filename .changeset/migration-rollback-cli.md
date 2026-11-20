---
"@thexjs/core": minor
"@thexjs/cli": minor
---

Add down-migrations/rollback to the data layer and a CLI runner for it.

`@thexjs/core/data` gains `rollbackSQLiteMigrations` and `rollbackPostgresMigrations`: each rolls back up to N applied migrations (default 1), most-recently-applied first, by running an optional `*.down.sql` sibling of the up-migration file (e.g. `001_create_users.sql` / `001_create_users.down.sql`) and removing its `_x_migrations` bookkeeping row. A migration with no down file can't be reverted, so rollback stops there instead of silently skipping past it. Existing migrations with no down file keep working exactly as before.

`@thexjs/cli` adds `x migrate down [N]`, rolling back against SQLite (`--sqlite <path>`, default `data/dev.db`) or Postgres (`--postgres`, or automatically when `DATABASE_URL` is set), reading migrations from `--dir <path>` (default `src/lib/migrations`).
