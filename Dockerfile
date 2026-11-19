# syntax=docker/dockerfile:1

# Build stage — install workspace deps, typecheck, and emit the production build.
# `x build --outDir dist` so the Dockerfile can COPY ./dist (matches DEPLOY.md).
FROM oven/bun:1 AS build
WORKDIR /app

# Copy lockfile + every workspace package.json first so `bun install` can run
# with full layer caching (any new workspace just needs its package.json added).
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/adapter-vercel/package.json packages/adapter-vercel/package.json
COPY packages/adapter-node/package.json packages/adapter-node/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/create-thexjs-app/package.json packages/create-thexjs-app/package.json
COPY packages/hooks/package.json packages/hooks/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY examples/basic/package.json examples/basic/package.json
COPY examples/default/package.json examples/default/package.json
COPY examples/blog/package.json examples/blog/package.json
COPY examples/landing/package.json examples/landing/package.json
COPY examples/saas/package.json examples/saas/package.json
RUN bun install --frozen-lockfile

COPY . .

# `x build` always re-execs itself under NODE_ENV=production (so Bun.build
# resolves React's production builds). The island bundler's
# resolveIslandPaths now evaluates a route's module server-side at build time
# too (to discover path-backed `islands` entries without leaking a loader's
# imports into the client bundle) -- which means examples/basic's dashboard
# route (real @thexjs/auth, not the old demo auth) gets imported during this
# build step for the first time, and defineAuth() throws without a stable
# `secret` under NODE_ENV=production -- exactly the guard that's supposed to
# stop someone from accidentally deploying with a per-process random secret.
# This placeholder only satisfies that check for this disposable build-stage
# process; it is never copied into the production stage below (each Docker
# stage starts with a fresh environment), and the actual running container
# reads its own AUTH_SECRET from the deploy platform at startup,
# independently.
ENV AUTH_SECRET=docker-build-stage-placeholder-not-used-at-runtime

# Typecheck the workspace, then build the basic example. `--cwd examples/basic`
# makes projectDir /app/examples/basic, so `--outDir ../../dist` resolves to
# /app/dist (matching the COPY below and DEPLOY.md).
RUN bun run typecheck
RUN bun packages/cli/src/index.ts build --outDir ../../dist --cwd examples/basic
FROM oven/bun:1 AS production
WORKDIR /app
# Patch the base image's OS packages so the production image ships with the
# latest security fixes (the CVE gate scans the built image).
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=bun:bun /app/dist ./dist
ENV NODE_ENV=production
USER bun
EXPOSE 3000
CMD ["bun", "dist/server/index.ts"]
