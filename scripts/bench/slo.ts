/**
 * SLO definitions and evaluation for the load-test gate (#78).
 *
 * The benchmark harness (load.ts) measures per-scenario latency percentiles
 * and error rates. These thresholds are the agreed performance contract: a
 * run that violates any of them FAILS the build, so performance regressions
 * surface in CI instead of being reported and ignored.
 *
 * Numbers were chosen against the production-mode request pipeline measured on
 * a 2-core CI runner baseline (see BENCHMARKS.md for methodology and the full
 * numbers). They are deliberately lenient enough to absorb runner noise while
 * still catching real regressions (a 3-10x latency blow-up, or any meaningful
 * error rate).
 */

export interface ScenarioResult {
  /** Stable scenario id used in reports, e.g. "ssr-page". */
  name: string;
  /** p95 latency in milliseconds. */
  p95: number;
  /** Total requests completed in the window. */
  count: number;
  /** Requests that returned >= 500 or threw. */
  errors: number;
}

export interface SloThresholds {
  /** Max acceptable p95 latency for any measured scenario, in ms. */
  p95Ms: number;
  /** Max acceptable error rate (0.05 = 5%) for any measured scenario. */
  maxErrorRate: number;
}

export interface SloViolation {
  scenario: string;
  kind: "p95" | "error-rate" | "restart-time";
  actual: number;
  limit: number;
  unit: string;
}

export interface SloResult {
  passed: boolean;
  violations: SloViolation[];
}

/** Default SLOs used by `bun scripts/bench/load.ts --slo` and CI. */
export const DEFAULT_SLOS: SloThresholds = {
  p95Ms: 500,
  maxErrorRate: 0.001,
};

/**
 * Pinned metric added by #129: the crash-recovery scenario (crash-recovery.ts)
 * kill -9's the server mid-run and measures the time from that kill to the
 * respawned process serving its first successful request. 5s is deliberately
 * loose versus a local run (sub-second: spawn a Bun process + boot the app) to
 * absorb a shared CI runner's scheduling noise, while still catching a real
 * regression — e.g. something making app boot itself slow, or the respawn
 * logic hanging.
 */
export const DEFAULT_MAX_RESTART_MS = 5000;

/**
 * Pure SLO check, kept side-effect free so it is unit-testable as the "proof"
 * that a regression fails the job.
 */
export function evaluateSlo(
  scenarios: ScenarioResult[],
  thresholds: SloThresholds = DEFAULT_SLOS,
): SloResult {
  const violations: SloViolation[] = [];
  for (const scenario of scenarios) {
    if (scenario.count === 0) {
      violations.push({
        scenario: scenario.name,
        kind: "error-rate",
        actual: 1,
        limit: thresholds.maxErrorRate,
        unit: " (no requests completed)",
      });
      continue;
    }
    if (scenario.p95 > thresholds.p95Ms) {
      violations.push({
        scenario: scenario.name,
        kind: "p95",
        actual: scenario.p95,
        limit: thresholds.p95Ms,
        unit: "ms",
      });
    }
    const errorRate = scenario.errors / scenario.count;
    if (errorRate > thresholds.maxErrorRate) {
      violations.push({
        scenario: scenario.name,
        kind: "error-rate",
        actual: errorRate,
        limit: thresholds.maxErrorRate,
        unit: "",
      });
    }
  }
  return { passed: violations.length === 0, violations };
}

/**
 * Pure check for the crash-recovery restart-time pinned metric (#129). Kept
 * side-effect free and separate from `evaluateSlo`, which checks per-scenario
 * request latency/error-rate — restart time isn't a request latency, it's
 * "how long the server was unreachable after a hard crash", so it gets its
 * own violation kind instead of being shoehorned into `ScenarioResult`.
 */
export function evaluateRestartSlo(
  scenario: string,
  restartMs: number,
  maxRestartMs: number = DEFAULT_MAX_RESTART_MS,
): SloResult {
  if (restartMs > maxRestartMs) {
    return {
      passed: false,
      violations: [
        { scenario, kind: "restart-time", actual: restartMs, limit: maxRestartMs, unit: "ms" },
      ],
    };
  }
  return { passed: true, violations: [] };
}

/** Render violations as human-readable reporter lines for the CI step. */
export function formatViolations(violations: SloViolation[]): string {
  if (violations.length === 0) return "SLO check passed";
  return violations
    .map((v) => {
      const kind =
        v.kind === "p95"
          ? "p95 latency"
          : v.kind === "restart-time"
            ? "restart time"
            : "error rate";
      if (v.kind === "error-rate" && v.unit.includes("(no requests")) {
        return `  ✗ ${v.scenario}: ${kind} ${v.unit}`;
      }
      const actual = v.kind === "error-rate" ? `${(v.actual * 100).toFixed(2)}%` : `${v.actual}ms`;
      const limit = v.kind === "error-rate" ? `${(v.limit * 100).toFixed(2)}%` : `${v.limit}ms`;
      return `  ✗ ${v.scenario}: ${kind} ${actual} exceeds SLO ${limit}`;
    })
    .join("\n");
}
