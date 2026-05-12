#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cancel, isCancel, multiselect, outro } from "@clack/prompts";
import { Command } from "commander";
import { runDoctor } from "./core/doctor.js";
import { expandHomePath } from "./core/path-utils.js";
import { discoverProjects } from "./core/projects.js";
import { runSync } from "./core/sync.js";
import {
  formatPullT3Result,
  runPullT3,
  sourceConversationKey,
  summarizePullT3Projects,
  type PullT3Options,
} from "./core/t3-import.js";
import { runWatch } from "./core/watch.js";
import { loadConfig } from "./config.js";
import { enabledProviders } from "./providers/index.js";
import type { SyncConfig, SyncDiagnostic } from "./types.js";

type SyncManifest = {
  updatedAt?: string;
  written?: number;
  inSync?: number;
  skipped?: number;
  error?: number;
  diagnostics?: SyncDiagnostic[];
  conversations?: unknown;
};

type ManifestConversation = {
  provider?: string;
  sourcePath?: string;
  projectName?: string;
  updatedAt?: string;
  outputs?: string[];
};

export type StatusResult = {
  level: "info" | "error";
  lines: string[];
};

const program = new Command();

type PullT3CliOptions = {
  dryRun?: boolean;
  write?: boolean;
  database?: string;
  export?: string;
  project?: string;
  provider?: string;
  since?: string;
  limit?: number;
  verbose?: boolean;
  all?: boolean;
  includeSubagents?: boolean;
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isManifestConversation(value: unknown): value is ManifestConversation {
  return isRecord(value);
}

function validateManifestShape(manifest: unknown, manifestPath: string): StatusResult | undefined {
  if (!isRecord(manifest)) {
    return {
      level: "error",
      lines: [`Invalid sync manifest at ${manifestPath}: manifest must be an object.`],
    };
  }

  if (manifest.conversations !== undefined && !Array.isArray(manifest.conversations)) {
    return {
      level: "error",
      lines: [`Invalid sync manifest at ${manifestPath}: conversations must be an array when present.`],
    };
  }

  return undefined;
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

function manifestConversations(manifest: SyncManifest): ManifestConversation[] {
  return Array.isArray(manifest.conversations) ? manifest.conversations.filter(isManifestConversation) : [];
}

export async function readStatus(config: SyncConfig): Promise<StatusResult> {
  const manifestPath = join(expandHomePath(config.centralArchiveDir), ".agent-sync-manifest.json");
  const enabledProviderIds = enabledProviders(config).map((provider) => provider.id);
  const projects = await discoverProjects(config.projectRoots);
  const unknownProjectCount = await countJsonAndMarkdownFiles(expandHomePath(config.unknownProjectDir));

  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
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

  const shapeError = validateManifestShape(parsedManifest, manifestPath);
  if (shapeError) return shapeError;
  const manifest = parsedManifest as SyncManifest;

  const latestConversations = manifestConversations(manifest)
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
      `in-sync: ${manifest.inSync ?? manifest.skipped ?? 0}`,
      `error: ${manifest.error ?? manifest.diagnostics?.filter((diagnostic) => diagnostic.level === "error").length ?? 0}`,
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

function pullT3OptionsFromCli(options: PullT3CliOptions): PullT3Options {
  return {
    dryRun: options.write ? false : options.dryRun ?? true,
    databasePath: options.database,
    exportPath: options.export,
    project: options.project,
    provider: options.provider,
    since: options.since,
    limit: options.limit,
    includeSubagents: options.includeSubagents,
  };
}

async function selectPullT3SourceKeys(config: SyncConfig, options: PullT3CliOptions): Promise<string[]> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("pull:t3 uses interactive selection by default. Run in a TTY or pass --all for explicit bulk mode.");
  }

  const preview = await runPullT3(config, {
    ...pullT3OptionsFromCli({ ...options, write: false }),
    dryRun: true,
    exportPath: undefined,
  });
  if (preview.items.length === 0) return [];

  let scopedItems = preview.items;
  const allPreview = options.includeSubagents
    ? preview
    : await runPullT3(config, {
        ...pullT3OptionsFromCli({ ...options, write: false }),
        dryRun: true,
        exportPath: undefined,
        includeSubagents: true,
      });

  if (!options.project) {
    const projects = summarizePullT3Projects(preview.items, allPreview.items);
    const selectedProjects = await multiselect({
      message: "Select project(s) to browse",
      options: projects.map((group) => ({
        value: group.project,
        label: group.project,
        hint: `${group.conversations} chats, ${group.messages} messages${group.subagents > 0 ? `, ${group.subagents} subagents${options.includeSubagents ? "" : " hidden"}` : ""}`,
      })),
      required: false,
    });

    if (isCancel(selectedProjects)) {
      cancel("Selection cancelled; nothing imported.");
      return [];
    }
    if (selectedProjects.length === 0) {
      outro("No projects selected; nothing imported.");
      return [];
    }

    const selectedProjectSet = new Set(selectedProjects);
    scopedItems = preview.items.filter((item) => selectedProjectSet.has(item.project));
  }

  if (scopedItems.length === 0) return [];

  const selectedChats = await multiselect({
    message: "Select chat(s) to import",
    options: scopedItems.map((item) => {
      const date = item.title.replace(/^\[agent-sync\] [^/]+ \/ [^/]+ \/ /, "");
      const kind = item.kind === "subagent" ? `subagent:${item.agentRole ?? "unknown"}` : "top-level";
      const runtimeProvider = item.t3ProviderName ? `, t3 provider ${item.t3ProviderName}` : "";
      return {
        value: sourceConversationKey(item.provider, item.providerConversationId),
        label: `${item.provider} / ${item.project} / ${date}`,
        hint: `${kind}${runtimeProvider}, ${item.messageCount} messages, source ${item.providerConversationId}`,
      };
    }),
    required: false,
  });

  if (isCancel(selectedChats)) {
    cancel("Selection cancelled; nothing imported.");
    return [];
  }
  if (selectedChats.length === 0) {
    outro("No chats selected; nothing imported.");
    return [];
  }

  return [...selectedChats];
}

export function isDirectCliExecution(argvPath: string | undefined, moduleUrl: string): boolean {
  if (!argvPath) return false;

  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return argvPath === fileURLToPath(moduleUrl);
  }
}

