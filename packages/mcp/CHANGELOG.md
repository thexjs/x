# @thexjs/mcp

## 0.1.3

### Patch Changes

- bf2a190: Bump `@modelcontextprotocol/sdk` from 1.32.1 to 1.32.2 (dependency maintenance, no behavior change).

## 0.1.2

### Patch Changes

- c5a3f0f: Bump `tsup` devDependency to 9.0.0 across all packages, and `react`/`@types/react`/`react-dom`/`@types/react-dom` to 19.3.x where applicable (`@thexjs/core`, `@thexjs/hooks`, `@thexjs/adapter-vercel`, `@thexjs/cli`).

## 0.1.1

### Patch Changes

- bfe83ae: Fix CI and Vercel builds:
  - Treat Vercel's non-secret `VERCEL_HASH_SALT` timestamp as safe in the
    client-bundle value scan. Its short numeric value collides with numbers in
    bundled JS, which previously failed every Vercel deployment with a false
    `EnvLeakageError`.
  - Emit the `x-routes.ts` `href()` helper in Biome-formatted form so regenerating
    the manifest in dev doesn't make `biome check` fail.
  - Upgrade `@thexjs/mcp` to Zod 4, matching the MCP SDK's resolved Zod version.
    The previous dual Zod 3/Zod 4 type graph made `tsc`/`tsup --dts` fail with
    `TS2589: Type instantiation is excessively deep and possibly infinite`.

## 0.1.0

### Minor Changes

- ff588b6: Initial release of the x MCP server. Exposes grounded x framework docs to AI coding agents over stdio (`list_topics`, `get_docs`, `search_docs`, `scaffold_file`), plus a `@thexjs/mcp/docs` subpath export so tooling (llms.txt generators, docs sites) can reuse the same doc content.
