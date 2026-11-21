import { describe, expect, test } from "bun:test";
import { LIVE_RELOAD_SCRIPT } from "./live-reload";

type ScheduledTimer = { id: number; delay: number; fn: () => void; cleared: boolean };

class MockEventSource {
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Array<() => void>>();

  constructor(
    readonly url: string,
    private readonly onClose: () => void,
  ) {}

  addEventListener(type: string, fn: () => void): void {
    const list = this.listeners.get(type);
    if (list) list.push(fn);
    else this.listeners.set(type, [fn]);
  }

  close(): void {
    this.closed = true;
    this.onClose();
  }

  emit(type: string): void {
    if (type === "open") this.onopen?.();
    if (type === "error") this.onerror?.();
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
}

function createHarness(softReload = false) {
  const sources: MockEventSource[] = [];
  const timers: ScheduledTimer[] = [];
  const events: string[] = [];
  let nextId = 1;

  class TrackedEventSource extends MockEventSource {
    constructor(url: string) {
      super(url, () => events.push("close"));
      sources.push(this);
    }
  }

  const fakeSetTimeout = (fn: () => void, delay = 0): number => {
    const timer: ScheduledTimer = { id: nextId++, delay, fn, cleared: false };
    timers.push(timer);
    return timer.id;
  };
  const fakeClearTimeout = (id: number): void => {
    for (const t of timers) if (t.id === id) t.cleared = true;
  };

  const mockWindow: { location: { reload: () => void }; __xSoftReload?: () => void } = {
    location: { reload: () => events.push("hardReload") },
    ...(softReload ? { __xSoftReload: () => events.push("softReload") } : {}),
  };

  new Function("EventSource", "window", "setTimeout", "clearTimeout", LIVE_RELOAD_SCRIPT)(
    TrackedEventSource,
    mockWindow,
    fakeSetTimeout,
    fakeClearTimeout,
  );

  const pendingTimers = () => timers.filter((t) => !t.cleared);
  const fireNextTimer = (): ScheduledTimer => {
    const next = timers.find((t) => !t.cleared);
    if (!next) throw new Error("Expected a pending timer, but none were scheduled");
    next.cleared = true;
    next.fn();
    return next;
  };
  const latestSource = (): MockEventSource => {
    const last = sources[sources.length - 1];
    if (!last) throw new Error("Expected at least one EventSource instance");
    return last;
  };

  return {
    sources,
    events,
    pendingTimers,
    fireNextTimer,
    latestSource,
    activeSources: () => sources.filter((s) => !s.closed),
  };
}

describe("LIVE_RELOAD_SCRIPT", () => {
  test("connects to /__x/reload and does not reload on initial open", () => {
    const h = createHarness();
    expect(h.sources).toHaveLength(1);
    expect(h.latestSource().url).toBe("/__x/reload");

    h.latestSource().emit("open");
    expect(h.events).toEqual([]);
    expect(h.pendingTimers()).toHaveLength(0);
  });

  test("closes EventSource then reloads on SSE reload event", () => {
    const hard = createHarness(false);
    hard.latestSource().emit("reload");
    expect(hard.latestSource().closed).toBe(true);
    expect(hard.events).toEqual(["close", "hardReload"]);

    const soft = createHarness(true);
    soft.latestSource().emit("reload");
    expect(soft.latestSource().closed).toBe(true);
    expect(soft.events).toEqual(["close", "softReload"]);
  });

  test("closes the errored EventSource and reconnects after 500ms", () => {
    const h = createHarness();
    const first = h.latestSource();
    first.emit("open");

    first.emit("error");
    expect(first.closed).toBe(true);
    expect(h.sources).toHaveLength(1);
    expect(h.pendingTimers().map((t) => t.delay)).toEqual([500]);

    h.fireNextTimer();
    expect(h.sources).toHaveLength(2);
    expect(h.latestSource()).not.toBe(first);
    expect(h.latestSource().url).toBe("/__x/reload");
    expect(h.activeSources()).toHaveLength(1);
  });

  test("backs off exponentially up to a 5s cap", () => {
    const h = createHarness();
    const delays: number[] = [];

    for (let i = 0; i < 6; i++) {
      h.latestSource().emit("error");
      delays.push(h.fireNextTimer().delay);
      expect(h.activeSources()).toHaveLength(1);
    }

    expect(delays).toEqual([500, 1000, 2000, 4000, 5000, 5000]);
  });

  test("hard-reloads on first open after an error even when __xSoftReload exists", () => {
    for (const softReload of [false, true]) {
      const h = createHarness(softReload);
      h.latestSource().emit("open");
      h.latestSource().emit("error");
      h.fireNextTimer();
      expect(h.events).toEqual(["close"]);

      h.events.length = 0;
      const reconnected = h.latestSource();
      reconnected.emit("open");
      expect(reconnected.closed).toBe(true);
      expect(h.events).toEqual(["close", "hardReload"]);

      // Duplicate open on the closed instance does not reload again.
      reconnected.emit("open");
      expect(h.events).toEqual(["close", "hardReload"]);
    }
  });

  test("keeps a single timer and ignores stale EventSource errors", () => {
    const h = createHarness();
    const first = h.latestSource();

    first.emit("error");
    first.emit("error");
    expect(h.pendingTimers().map((t) => t.delay)).toEqual([500]);

    h.fireNextTimer();
    expect(h.sources).toHaveLength(2);
    expect(h.activeSources()).toHaveLength(1);

    first.emit("error");
    expect(h.pendingTimers()).toHaveLength(0);
    expect(h.latestSource().closed).toBe(false);
  });
});
