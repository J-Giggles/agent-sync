import { lstat } from "node:fs/promises";
import { basename } from "node:path";
import fg from "fast-glob";
import { expandHomePath } from "../core/path-utils.js";
import type { ProviderAdapter, RawConversationRef, SyncConfig } from "../types.js";
import { buildConversation, discoverJsonRefs, expandHomePaths, readJsonRecords } from "./generic-json.js";

const defaultPaths = ["~/.codex", "~/.codex/sessions"];
const rolloutPattern = /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function lstatIfAccessible(path: string) {
  try {
    return await lstat(path);
  } catch {
    return undefined;
  }
}

function rolloutIdHint(path: string): string | undefined {
  return rolloutPattern.exec(basename(path))?.[1];
}

async function discoverCodexSessionRefs(config: SyncConfig): Promise<RawConversationRef[]> {
  const paths = config.providers.codex?.paths ?? defaultPaths;
  const refs = new Map<string, RawConversationRef>();

  for (const path of paths) {
    const expandedPath = expandHomePath(path);
    const pathStat = await lstatIfAccessible(expandedPath);
    if (!pathStat || pathStat.isSymbolicLink()) continue;

    const files = pathStat.isDirectory()
      ? await fg(["sessions/**/*.jsonl", "**/rollout-*.jsonl"], {
          cwd: expandedPath,
          absolute: true,
          followSymbolicLinks: false,
          onlyFiles: true,
        })
      : [expandedPath];

    for (const file of files) {
      const idHint = rolloutIdHint(file);
      if (!idHint) continue;
      refs.set(file, {
        provider: "codex",
        path: file,
        kind: "jsonl",
        idHint,
      });
    }
  }

  return [...refs.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeCodexRolloutRecords(records: unknown[], ref: RawConversationRef): unknown[] {
  const sessionMeta = records.find((record) => isObject(record) && record.type === "session_meta");
  const sessionPayload = isObject(sessionMeta) && isObject(sessionMeta.payload) ? sessionMeta.payload : undefined;
  const cwd = typeof sessionPayload?.cwd === "string" ? sessionPayload.cwd : undefined;
  const id = typeof sessionPayload?.id === "string" ? sessionPayload.id : ref.idHint;
  const timestamp =
    typeof sessionPayload?.timestamp === "string"
      ? sessionPayload.timestamp
      : isObject(sessionMeta) && typeof sessionMeta.timestamp === "string"
        ? sessionMeta.timestamp
        : undefined;
  const messages = records.flatMap((record) => {
    if (!isObject(record) || !isObject(record.payload)) return [];
    if (record.type !== "response_item" || record.payload.type !== "message") return [];

    return [
      {
        id: typeof record.payload.id === "string" ? record.payload.id : undefined,
        role: record.payload.role,
        content: record.payload.content,
        timestamp: record.timestamp,
      },
    ];
  });

  if (messages.length === 0) return records;

  return [
    {
      id,
      cwd,
      timestamp,
      messages,
    },
  ];
}

export const codexProvider: ProviderAdapter = {
  id: "codex",
  label: "Codex",
  async discover(config) {
    const refs = new Map<string, RawConversationRef>();
    for (const ref of await discoverCodexSessionRefs(config)) refs.set(ref.path, ref);
    for (const ref of await discoverJsonRefs(config, "codex", defaultPaths)) refs.set(ref.path, ref);
    return [...refs.values()].sort((a, b) => a.path.localeCompare(b.path));
  },
  async read(ref) {
    const records = await readJsonRecords(ref);

    return buildConversation("codex", ref, normalizeCodexRolloutRecords(records, ref), {
      idField: "id",
      cwdField: "cwd",
    });
  },
  watchPaths: (config) => expandHomePaths(config.providers.codex?.paths ?? defaultPaths),
};
