import chokidar from "chokidar";
import { runSync } from "./sync.js";
import { enabledProviders } from "../providers/index.js";
import type { SyncConfig } from "../types.js";

export function createDebouncedRunner(run: () => void | Promise<void>, delayMs: number): () => void {
  let timeout: NodeJS.Timeout | undefined;

  return () => {
    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      timeout = undefined;
      void run();
    }, delayMs);
  };
}

export async function runWatch(config: SyncConfig): Promise<void> {
  const watchPaths = enabledProviders(config).flatMap((provider) => provider.watchPaths?.(config) ?? []);
  const uniqueWatchPaths = [...new Set(watchPaths)];

  if (uniqueWatchPaths.length === 0) {
    console.log("agent-sync watch: no enabled provider watch paths");
    return new Promise(() => undefined);
  }

  const sync = createDebouncedRunner(async () => {
    try {
      const result = await runSync(config);
      console.log(`agent-sync sync complete: written ${result.written}, skipped ${result.skipped}`);

      for (const diagnostic of result.diagnostics) {
        const source = diagnostic.sourcePath ? ` ${diagnostic.sourcePath}` : "";
        const provider = diagnostic.provider ? ` ${diagnostic.provider}` : "";
        console.error(`${diagnostic.level}:${provider}${source} ${diagnostic.message}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`error: sync failed: ${message}`);
    }
  }, 500);

  const watcher = chokidar.watch(uniqueWatchPaths, {
    ignoreInitial: true,
    persistent: true,
  });
  watcher.on("add", sync);
  watcher.on("change", sync);
  watcher.on("unlink", sync);
  watcher.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: watch failed: ${message}`);
  });

  console.log(`agent-sync watch: watching ${uniqueWatchPaths.length} path(s)`);
  return new Promise(() => undefined);
}
