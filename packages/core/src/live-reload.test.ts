import { describe, expect, test } from "bun:test";
import { LIVE_RELOAD_SCRIPT } from "./live-reload";

interface ScheduledTimer {
  id: number;
  delay: number;
  fn: () => void;
  cleared: boolean;
}

class MockEventSource {
  readonly url: string;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type);
    if (list) {
      list.push(listener);
    } else {
      this.listeners.set(type, [listener]);
    }
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string): void {
    if (type === "open" && this.onopen) {
      this.onopen();
    }
    if (type === "error" && this.onerror) {
      this.onerror();
    }
    const list = this.listeners.get(type);
    if (list) {
      for (const listener of list) {
        listener();
      }
    }
  }
}

interface HarnessOptions {
  softReload?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const sources: MockEventSource[] = [];
  const timers: ScheduledTimer[] = [];
  let nextTimerId = 1;
  let hardReloadCalls = 0;
  let softReloadCalls = 0;

  class TrackedEventSource extends MockEventSource {
    constructor(url: string) {
      super(url);
      sources.push(this);
    }
  }

  const fakeSetTimeout = (fn: () => void, delay = 0): number => {
    const timer: ScheduledTimer = {
      id: nextTimerId++,
      delay,
      fn,
      cleared: false,
    };
    timers.push(timer);
    return timer.id;
  };

  const fakeClearTimeout = (id: number): void => {
    for (const timer of timers) {
      if (timer.id === id) {
        timer.cleared = true;
      }
    }
  };

  const mockWindow: {
    location: { reload: () => void };
    __xSoftReload?: () => void;
  } = {
    location: {
      reload: () => {
        hardReloadCalls++;
      },
    },
  };

  if (options.softReload) {
    mockWindow.__xSoftReload = () => {
      softReloadCalls++;
    };
  }

  const run = new Function(
    "EventSource",
    "window",
    "setTimeout",
    "clearTimeout",
    LIVE_RELOAD_SCRIPT,
  );
  run(TrackedEventSource, mockWindow, fakeSetTimeout, fakeClearTimeout);

  const pendingTimers = () => timers.filter((t) => !t.cleared);

  const fireNextTimer = (): ScheduledTimer => {
    const next = timers.find((t) => !t.cleared);
    if (!next) {
      throw new Error("Expected a pending timer, but none were scheduled");
    }
    next.cleared = true;
    next.fn();
    return next;
  };

  const latestSource = (): MockEventSource => {
    const last = sources[sources.length - 1];
    if (!last) {
      throw new Error("Expected at least one EventSource instance");
    }
    return last;
  };

  return {
    sources,
    timers,
    pendingTimers,
    fireNextTimer,
    latestSource,
    activeSources: () => sources.filter((s) => !s.closed),
    get hardReloadCalls() {
      return hardReloadCalls;
    },
    get softReloadCalls() {
      return softReloadCalls;
    },
  };
}

describe("LIVE_RELOAD_SCRIPT", () => {
  test("connects to /__x/reload and does not reload on initial open", () => {
    const h = createHarness();
    expect(h.sources).toHaveLength(1);
    expect(h.latestSource().url).toBe("/__x/reload");

    h.latestSource().emit("open");
    expect(h.hardReloadCalls).toBe(0);
    expect(h.softReloadCalls).toBe(0);
    expect(h.pendingTimers()).toHaveLength(0);
  });

  test("reloads on SSE reload event via location.reload or __xSoftReload", () => {
    const hard = createHarness();
    hard.latestSource().emit("reload");
    expect(hard.latestSource().closed).toBe(true);
    expect(hard.hardReloadCalls).toBe(1);

    const soft = createHarness({ softReload: true });
    soft.latestSource().emit("reload");
    expect(soft.softReloadCalls).toBe(1);
    expect(soft.hardReloadCalls).toBe(0);
    // Soft reload swaps #root without re-running the inline script, so keep
    // the SSE stream open for subsequent reloads.
    expect(soft.latestSource().closed).toBe(false);
    soft.latestSource().emit("reload");
    expect(soft.softReloadCalls).toBe(2);
  });

  test("closes the errored EventSource and reconnects after the initial delay", () => {
    const h = createHarness();
    const first = h.latestSource();
    first.emit("open");

    first.emit("error");
    expect(first.closed).toBe(true);
    expect(h.sources).toHaveLength(1);
    expect(h.pendingTimers()).toHaveLength(1);
    expect(h.pendingTimers()[0]?.delay).toBe(500);

    h.fireNextTimer();
    expect(h.sources).toHaveLength(2);
    expect(h.latestSource()).not.toBe(first);
    expect(h.latestSource().url).toBe("/__x/reload");
    expect(h.activeSources()).toHaveLength(1);
  });

  test("grows reconnect backoff exponentially up to a 5s cap and resets after open", () => {
    const h = createHarness({ softReload: true });
    const observedDelays: number[] = [];

    for (let i = 0; i < 6; i++) {
      h.latestSource().emit("error");
      const timer = h.fireNextTimer();
      observedDelays.push(timer.delay);
      expect(h.activeSources()).toHaveLength(1);
    }

    expect(observedDelays).toEqual([500, 1000, 2000, 4000, 5000, 5000]);

    // Successful reconnect resets backoff back to 500ms.
    h.latestSource().emit("open");
    expect(h.softReloadCalls).toBe(1);

    h.latestSource().emit("error");
    expect(h.pendingTimers()).toHaveLength(1);
    expect(h.pendingTimers()[0]?.delay).toBe(500);
  });

  test("triggers a hard reload on first open after an error when __xSoftReload is absent", () => {
    const h = createHarness();
    h.latestSource().emit("open");
    expect(h.hardReloadCalls).toBe(0);

    h.latestSource().emit("error");
    h.fireNextTimer();
    expect(h.hardReloadCalls).toBe(0);

    const reconnected = h.latestSource();
    reconnected.emit("open");
    expect(h.hardReloadCalls).toBe(1);
    expect(reconnected.closed).toBe(true);
  });

  test("triggers __xSoftReload on first open after an error and stays connected", () => {
    const h = createHarness({ softReload: true });
    h.latestSource().emit("open");
    expect(h.softReloadCalls).toBe(0);

    h.latestSource().emit("error");
    h.fireNextTimer();
    h.latestSource().emit("open");
    expect(h.softReloadCalls).toBe(1);
    expect(h.hardReloadCalls).toBe(0);
    expect(h.latestSource().closed).toBe(false);

    // Subsequent open without a preceding error does not reload again.
    h.latestSource().emit("open");
    expect(h.softReloadCalls).toBe(1);
  });

  test("ignores duplicate error events on an already-closed EventSource", () => {
    const h = createHarness();
    const first = h.latestSource();

    first.emit("error");
    first.emit("error");

    expect(h.pendingTimers()).toHaveLength(1);
    expect(h.pendingTimers()[0]?.delay).toBe(500);

    h.fireNextTimer();
    expect(h.sources).toHaveLength(2);
    expect(h.activeSources()).toHaveLength(1);

    // Stale error on the old closed instance does not disrupt the active one.
    first.emit("error");
    expect(h.pendingTimers()).toHaveLength(0);
    expect(h.latestSource().closed).toBe(false);
  });
});
