import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import fg from "fast-glob";
import { expandHomePath } from "../core/path-utils.js";
import type { ProviderAdapter, RawConversationRef, SyncConfig } from "../types.js";
import { buildConversation, discoverJsonRefs, expandHomePaths, readJsonRecords } from "./generic-json.js";

const legacyDefaultPaths = ["~/.config/cursor/chats", "~/.config/Cursor/User/globalStorage", "~/.cursor/plans"];
const transcriptDefaultPaths = ["~/.cursor/projects"];
const defaultPaths = [...legacyDefaultPaths, ...transcriptDefaultPaths];
const uuidJsonlPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;

async function lstatIfAccessible(path: string) {
  try {
    return await lstat(path);
  } catch {
    return undefined;
  }
}

async function discoverCursorProjectTranscriptRefs(config: SyncConfig): Promise<RawConversationRef[]> {
  const paths = config.providers.cursor?.paths ?? transcriptDefaultPaths;
  const refs = new Map<string, RawConversationRef>();

  for (const path of paths) {
    const expandedPath = expandHomePath(path);
    const pathStat = await lstatIfAccessible(expandedPath);
    if (!pathStat || pathStat.isSymbolicLink()) continue;

    const files = pathStat.isDirectory()
      ? await fg(["*/agent-transcripts/*/*.jsonl", "*/agent-transcripts/*/subagents/*.jsonl"], {
          cwd: expandedPath,
          absolute: true,
          followSymbolicLinks: false,
          onlyFiles: true,
        })
      : [expandedPath];

    for (const file of files) {
      if (!uuidJsonlPattern.test(basename(file))) continue;
      refs.set(file, {
        provider: "cursor",
        path: file,
        kind: "jsonl",
        idHint: basename(file, ".jsonl"),
      });
    }
  }

  return [...refs.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function inferredCwdFromCursorProjectPath(path: string): string | undefined {
  const parts = path.split("/");
  const projectIndex = parts.lastIndexOf("projects");
  const transcriptIndex = parts.lastIndexOf("agent-transcripts");
  const encodedProject =
    projectIndex >= 0 ? parts[projectIndex + 1] : transcriptIndex > 0 ? parts[transcriptIndex - 1] : undefined;
  if (!encodedProject) return undefined;
  if (encodedProject === "empty-window" || encodedProject.startsWith("tmp-")) return undefined;
  const home = homedir();
  const codePrefix = `${home.slice(1).replaceAll("/", "-")}-code-`;
  if (encodedProject.startsWith(codePrefix)) return `${home}/code/${encodedProject.slice(codePrefix.length)}`;
  if (encodedProject === home.slice(1).replaceAll("/", "-")) return home;
  return undefined;
}

export const cursorProvider: ProviderAdapter = {
  id: "cursor",
  label: "Cursor",
  async discover(config) {
    const refs = new Map<string, RawConversationRef>();
    for (const ref of await discoverCursorProjectTranscriptRefs(config)) refs.set(ref.path, ref);
    for (const ref of await discoverJsonRefs(config, "cursor", config.providers.cursor?.paths ?? legacyDefaultPaths)) {
      refs.set(ref.path, ref);
    }
    return [...refs.values()].sort((a, b) => a.path.localeCompare(b.path));
  },
  async read(ref) {
    const conversation = await buildConversation("cursor", ref, await readJsonRecords(ref), {
      idField: "id",
      titleField: "title",
      workspaceField: "workspace",
    });
    conversation.metadata.cwd ??= inferredCwdFromCursorProjectPath(ref.path);
    return conversation;
  },
  watchPaths: (config) => expandHomePaths(config.providers.cursor?.paths ?? defaultPaths),
};
