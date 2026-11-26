# Examples

Five dogfood apps, each exercising a different slice of the framework. These are run and tested as part of the monorepo (`bun run dev` from the repo root builds every package then starts `examples/basic`); they aren't templates to copy from scratch — for that, use `bun create thexjs-app@latest`.

| Example                | What it demonstrates                                                                                                                                                                                                        | Look here for                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`default`](./default) | The minimal starting point: nothing but file-based routing, a layout, and a stylesheet.                                                                                                                                     | What an `x` app looks like with every optional feature left off.                                                                                            |
| [`basic`](./basic)     | The full demo: page routes, API routes, server functions, authentication (`src/api/auth`), a SQLite-backed dashboard with migrations (`src/lib/migrations`).                                                                | How routing, auth, actions, and the data layer fit together in one app.                                                                                     |
| [`blog`](./blog)       | Content collections — Markdown posts under `src/pages/blog` scanned and rendered via `scanContent()`.                                                                                                                       | The content-collection convention (see `CONTEXT.md`'s "Content Collection" entry) end to end.                                                               |
| [`saas`](./saas)       | A SaaS-shaped dashboard: auth, server functions, a migrated data layer, and a dashboard route tree — structurally similar to `basic` but oriented around a multi-page authenticated product rather than a single demo page. | A closer-to-real starting shape for a subscription/dashboard product.                                                                                       |
| [`landing`](./landing) | `x`'s own public docs site (`thexjs.dev`), including a `/docs` content-collection tree.                                                                                                                                     | A real, shipped, production marketing/docs site built on the framework — the thing to point at when someone asks "does this actually work for a real site." |

## Running one directly

Each example is its own workspace package with its own `x.config.ts`. From the repo root:

```bash
bun run build:packages   # build every @thexjs/* package once (postinstall does this automatically)
cd examples/<name>
bun ../../packages/cli/src/index.ts dev
```

Or, after the root `bun install` has linked the CLI globally:

```bash
cd examples/<name>
x dev
```
