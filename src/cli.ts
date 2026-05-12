#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "./config.js";

const program = new Command();

program.name("agent-sync").description("Sync local agent chat histories").version("0.1.0");

program.command("sync").description("Run one-shot chat sync").action(async () => {
  const config = await loadConfig();
  console.log(`sync is not implemented yet: ${Object.keys(config.providers).length} providers configured`);
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
