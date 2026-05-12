import chokidar from "chokidar";
import { normalize, relative, resolve, sep } from "node:path";
import { runSync } from "./sync.js";
import { enabledProviders } from "../providers/index.js";
import type { ProviderId, SyncConfig } from "../types.js";
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

function pathContains(parent: string, child: string): boolean {
  const rel = relative(normalize(resolve(parent)), normalize(resolve(child)));
  return rel === "" || (!rel.startsWith("..") && rel !== ".." && !rel.startsWith(`..${sep}`));
}

export function providerIdsForChangedPath(config: SyncConfig, changedPath: string): ProviderId[] {
  return enabledProviders(config)
    .filter((provider) => (provider.watchPaths?.(config) ?? []).some((watchPath) => pathContains(watchPath, changedPath)))
    .map((provider) => provider.id);
}

export function createWatcher(config: SyncConfig): FSWatcher | undefined {
  const watchPaths = enabledProviders(config).flatMap((provider) => provider.watchPaths?.(config) ?? []);
  const uniqueWatchPaths = [...new Set(watchPaths)];

  if (uniqueWatchPaths.length === 0) {
    return undefined;
  }

  let fullSyncRequired = false;
  let pendingProviderIds = new Set<ProviderId>();

  const sync = createDebouncedRunner(async () => {
    const providerIds = fullSyncRequired ? undefined : [...pendingProviderIds];
    fullSyncRequired = false;
    pendingProviderIds = new Set<ProviderId>();

    const result = await runSync(config, providerIds && providerIds.length > 0 ? { providerIds } : {});
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

  const queueSync = (changedPath: string) => {
    const providerIds = providerIdsForChangedPath(config, changedPath);
    if (providerIds.length === 0) {
      fullSyncRequired = true;
    } else if (!fullSyncRequired) {
      for (const providerId of providerIds) {
        pendingProviderIds.add(providerId);
      }
    }
    sync();
  };

  const watcher = chokidar.watch(uniqueWatchPaths, watcherOptions);
  watcher.on("add", queueSync);
  watcher.on("change", queueSync);
  watcher.on("unlink", queueSync);
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
    return;
  }

  return new Promise(() => undefined);
}
