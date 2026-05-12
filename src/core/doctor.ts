import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { expandHomePath } from "./path-utils.js";
import { discoverProjects } from "./projects.js";
import { enabledProviders } from "../providers/index.js";
import type { SyncConfig, SyncDiagnostic } from "../types.js";

async function inspectDirectory(path: string): Promise<"ok" | "missing" | "not-directory" | "inaccessible"> {
  let stats;
  try {
    stats = await stat(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "inaccessible";
  }

  if (!stats.isDirectory()) {
    return "not-directory";
  }

  try {
    await access(path, constants.R_OK);
    return "ok";
  } catch {
    return "inaccessible";
  }
}

function diagnosticForDirectory(kind: "project" | "provider" | "central-parent", path: string): SyncDiagnostic {
  const label =
    kind === "project" ? "Project root" : kind === "provider" ? "Provider path" : "Central archive parent";

  return { level: "info", message: `${label} exists: ${path}` };
}

function warningForDirectory(
  kind: "project" | "provider" | "central-parent",
  path: string,
  status: "missing" | "not-directory" | "inaccessible"
): SyncDiagnostic {
  const label =
    kind === "project" ? "Project root" : kind === "provider" ? "Provider path" : "Central archive parent";
  const reason =
    status === "missing" ? "missing" : status === "not-directory" ? "is not a directory" : "is not readable";

  return { level: "warn", message: `${label} ${reason}: ${path}` };
}

async function countJsonAndMarkdownFiles(root: string): Promise<number> {
  if ((await inspectDirectory(root)) !== "ok") {
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
  const projects = await discoverProjects(config.projectRoots);

  for (const projectRoot of config.projectRoots) {
    const expandedRoot = expandHomePath(projectRoot);
    const status = await inspectDirectory(expandedRoot);
    diagnostics.push(
      status === "ok" ? diagnosticForDirectory("project", expandedRoot) : warningForDirectory("project", expandedRoot, status)
    );
  }

  diagnostics.push({
    level: "info",
    message: `Discovered projects: ${projects.length}${projects.length > 0 ? ` (${projects.map((project) => project.name).join(", ")})` : ""}`,
  });

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
      const status = await inspectDirectory(path);
      const diagnostic =
        status === "ok" ? diagnosticForDirectory("provider", path) : warningForDirectory("provider", path, status);
      diagnostics.push({ ...diagnostic, provider: provider.id, sourcePath: path });
    }

    if (!config.providers[provider.id]?.paths?.length) {
      diagnostics.push({
        level: "info",
        provider: provider.id,
        message: "Provider discover/read skipped: no configured paths",
      });
      continue;
    }

    let refs;
    try {
      refs = await provider.discover(config);
      diagnostics.push({
        level: "info",
        provider: provider.id,
        message: `Provider records discovered: ${refs.length}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        level: "error",
        provider: provider.id,
        message: `Failed to discover provider records: ${message}`,
      });
      continue;
    }

    for (const ref of refs) {
      try {
        await provider.read(ref);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        diagnostics.push({
          level: "error",
          provider: provider.id,
          sourcePath: ref.path,
          message: `Failed to read conversation: ${message}`,
        });
      }
    }
  }

  const centralArchiveDir = expandHomePath(config.centralArchiveDir);
  const centralArchiveParent = dirname(centralArchiveDir);
  const centralParentStatus = await inspectDirectory(centralArchiveParent);
  diagnostics.push(
    centralParentStatus === "ok"
      ? diagnosticForDirectory("central-parent", centralArchiveParent)
      : warningForDirectory("central-parent", centralArchiveParent, centralParentStatus)
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
