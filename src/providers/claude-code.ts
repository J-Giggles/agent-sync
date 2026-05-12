import type { ProviderAdapter } from "../types.js";
import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import fg from "fast-glob";
import { buildConversation, discoverJsonRefs, expandHomePaths, readJsonRecords } from "./generic-json.js";
import { expandHomePath } from "../core/path-utils.js";
import type { RawConversationRef, SyncConfig } from "../types.js";

const defaultPaths = ["~/.claude", "~/.config/Claude/claude-code-sessions"];
const uuidJsonlPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;

async function lstatIfAccessible(path: string) {
  try {
    return await lstat(path);
  } catch {
    return undefined;
  }
}

async function discoverClaudeProjectRefs(config: SyncConfig): Promise<RawConversationRef[]> {
  const paths = config.providers["claude-code"]?.paths ?? defaultPaths;
  const refs = new Map<string, RawConversationRef>();

  for (const path of paths) {
    const expandedPath = expandHomePath(path);
    const pathStat = await lstatIfAccessible(expandedPath);
    if (!pathStat || pathStat.isSymbolicLink()) continue;

    const files = pathStat.isDirectory()
      ? await fg(["projects/*/*.jsonl", "*/*.jsonl", "*.jsonl"], {
          cwd: expandedPath,
          absolute: true,
          followSymbolicLinks: false,
          onlyFiles: true,
        })
      : [expandedPath];

    for (const file of files) {
      if (!uuidJsonlPattern.test(basename(file))) continue;
      refs.set(file, {
        provider: "claude-code",
        path: file,
        kind: "jsonl",
        idHint: basename(file, ".jsonl"),
      });
    }
  }

  return [...refs.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function inferredCwdFromClaudeProjectPath(path: string): string | undefined {
  const folder = basename(dirname(path));
  if (!folder.startsWith("-home-")) return undefined;

  const home = homedir();
  const codePrefix = `-${home.slice(1).replaceAll("/", "-")}-code-`;
  if (folder.startsWith(codePrefix)) {
    return `${home}/code/${folder.slice(codePrefix.length)}`;
  }

  return `/${folder.slice(1).replaceAll("-", "/")}`;
}

export const claudeCodeProvider: ProviderAdapter = {
  id: "claude-code",
  label: "Claude Code",
  async discover(config) {
    const refs = new Map<string, RawConversationRef>();
    for (const ref of await discoverClaudeProjectRefs(config)) refs.set(ref.path, ref);
    for (const ref of await discoverJsonRefs(config, "claude-code", defaultPaths)) refs.set(ref.path, ref);
    return [...refs.values()].sort((a, b) => a.path.localeCompare(b.path));
  },
  async read(ref) {
    const conversation = await buildConversation("claude-code", ref, await readJsonRecords(ref), {
      idField: "sessionId",
      cwdField: "cwd",
    });
    conversation.metadata.cwd ??= inferredCwdFromClaudeProjectPath(ref.path);
    return conversation;
  },
  watchPaths: (config) => expandHomePaths(config.providers["claude-code"]?.paths ?? defaultPaths),
};
