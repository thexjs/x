import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getServerFunctionHandler,
  registerServerFunctions,
  resetServerFunctions,
} from "./server-functions";

/**
 * Regression coverage for #161: routing used to call `routePatternToRegex`
 * (i.e. `new RegExp(...)`) for every candidate route on every request, so a
 * request matching a route late in the scan order paid for a fresh,
 * immediately-garbage-collected RegExp compilation per route checked before
 * it, on every single request. The fix precompiles each route's matcher
 * once (at route-registration/scan time) and stores it on the route entry,
 * so request-time matching is a pure `RegExp#exec`/`String#match` against an
 * already-built object.
 *
 * This test overrides the global `RegExp` constructor to count how many
 * `new RegExp(...)` calls happen, then asserts that dispatching several
 * requests against a late-matched route causes zero *additional*
 * constructions beyond the one-time cost of registering the routes.
 */

let originalRegExp: typeof RegExp;
let constructedCount = 0;

function installCountingRegExp() {
  constructedCount = 0;
  class CountingRegExp extends originalRegExp {
    constructor(...args: ConstructorParameters<typeof RegExp>) {
      super(...args);
      constructedCount++;
    }
  }
  // biome-ignore lint/suspicious/noGlobalAssign: deliberately instrumenting the global constructor for this test only
  RegExp = CountingRegExp as unknown as typeof RegExp;
}

function uninstallCountingRegExp() {
  // biome-ignore lint/suspicious/noGlobalAssign: restoring the global constructor after instrumenting it above
  RegExp = originalRegExp;
}

function post(path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { origin: "http://localhost", "Content-Type": "application/json" },
    body: "[]",
  });
}

beforeEach(() => {
  originalRegExp = RegExp;
  resetServerFunctions();
});

afterEach(() => {
  uninstallCountingRegExp();
  resetServerFunctions();
});

describe("routing regex precompilation (#161)", () => {
  test("matching a late-matched action route constructs zero new RegExps per request", async () => {
    // Register many routes that sort ahead of the one we'll actually hit, so
    // the target route is checked last on every dispatch -- the worst case
    // for a per-route-per-request recompilation bug.
    for (let i = 0; i < 25; i++) {
      registerServerFunctions(`/literal-route-${String(i).padStart(2, "0")}`, [], {
        ping: async () => "no",
      });
    }
    registerServerFunctions("/workspace/:id/late", ["id"], {
      ping: async () => "yes",
    });

    const handler = getServerFunctionHandler();

    // Registration itself compiles each route's matcher once -- that's the
    // expected one-time cost. Start counting only once routes are settled.
    installCountingRegExp();

    for (let i = 0; i < 10; i++) {
      const res = await handler(post(`/__x/actions/workspace/w-${i}/late/ping`));
      expect(res?.status).toBe(200);
      expect(await res?.json()).toBe("yes");
    }

    expect(constructedCount).toBe(0);
  });

  test("registering a route compiles its matcher exactly once even across repeated dispatch", async () => {
    installCountingRegExp();

    registerServerFunctions("/items/:id", ["id"], { get: async () => "ok" });
    const afterRegister = constructedCount;
    expect(afterRegister).toBeGreaterThan(0);

    const handler = getServerFunctionHandler();
    for (let i = 0; i < 5; i++) {
      await handler(post(`/__x/actions/items/${i}/get`));
    }

    // No further RegExp construction after the initial registration.
    expect(constructedCount).toBe(afterRegister);
  });
});
