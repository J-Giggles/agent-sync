import { describe, expect, it, vi } from "vitest";
import { createDebouncedRunner, watcherOptions } from "../src/core/watch.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("createDebouncedRunner", () => {
  it("collapses repeated calls into one run", async () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const debounced = createDebouncedRunner(run, 500);

    debounced();
    debounced();
    debounced();
    await vi.advanceTimersByTimeAsync(500);

    expect(run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("catches rejected async runs", async () => {
    vi.useFakeTimers();
    const error = new Error("sync failed");
    const onError = vi.fn();
    const debounced = createDebouncedRunner(() => Promise.reject(error), 500, { onError });

    debounced();
    await vi.advanceTimersByTimeAsync(500);

    expect(onError).toHaveBeenCalledWith(error);
    vi.useRealTimers();
  });

  it("does not overlap async runs and schedules a trailing run", async () => {
    vi.useFakeTimers();
    const first = deferred();
    const run = vi.fn(() => first.promise);
    const debounced = createDebouncedRunner(run, 500);

    debounced();
    await vi.advanceTimersByTimeAsync(500);
    debounced();
    await vi.advanceTimersByTimeAsync(500);

    expect(run).toHaveBeenCalledTimes(1);

    first.resolve();
    await vi.runAllTimersAsync();

    expect(run).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("watcherOptions", () => {
  it("does not follow symlinks and waits for stable writes", () => {
    expect(watcherOptions.followSymlinks).toBe(false);
    expect(watcherOptions.awaitWriteFinish).toEqual({
      stabilityThreshold: 500,
      pollInterval: 100,
    });
  });
});