program.name("agent-sync").description("Sync local agent chat histories").version("0.1.0");

program.command("sync").description("Run one-shot chat sync").action(async () => {
  const config = await loadConfig();
  const result = await runSync(config);
  console.log(`written: ${result.written}`);
  console.log(`in-sync: ${result.inSync}`);
  console.log(`error: ${result.diagnostics.filter((diagnostic) => diagnostic.level === "error").length}`);

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

program
  .command("pull:t3")
  .description("Preview, export, or import normalized archive conversations into T3 projection tables")
  .option("--dry-run", "Preview planned imports without writing to T3", true)
  .option("--write", "Write to the configured T3 SQLite database")
  .option("--database <path>", "T3 SQLite database path", "~/.t3/userdata/state.sqlite")
  .option("--export <path>", "Write planned imports as NDJSON without requiring T3 to consume them")
  .option("--project <name>", "Only include archive conversations for one project")
  .option("--provider <provider>", "Only include archive conversations from one provider")
  .option("--since <date>", "Only include conversations started at or after this date")
  .option("--limit <n>", "Limit the number of conversations considered", (value) => Number.parseInt(value, 10))
  .option("--verbose", "List every planned conversation")
  .option("--all", "Skip interactive selection and apply the command to every matching conversation")
  .option("--include-subagents", "Include Codex subagent rollout sessions in selection and imports")
  .action(
    async (options: PullT3CliOptions) => {
      if (options.write && !options.database) {
        throw new Error("Refusing to write without an explicit --database path. Start with --dry-run or pass --database <copy-of-t3.sqlite>.");
      }

      const config = await loadConfig();
      const selectedSourceConversationKeys = options.all ? undefined : await selectPullT3SourceKeys(config, options);
      if (!options.all && selectedSourceConversationKeys?.length === 0) return;
      const result = await runPullT3(config, {
        ...pullT3OptionsFromCli(options),
        selectedSourceConversationKeys,
      });

      for (const line of formatPullT3Result(result, { verbose: options.verbose })) console.log(line);
    }
  );

program
  .command("doctor")
  .description("Check provider and archive configuration")
  .option("--fix-ignore-guards", "Create missing project-local archive ignore guards without syncing chats")
  .action(async (options: { fixIgnoreGuards?: boolean }) => {
    const config = await loadConfig();
    const diagnostics = await runDoctor(config, { fixIgnoreGuards: options.fixIgnoreGuards });
    for (const diagnostic of diagnostics) {
      printDiagnostic(diagnostic);
    }
  });

if (isDirectCliExecution(process.argv[1], import.meta.url)) {
  await program.parseAsync();
}
