import { describe, expect, it, vi } from "vitest";
import { createDebouncedRunner, providerIdsForChangedPath, runWatch, watcherOptions } from "../src/core/watch.js";
import type { SyncConfig } from "../src/types.js";

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

describe("providerIdsForChangedPath", () => {
  it("returns only providers whose watch path contains the changed file", () => {
    const config: SyncConfig = {
      projectRoots: [],
      centralArchiveDir: "/archive",
      unknownProjectDir: "/unknown",
      projectArchiveDir: ".agents/chats",
      providers: {
        codex: { enabled: true, paths: ["/tmp/provider/codex"] },
        cursor: { enabled: true, paths: ["/tmp/provider/cursor"] },
      },
    };

    expect(providerIdsForChangedPath(config, "/tmp/provider/codex/session.jsonl")).toEqual(["codex"]);
  });

  it("does not match paths that only share a prefix", () => {
    const config: SyncConfig = {
      projectRoots: [],
      centralArchiveDir: "/archive",
      unknownProjectDir: "/unknown",
      projectArchiveDir: ".agents/chats",
      providers: {
        codex: { enabled: true, paths: ["/tmp/provider/codex"] },
      },
    };

    expect(providerIdsForChangedPath(config, "/tmp/provider/codex-backup/session.jsonl")).toEqual([]);
  });
});

describe("runWatch", () => {
  it("returns after logging when no provider watch paths are enabled", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      runWatch({
        projectRoots: [],
        centralArchiveDir: "/archive",
        unknownProjectDir: "/unknown",
        projectArchiveDir: ".agents/chats",
        providers: {},
      })
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith("agent-sync watch: no enabled provider watch paths");
    log.mockRestore();
  });
});
