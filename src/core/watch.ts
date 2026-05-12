import chokidar from "chokidar";
import { runSync } from "./sync.js";
import { enabledProviders } from "../providers/index.js";
import type { SyncConfig } from "../types.js";
import type { ChokidarOptions, FSWatcher } from "chokidar";

export type DebouncedRunnerOptions = {
  onError?: (error: unknown) => void;
};

export const watcherOptions: ChokidarOptions = {
  ignoreInitial: true,
  persistent: true,
  followSymlinks: false,
  awaitWriteFinish: {
    stabilityThreshold: 500,
    pollInterval: 100,
  },
};

export function createDebouncedRunner(
  run: () => void | Promise<void>,
  delayMs: number,
  options: DebouncedRunnerOptions = {}
): () => void {
  let timeout: NodeJS.Timeout | undefined;
  let running = false;
  let pendingAfterRun = false;

  const execute = async () => {
    timeout = undefined;
    running = true;
    try {
      await run();
    } catch (error) {
      options.onError?.(error);
    } finally {
      running = false;
      if (pendingAfterRun) {
        pendingAfterRun = false;
        timeout = setTimeout(() => {
          void execute();
        }, delayMs);
      }
    }
  };

  const schedule = () => {
    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      void execute();
    }, delayMs);
  };

  return () => {
    if (running) {
      pendingAfterRun = true;
      return;
    }

    schedule();
  };
}

export function createWatcher(config: SyncConfig): FSWatcher | undefined {
  const watchPaths = enabledProviders(config).flatMap((provider) => provider.watchPaths?.(config) ?? []);
  const uniqueWatchPaths = [...new Set(watchPaths)];

  if (uniqueWatchPaths.length === 0) {
    return undefined;
  }

  const sync = createDebouncedRunner(async () => {
    const result = await runSync(config);
    console.log(`agent-sync sync complete: written ${result.written}, skipped ${result.skipped}`);

    for (const diagnostic of result.diagnostics) {
      const source = diagnostic.sourcePath ? ` ${diagnostic.sourcePath}` : "";
      const provider = diagnostic.provider ? ` ${diagnostic.provider}` : "";
      console.error(`${diagnostic.level}:${provider}${source} ${diagnostic.message}`);
    }
  }, 500, {
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`error: sync failed: ${message}`);
    },
  });

  const watcher = chokidar.watch(uniqueWatchPaths, watcherOptions);
  watcher.on("add", sync);
  watcher.on("change", sync);
  watcher.on("unlink", sync);
  watcher.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: watch failed: ${message}`);
  });

  console.log(`agent-sync watch: watching ${uniqueWatchPaths.length} path(s)`);
  return watcher;
}

export async function runWatch(config: SyncConfig): Promise<void> {
  const watcher = createWatcher(config);
  if (!watcher) {
    console.log("agent-sync watch: no enabled provider watch paths");
  }

  return new Promise(() => undefined);
}
