#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runDoctor } from "./core/doctor.js";
import { expandHomePath } from "./core/path-utils.js";
import { runSync } from "./core/sync.js";
import { runWatch } from "./core/watch.js";
import { loadConfig } from "./config.js";
import type { SyncConfig, SyncDiagnostic } from "./types.js";

type SyncManifest = {
  updatedAt?: string;
  written?: number;
  skipped?: number;
  diagnostics?: SyncDiagnostic[];
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

export async function readStatus(config: SyncConfig): Promise<StatusResult> {
  const manifestPath = join(expandHomePath(config.centralArchiveDir), ".agent-sync-manifest.json");

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

  return {
    level: "info",
    lines: [
      `manifest: ${manifestPath}`,
      `updated: ${manifest.updatedAt ?? "unknown"}`,
      `written: ${manifest.written ?? 0}`,
      `skipped: ${manifest.skipped ?? 0}`,
      `diagnostics: ${manifest.diagnostics?.length ?? 0}`,
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
