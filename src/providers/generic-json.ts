import { stat, readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import fg from "fast-glob";
import { createStableId } from "../core/fingerprints.js";
import type { MessageRole, NormalizedConversation, NormalizedMessage, ProviderId, RawConversationRef, SyncConfig } from "../types.js";

type JsonObject = Record<string, unknown>;

type BuildConversationOptions = {
  idField?: string;
  titleField?: string;
  cwdField?: string;
  workspaceField?: string;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, field: string | undefined): string | undefined {
  if (!field || !isObject(value)) return undefined;
  const item = value[field];
  return typeof item === "string" && item.length > 0 ? item : undefined;
}

function timestampFrom(value: unknown): string | undefined {
  if (!isObject(value)) return undefined;

  for (const field of ["timestamp", "createdAt", "created_at", "time", "date"]) {
    const item = value[field];
    if (typeof item === "string" && item.length > 0) return item;
  }

  return undefined;
}

function messageIdFrom(value: unknown): string | undefined {
  if (!isObject(value)) return undefined;

  for (const field of ["id", "uuid", "messageId"]) {
    const item = value[field];
    if (typeof item === "string" && item.length > 0) return item;
  }

  return undefined;
}

function sourceKindForPath(path: string): RawConversationRef["kind"] {
  return extname(path).toLowerCase() === ".jsonl" ? "jsonl" : "json";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function discoverJsonRefs(
  config: SyncConfig,
  provider: ProviderId,
  defaultPaths: string[]
): Promise<RawConversationRef[]> {
  const paths = config.providers[provider]?.paths ?? defaultPaths;
  const refs: RawConversationRef[] = [];

  for (const path of paths) {
    if (!(await pathExists(path))) continue;

    const pathStat = await stat(path);
    const files = pathStat.isDirectory()
      ? await fg(["**/*.json", "**/*.jsonl"], { cwd: path, absolute: true, onlyFiles: true })
      : [path];

    for (const file of files) {
      const extension = extname(file).toLowerCase();
      if (extension !== ".json" && extension !== ".jsonl") continue;

      refs.push({
        provider,
        path: file,
        kind: sourceKindForPath(file),
        idHint: basename(file, extension),
      });
    }
  }

  return refs.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readJsonRecords(ref: RawConversationRef): Promise<unknown[]> {
  const raw = await readFile(ref.path, "utf8");

  if (ref.kind === "jsonl") {
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);
  }

  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function normalizeRole(value: unknown): MessageRole {
  if (typeof value !== "string") return "unknown";

  const normalized = value.toLowerCase();
  if (normalized === "human") return "user";
  if (normalized === "ai") return "assistant";
  if (["user", "assistant", "system", "tool"].includes(normalized)) {
    return normalized as MessageRole;
  }

  return "unknown";
}

export function textFrom(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isObject(value)) return undefined;

  for (const field of ["text", "content", "value"]) {
    const item = value[field];
    if (typeof item === "string") return item;
  }

  const message = value.message;
  if (typeof message === "string") return message;
  const nested = textFrom(message);
  if (nested) return nested;

  const content = value.content;
  if (Array.isArray(content)) {
    return content.map((item) => textFrom(item)).filter(Boolean).join("\n") || undefined;
  }

  return undefined;
}

function conversationObjectFrom(records: unknown[]): JsonObject | undefined {
  return records.length === 1 && isObject(records[0]) && Array.isArray(records[0].messages) ? records[0] : undefined;
}

function messageRecordsFrom(records: unknown[]): unknown[] {
  const conversation = conversationObjectFrom(records);
  return conversation ? (conversation.messages as unknown[]) : records;
}

function fieldFromConversationOrMessages(
  conversation: JsonObject | undefined,
  messages: unknown[],
  field: string | undefined
): string | undefined {
  return stringField(conversation, field) ?? messages.map((message) => stringField(message, field)).find(Boolean);
}

function latestTimestamp(messages: NormalizedMessage[]): string | undefined {
  return messages
    .map((message) => message.createdAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
}

export function buildConversation(
  provider: ProviderId,
  ref: RawConversationRef,
  records: unknown[],
  options: BuildConversationOptions = {}
): NormalizedConversation {
  const conversation = conversationObjectFrom(records);
  const messageRecords = messageRecordsFrom(records);
  const firstMessageRecord = messageRecords[0];
  const messages = messageRecords.map((record) => ({
    id: messageIdFrom(record),
    role: normalizeRole(isObject(record) ? record.role ?? record.type : undefined),
    createdAt: timestampFrom(record),
    text: textFrom(record),
    raw: record,
  }));

  const startedAt = timestampFrom(conversation) ?? messages[0]?.createdAt ?? new Date(0).toISOString();
  const providerConversationId =
    stringField(conversation, options.idField) ??
    stringField(firstMessageRecord, options.idField) ??
    ref.idHint ??
    `${ref.path}:${startedAt}`;
  const cwd = fieldFromConversationOrMessages(conversation, messageRecords, options.cwdField);
  const workspace = fieldFromConversationOrMessages(conversation, messageRecords, options.workspaceField);
  const metadata: Record<string, unknown> = {};

  if (cwd) metadata.cwd = cwd;
  if (workspace) metadata.workspace = workspace;
  if (conversation) metadata.raw = conversation;

  return {
    schemaVersion: 1,
    provider,
    providerConversationId,
    stableId: createStableId(provider, providerConversationId, ref.path),
    title: stringField(conversation, options.titleField),
    startedAt,
    updatedAt: latestTimestamp(messages),
    source: {
      path: ref.path,
      kind: ref.kind,
    },
    messages,
    metadata,
  };
}
