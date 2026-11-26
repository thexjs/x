import type { EnvValidator } from "./validators";

export type { EnvValidator } from "./validators";
export { bool, num, oneOf, str, url } from "./validators";

/**
 * Default prefix required of any variable exposed to client/browser code.
 * Matches the compiler boundary enforced by `@thexjs/core`'s build step
 * (`security/env-isolation.ts`) — anything not prefixed with this is treated
 * as server-only and will fail the build if referenced from client code.
 */
export const DEFAULT_CLIENT_PREFIX = "THEXJS_PUBLIC_";

interface EnvSchemaInput {
  server?: Record<string, EnvValidator>;
  /** Required prefix for client-exposed variables. Default: "THEXJS_PUBLIC_". */
  clientPrefix?: string;
  client?: Record<string, EnvValidator>;
  runtimeEnv: Record<string, string | undefined>;
}

type InferServer<T> = {
  [K in keyof T]: T[K] extends EnvValidator<infer V> ? V : never;
};

type InferClient<T, P extends string> = {
  [K in keyof T as K extends `${P}${string}` ? K : never]: T[K] extends EnvValidator<infer V>
    ? V
    : never;
};

type ClientShape<T extends EnvSchemaInput> = InferClient<
  T["client"],
  T["clientPrefix"] extends string ? T["clientPrefix"] : ""
>;
type ServerShape<T extends EnvSchemaInput> = InferServer<T["server"]>;

export function createEnv<T extends EnvSchemaInput>(
  schema: T,
): InferServer<T["server"]> &
  InferClient<T["client"], T["clientPrefix"] extends string ? T["clientPrefix"] : ""> & {
    /**
     * Only the validated `client` keys (the ones required to start with
     * `clientPrefix`), as their own object.
     *
     * This is the structurally-safe shape to serialize for the browser —
     * `JSON.stringify(env.client)` can only ever contain client-prefixed
     * values, so a hydration payload like `window.__ENV__ = env.client`
     * can't leak a server secret even if the schema grows one later.
     *
     * Serializing the top-level `env` object directly still works (every
     * flat key documented above is still present, unchanged, for backward
     * compatibility) but is discouraged for exactly that reason: it mixes
     * server-only values into whatever gets stringified.
     */
    client: ClientShape<T>;
    /**
     * Only the validated `server` keys, as their own object. Provided for
     * symmetry with `client` — most code should keep reading server values
     * off the flat top-level object (or this), never off `.client`.
     */
    server: ServerShape<T>;
  } {
  const errors: string[] = [];
  const result: Record<string, unknown> = {};
  const serverResult: Record<string, unknown> = {};
  const clientResult: Record<string, unknown> = {};

  if (schema.server) {
    for (const [key, validator] of Object.entries(schema.server)) {
      try {
        const value = validator.parse(schema.runtimeEnv[key]);
        result[key] = value;
        serverResult[key] = value;
      } catch (err) {
        errors.push(`server.${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (schema.client) {
    const prefix = schema.clientPrefix ?? DEFAULT_CLIENT_PREFIX;
    for (const [key, validator] of Object.entries(schema.client)) {
      if (!key.startsWith(prefix)) {
        errors.push(`client.${key}: must start with prefix "${prefix}"`);
        continue;
      }
      try {
        const value = validator.parse(schema.runtimeEnv[key]);
        result[key] = value;
        clientResult[key] = value;
      } catch (err) {
        errors.push(`client.${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n  ${errors.join("\n  ")}`);
  }

  // Assigned after validation so the flat top-level keys are settled first;
  // these are read-oriented structural views, never inputs to validation.
  result.client = clientResult;
  result.server = serverResult;

  return result as never;
}
