#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runDoctor } from "./core/doctor.js";
import { expandHomePath } from "./core/path-utils.js";
import { discoverProjects } from "./core/projects.js";
import { runSync } from "./core/sync.js";
import { runWatch } from "./core/watch.js";
import { loadConfig } from "./config.js";
import { enabledProviders } from "./providers/index.js";
import type { SyncConfig, SyncDiagnostic } from "./types.js";

type SyncManifest = {
  updatedAt?: string;
  written?: number;
  skipped?: number;
  diagnostics?: SyncDiagnostic[];
  conversations?: Array<{
    provider?: string;
    sourcePath?: string;
    projectName?: string;
    updatedAt?: string;
    outputs?: string[];
  }>;
};

export type StatusResult = {
  level: "info" | "error";
  lines: string[];
};

const program = new Command();

function printDiagnostic(diagnostic: SyncDiagnostic): void {
  const source = diagnostic.sourcePath ? ` ${diagnostic.sourcePath}` : "";
  const provider = diagnostic.provider ? ` ${diagnostic.provider}` : "";
  const output = `${diagnostic.level}:${provider}${source} ${diagnostic.message}`;

  if (diagnostic.level === "info") {
    console.log(output);
  } else {
    console.error(output);
  }
}

async function countJsonAndMarkdownFiles(root: string): Promise<number> {
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    return entries.filter((entry) => {
      if (!entry.isFile()) return false;
      const extension = extname(entry.name).toLowerCase();
      return extension === ".json" || extension === ".md";
    }).length;
  } catch {
    return 0;
  }
}

export async function readStatus(config: SyncConfig): Promise<StatusResult> {
  const manifestPath = join(expandHomePath(config.centralArchiveDir), ".agent-sync-manifest.json");
  const enabledProviderIds = enabledProviders(config).map((provider) => provider.id);
  const projects = await discoverProjects(config.projectRoots);
  const unknownProjectCount = await countJsonAndMarkdownFiles(expandHomePath(config.unknownProjectDir));

  let manifest: SyncManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as SyncManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        level: "info",
        lines: [`No sync manifest found at ${manifestPath}. Run agent-sync sync first.`],
      };
    }

    if (error instanceof SyntaxError) {
      return {
        level: "error",
        lines: [`Could not parse sync manifest at ${manifestPath}: ${error.message}`],
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      level: "error",
      lines: [`Could not read sync manifest at ${manifestPath}: ${message}`],
    };
  }

  const latestConversations = (manifest.conversations ?? [])
    .filter((conversation) => Array.isArray(conversation.outputs) && conversation.outputs.length > 0)
    .sort((a, b) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? ""))
    .slice(0, 5);
  const latestLines =
    latestConversations.length > 0
      ? latestConversations.map((conversation) => {
          const label = [
            conversation.provider ?? "unknown-provider",
            conversation.projectName ? `project ${conversation.projectName}` : "unknown project",
            conversation.updatedAt ?? "unknown time",
          ].join(" | ");
          return `  - ${label}: ${conversation.outputs?.join(", ")}`;
        })
      : ["  none recorded"];

  return {
    level: "info",
    lines: [
      `manifest: ${manifestPath}`,
      `enabled providers: ${enabledProviderIds.length > 0 ? enabledProviderIds.join(", ") : "none"}`,
      `discovered projects: ${projects.length}${projects.length > 0 ? ` (${projects.map((project) => project.name).join(", ")})` : ""}`,
      `updated: ${manifest.updatedAt ?? "unknown"}`,
      `written: ${manifest.written ?? 0}`,
      `skipped: ${manifest.skipped ?? 0}`,
      `diagnostics: ${manifest.diagnostics?.length ?? 0}`,
      "latest synced conversations:",
      ...latestLines,
      `unknown-project archive files: ${unknownProjectCount}`,
    ],
  };
}

async function printStatus(config: SyncConfig): Promise<void> {
  const status = await readStatus(config);
  const output = status.level === "error" ? console.error : console.log;
  for (const line of status.lines) {
    output(line);
  }
}

program.name("agent-sync").description("Sync local agent chat histories").version("0.1.0");

program.command("sync").description("Run one-shot chat sync").action(async () => {
  const config = await loadConfig();
  const result = await runSync(config);
  console.log(`written: ${result.written}`);
  console.log(`skipped: ${result.skipped}`);

  for (const diagnostic of result.diagnostics) {
    printDiagnostic(diagnostic);
  }
});

program.command("watch").description("Watch provider files and sync changes").action(async () => {
  const config = await loadConfig();
  await runWatch(config);
});

program.command("status").description("Show sync status").action(async () => {
  const config = await loadConfig();
  await printStatus(config);
});

program.command("doctor").description("Check provider and archive configuration").action(async () => {
  const config = await loadConfig();
  const diagnostics = await runDoctor(config);
  for (const diagnostic of diagnostics) {
    printDiagnostic(diagnostic);
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  program.parse();
}
