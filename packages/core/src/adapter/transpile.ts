import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CompiledModuleRef } from "./types";

const EXTERNAL = ["react", "react/*", "react-dom", "react-dom/*", "@thexjs/core", "@thexjs/core/*"];

/**
 * Transpiles each referenced route/layout/middleware/action source file
 * (TSX/TS, authored for Bun) into a standalone Node-runnable ESM module.
 *
 * We deliberately transpile file-by-file (rather than letting the final
 * bundle step follow dynamic `import()` calls) because `@thexjs/core`'s own
 * scanners find these files by walking the filesystem at *runtime* -- that
 * strategy only works on Bun, which understands `.tsx`/`.ts` natively.
 * A deployed Node.js runtime does not, so every route file that will run
 * inside the render function has to already be plain JS before it gets
 * there. `react`/`react-dom`/`@thexjs/core` stay external here; they get
 * inlined once, together, in the final bundle step so we don't duplicate
 * framework code per-route.
 *
 * All refs are compiled in a single `Bun.build` call (rather than one
 * invocation per file) so build-setup overhead is paid once no matter how
 * many routes an app has. Bun does not guarantee that `result.outputs` is
 * ordered the same way as `entrypoints`, so each output is mapped back to
 * its `ref` via the build's metafile, which records the absolute source
 * path (`entryPoint`) that produced it.
 */
export async function transpileModules(refs: CompiledModuleRef[]): Promise<void> {
  if (refs.length === 0) return;

  const result = await Bun.build({
    entrypoints: refs.map((ref) => ref.sourcePath),
    target: "node",
    format: "esm",
    splitting: false,
    external: EXTERNAL,
    metafile: true,
    throw: false,
  });

  if (!result.success) {
    throw await buildFailureError(refs, result.logs);
  }

  const refBySourcePath = new Map(refs.map((ref) => [resolve(ref.sourcePath), ref]));
  const metafileOutputs = result.metafile?.outputs ?? {};

  for (const output of result.outputs) {
    if (output.kind !== "entry-point") continue;

    const entryPoint = metafileOutputs[output.path]?.entryPoint;
    if (!entryPoint) {
      throw new Error(
        `[@thexjs/core] failed to transpile: could not determine the source file for build output "${output.path}"`,
      );
    }

    const ref = refBySourcePath.get(resolve(entryPoint));
    if (!ref) {
      throw new Error(
        `[@thexjs/core] failed to transpile: build output "${output.path}" (from ${entryPoint}) does not match any requested source file`,
      );
    }

    mkdirSync(dirname(ref.compiledPath), { recursive: true });
    await Bun.write(ref.compiledPath, await output.arrayBuffer());
  }
}

/**
 * Builds the `failed to transpile <path>` error for a failed batch,
 * attributing the failure to the specific source file whenever Bun's build
 * logs carry a `position.file` that matches one of the requested refs.
 *
 * If no log can be attributed this way (Bun's build logs don't always carry
 * file position info for every kind of failure), falls back to rebuilding
 * each entrypoint individually -- only to pinpoint which file is
 * responsible, not as the normal build path -- so the per-file error format
 * is preserved either way.
 */
async function buildFailureError(
  refs: CompiledModuleRef[],
  logs: Array<BuildMessage | ResolveMessage>,
): Promise<Error> {
  for (const ref of refs) {
    const resolvedSource = resolve(ref.sourcePath);
    const matching = logs.filter((log) => {
      const file = log.position?.file;
      return file !== undefined && file !== null && resolve(file) === resolvedSource;
    });
    if (matching.length > 0) {
      const messages = matching.map((log) => log.message).join("\n");
      return new Error(`[@thexjs/core] failed to transpile ${ref.sourcePath}:\n${messages}`);
    }
  }

  // Fallback: none of the batch's logs could be attributed to a specific
  // source file. Re-attempt one file at a time (error-path only) to find
  // the culprit.
  for (const ref of refs) {
    const single = await Bun.build({
      entrypoints: [ref.sourcePath],
      target: "node",
      format: "esm",
      splitting: false,
      external: EXTERNAL,
      throw: false,
    });
    if (!single.success) {
      const messages = single.logs.map((log) => log.message).join("\n");
      return new Error(`[@thexjs/core] failed to transpile ${ref.sourcePath}:\n${messages}`);
    }
  }

  // Should be unreachable (the batch failed, so at least one file must fail
  // individually too), but keep a sensible error just in case.
  const messages = logs.map((log) => log.message).join("\n");
  return new Error(`[@thexjs/core] failed to transpile batch:\n${messages}`);
}
