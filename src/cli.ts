#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

async function printStatus(config: SyncConfig): Promise<void> {
  const manifestPath = join(expandHomePath(config.centralArchiveDir), ".agent-sync-manifest.json");

  let manifest: SyncManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as SyncManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.log(`No sync manifest found at ${manifestPath}. Run agent-sync sync first.`);
      return;
    }

    throw error;
  }

  console.log(`manifest: ${manifestPath}`);
  console.log(`updated: ${manifest.updatedAt ?? "unknown"}`);
  console.log(`written: ${manifest.written ?? 0}`);
  console.log(`skipped: ${manifest.skipped ?? 0}`);
  console.log(`diagnostics: ${manifest.diagnostics?.length ?? 0}`);
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

program.parse();
