import { readdir, stat } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { expandHomePath } from "./path-utils.js";
import { enabledProviders } from "../providers/index.js";
import type { SyncConfig, SyncDiagnostic } from "../types.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function countJsonAndMarkdownFiles(root: string): Promise<number> {
  if (!(await pathExists(root))) {
    return 0;
  }

  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => {
    if (!entry.isFile()) return false;
    const extension = extname(entry.name).toLowerCase();
    return extension === ".json" || extension === ".md";
  }).length;
}

export async function runDoctor(config: SyncConfig): Promise<SyncDiagnostic[]> {
  const diagnostics: SyncDiagnostic[] = [];

  for (const projectRoot of config.projectRoots) {
    const expandedRoot = expandHomePath(projectRoot);
    diagnostics.push(
      (await pathExists(expandedRoot))
        ? { level: "info", message: `Project root exists: ${expandedRoot}` }
        : { level: "warn", message: `Project root missing: ${expandedRoot}` }
    );
  }

  for (const provider of enabledProviders(config)) {
    const paths = provider.watchPaths?.(config) ?? [];
    if (paths.length === 0) {
      diagnostics.push({
        level: "warn",
        provider: provider.id,
        message: `Provider has no watch paths: ${provider.label}`,
      });
      continue;
    }

    for (const path of paths) {
      diagnostics.push(
        (await pathExists(path))
          ? { level: "info", provider: provider.id, sourcePath: path, message: `Provider path exists: ${path}` }
          : { level: "warn", provider: provider.id, sourcePath: path, message: `Provider path missing: ${path}` }
      );
    }
  }

  const centralArchiveDir = expandHomePath(config.centralArchiveDir);
  const centralArchiveParent = dirname(centralArchiveDir);
  diagnostics.push(
    (await pathExists(centralArchiveParent))
      ? { level: "info", message: `Central archive parent exists: ${centralArchiveParent}` }
      : { level: "warn", message: `Central archive parent missing: ${centralArchiveParent}` }
  );

  const unknownProjectDir = expandHomePath(config.unknownProjectDir);
  const unknownProjectCount = await countJsonAndMarkdownFiles(unknownProjectDir);
  diagnostics.push({
    level: "info",
    sourcePath: unknownProjectDir,
    message: `Unknown-project archive files: ${unknownProjectCount}`,
  });

  return diagnostics;
}
