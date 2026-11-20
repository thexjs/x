import { describe, expect, test } from "bun:test";
import type { ScenarioResult } from "./slo";
import {
  DEFAULT_MAX_RESTART_MS,
  DEFAULT_SLOS,
  evaluateRestartSlo,
  evaluateSlo,
  formatViolations,
} from "./slo";

/**
 * Scripted proof for the "a regression against an SLO causes the job to fail"
 * acceptance criterion (#78): the same pure function the CI gate calls must
 * flag an over-limit run and pass a healthy one.
 */

function result(over: Partial<ScenarioResult>): ScenarioResult {
  return {
    name: "test",
    p95: 10,
    count: 1000,
    errors: 0,
    ...over,
  };
}

describe("evaluateSlo", () => {
  test("passes a healthy run within SLO", () => {
    const res = evaluateSlo([result({ p95: 84, count: 1000 })], DEFAULT_SLOS);
    expect(res.passed).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  test("fails when p95 latency regresses past the SLO", () => {
    const res = evaluateSlo(
      [{ name: "ssr-page", p95: DEFAULT_SLOS.p95Ms + 1, count: 1000, errors: 0 }],
      DEFAULT_SLOS,
    );
    expect(res.passed).toBe(false);
    expect(res.violations).toEqual([
      {
        scenario: "ssr-page",
        kind: "p95",
        actual: DEFAULT_SLOS.p95Ms + 1,
        limit: DEFAULT_SLOS.p95Ms,
        unit: "ms",
      },
    ]);
  });

  test("fails when the error rate regresses past the SLO", () => {
    const res = evaluateSlo([{ name: "server-fn", p95: 5, count: 1000, errors: 10 }], {
      ...DEFAULT_SLOS,
      maxErrorRate: 0.001,
    });
    expect(res.passed).toBe(false);
    expect(res.violations[0]).toMatchObject({
      scenario: "server-fn",
      kind: "error-rate",
    });
  });

  test("gates a run where nothing was served as an error-rate violation", () => {
    const res = evaluateSlo([result({ count: 0 })], DEFAULT_SLOS);
    expect(res.passed).toBe(false);
  });

  test("formatViolations renders the reporter output", () => {
    const out = formatViolations([
      { scenario: "ssr-page", kind: "p95", actual: 900, limit: 500, unit: "ms" },
    ]);
    expect(out).toContain("ssr-page");
    expect(out).toContain("900ms exceeds SLO 500ms");
  });
});

/**
 * Scripted proof for the crash-recovery restart-time pinned metric (#129):
 * the same pure function the CI gate calls must flag a slow restart and pass
 * a fast one.
 */
describe("evaluateRestartSlo", () => {
  test("passes a restart well within the bound", () => {
    const res = evaluateRestartSlo("crash-recovery", 1200, DEFAULT_MAX_RESTART_MS);
    expect(res.passed).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  test("fails when the restart takes longer than the bound", () => {
    const res = evaluateRestartSlo(
      "crash-recovery",
      DEFAULT_MAX_RESTART_MS + 1,
      DEFAULT_MAX_RESTART_MS,
    );
    expect(res.passed).toBe(false);
    expect(res.violations).toEqual([
      {
        scenario: "crash-recovery",
        kind: "restart-time",
        actual: DEFAULT_MAX_RESTART_MS + 1,
        limit: DEFAULT_MAX_RESTART_MS,
        unit: "ms",
      },
    ]);
  });

  test("formatViolations renders a restart-time violation", () => {
    const out = formatViolations([
      { scenario: "crash-recovery", kind: "restart-time", actual: 6000, limit: 5000, unit: "ms" },
    ]);
    expect(out).toContain("crash-recovery");
    expect(out).toContain("restart time 6000ms exceeds SLO 5000ms");
  });
});
