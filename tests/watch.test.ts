import { describe, expect, it, vi } from "vitest";
import { createDebouncedRunner } from "../src/core/watch.js";

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
});
