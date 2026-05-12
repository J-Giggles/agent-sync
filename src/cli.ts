#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program.name("agent-sync").description("Sync local agent chat histories").version("0.1.0");

program.command("sync").description("Run one-shot chat sync").action(() => {
  console.log("sync is not implemented yet");
});

program.command("watch").description("Watch provider files and sync changes").action(() => {
  console.log("watch is not implemented yet");
});

program.command("status").description("Show sync status").action(() => {
  console.log("status is not implemented yet");
});

program.command("doctor").description("Check provider and archive configuration").action(() => {
  console.log("doctor is not implemented yet");
});

program.parse();
