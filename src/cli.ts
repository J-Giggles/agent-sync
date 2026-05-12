#!/usr/bin/env node
import { Command } from "commander";
import { runSync } from "./core/sync.js";
import { loadConfig } from "./config.js";

const program = new Command();

program.name("agent-sync").description("Sync local agent chat histories").version("0.1.0");

program.command("sync").description("Run one-shot chat sync").action(async () => {
  const config = await loadConfig();
  const result = await runSync(config);
  console.log(`written: ${result.written}`);
  console.log(`skipped: ${result.skipped}`);

  for (const diagnostic of result.diagnostics) {
    const source = diagnostic.sourcePath ? ` ${diagnostic.sourcePath}` : "";
    const provider = diagnostic.provider ? ` ${diagnostic.provider}` : "";
    console.error(`${diagnostic.level}:${provider}${source} ${diagnostic.message}`);
  }
});

program.command("watch").description("Watch provider files and sync changes").action(async () => {
  const config = await loadConfig();
  console.log(`watch is not implemented yet: ${Object.keys(config.providers).length} providers configured`);
});

program.command("status").description("Show sync status").action(async () => {
  const config = await loadConfig();
  console.log(`status is not implemented yet: archive ${config.centralArchiveDir}`);
});

program.command("doctor").description("Check provider and archive configuration").action(async () => {
  const config = await loadConfig();
  console.log(`doctor is not implemented yet: ${config.projectRoots.join(", ")}`);
});

program.parse();
