import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, extname, join, relative } from "node:path";
import { promisify } from "node:util";
import { expandHomePath } from "./path-utils.js";
import type { NormalizedConversation, NormalizedMessage, SyncConfig } from "../types.js";

const execFileAsync = promisify(execFile);
const defaultT3DatabasePath = "~/.t3/userdata/state.sqlite";

export type PullT3Options = {
  dryRun?: boolean;
  databasePath?: string;
  exportPath?: string;
  project?: string;
  provider?: string;
  since?: string;
  limit?: number;
};

export type PullT3Item = {
  provider: string;
  project: string;
  providerConversationId: string;
  sourceArchivePath: string;
  threadId: string;
  title: string;
  messageCount: number;
  alreadyImported: boolean;
};

export type PullT3Result = {
  dryRun: boolean;
  planned: number;
  imported: number;
  skipped: number;
  exported: number;
  items: PullT3Item[];
};

type ArchivedConversation = {
  conversation: NormalizedConversation;
  archivePath: string;
  projectName: string;
};

type T3ProjectRow = {
  project_id: string;
  title: string;
  workspace_root: string;
  scripts_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: null;
  default_model_selection_json: string;
};

type T3ThreadRow = {
  thread_id: string;
  project_id: string;
  title: string;
  branch: null;
  worktree_path: null;
  latest_turn_id: null;
  created_at: string;
  updated_at: string;
  deleted_at: null;
  runtime_mode: "full-access";
  interaction_mode: "default";
  model_selection_json: string;
  archived_at: null;
  latest_user_message_at: string | null;
  pending_approval_count: 0;
  pending_user_input_count: 0;
  has_actionable_proposed_plan: 0;
};

type T3MessageRow = {
  message_id: string;
  thread_id: string;
  turn_id: null;
  role: string;
  text: string;
  is_streaming: 0;
  created_at: string;
  updated_at: string;
  attachments_json: string;
};

type T3SessionRow = {
  thread_id: string;
  status: "idle";
  provider_name: "agent-sync";
  provider_session_id: string;
  provider_thread_id: string;
  active_turn_id: null;
  last_error: null;
  updated_at: string;
  runtime_mode: "full-access";
  provider_instance_id: "agent-sync";
};

type T3ImportRecord = {
  type: "agent-sync.t3-import.v1";
  project: T3ProjectRow;
  thread: T3ThreadRow;
  messages: T3MessageRow[];
  session: T3SessionRow;
};

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function sqliteString(value: string | null): string {
  if (value === null) return "null";
  return `'${value.replaceAll("'", "''")}'`;
}

function sqliteNumber(value: number): string {
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNormalizedConversation(value: unknown): value is NormalizedConversation {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.provider === "string" &&
    typeof value.providerConversationId === "string" &&
    typeof value.stableId === "string" &&
    typeof value.startedAt === "string" &&
    isRecord(value.source) &&
    Array.isArray(value.messages)
  );
}

function normalizedTimestamp(value: string | undefined, fallback: string): string {
  if (value) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return fallback;
}

function messageTimestamp(message: NormalizedMessage, conversation: NormalizedConversation): string {
  return normalizedTimestamp(message.createdAt, normalizedTimestamp(conversation.startedAt, new Date(0).toISOString()));
}

async function findJsonFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".json")
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((path) => !path.endsWith(".agent-sync-manifest.json"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function projectFromArchivePath(archiveRoot: string, archivePath: string): string {
  const [project] = relative(archiveRoot, archivePath).split(/[\\/]/);
  return project || "unknown-project";
}

async function readArchivedConversations(config: SyncConfig): Promise<ArchivedConversation[]> {
  const archiveRoot = expandHomePath(config.centralArchiveDir);
  const unknownRoot = expandHomePath(config.unknownProjectDir);
  const archived: ArchivedConversation[] = [];

  for (const archivePath of await findJsonFiles(archiveRoot)) {
    const parsed = JSON.parse(await readFile(archivePath, "utf8")) as unknown;
    if (!isNormalizedConversation(parsed)) continue;
    archived.push({
      conversation: parsed,
      archivePath,
      projectName: parsed.project?.name ?? projectFromArchivePath(archiveRoot, archivePath),
    });
  }

  for (const archivePath of await findJsonFiles(unknownRoot)) {
    const parsed = JSON.parse(await readFile(archivePath, "utf8")) as unknown;
    if (!isNormalizedConversation(parsed)) continue;
    archived.push({
      conversation: parsed,
      archivePath,
      projectName: parsed.project?.name ?? "unknown-project",
    });
  }

  return archived.sort((a, b) => {
    const aTime = Date.parse(a.conversation.startedAt);
    const bTime = Date.parse(b.conversation.startedAt);
    if (aTime !== bTime) return aTime - bTime;
    return a.archivePath.localeCompare(b.archivePath);
  });
}

function filterArchived(archived: ArchivedConversation[], options: PullT3Options): ArchivedConversation[] {
  const sinceTime = options.since ? Date.parse(options.since) : undefined;
  if (sinceTime !== undefined && Number.isNaN(sinceTime)) {
    throw new Error(`Invalid --since date: ${options.since}`);
  }

  const filtered = archived.filter(({ conversation, projectName }) => {
    if (options.project && projectName !== options.project) return false;
    if (options.provider && conversation.provider !== options.provider) return false;
    if (sinceTime !== undefined && Date.parse(conversation.startedAt) < sinceTime) return false;
    return true;
  });

  return options.limit === undefined ? filtered : filtered.slice(0, options.limit);
}

function latestUserMessageAt(messages: NormalizedMessage[]): string | null {
  return [...messages].reverse().find((message) => message.role === "user" && message.createdAt)?.createdAt ?? null;
}

function titleFor(conversation: NormalizedConversation, projectName: string): string {
  return `[agent-sync] ${conversation.provider} / ${projectName} / ${conversation.startedAt.slice(0, 10)}`;
}

function metadataFor(archived: ArchivedConversation) {
  return {
    sourceProvider: archived.conversation.provider,
    sourceArchivePath: archived.archivePath,
    originalProject: archived.projectName,
    originalStartedAt: archived.conversation.startedAt,
    originalUpdatedAt: archived.conversation.updatedAt,
    providerConversationId: archived.conversation.providerConversationId,
    stableId: archived.conversation.stableId,
  };
}

function buildImportRecord(config: SyncConfig, archived: ArchivedConversation): T3ImportRecord {
  const conversation = archived.conversation;
  const metadata = metadataFor(archived);
  const createdAt = normalizedTimestamp(conversation.startedAt, new Date(0).toISOString());
  const updatedAt = normalizedTimestamp(conversation.updatedAt, createdAt);
  const threadId = `agent-sync:${stableHash(`${conversation.provider}:${conversation.stableId}:${conversation.providerConversationId}`)}`;
  const projectId = `agent-sync:project:${stableHash(expandHomePath(config.centralArchiveDir))}`;

  return {
    type: "agent-sync.t3-import.v1",
    project: {
      project_id: projectId,
      title: "agent-sync archive",
      workspace_root: expandHomePath(config.centralArchiveDir),
      scripts_json: "{}",
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: null,
      default_model_selection_json: JSON.stringify({ agentSyncImport: { archiveRoot: expandHomePath(config.centralArchiveDir) } }),
    },
    thread: {
      thread_id: threadId,
      project_id: projectId,
      title: titleFor(conversation, archived.projectName),
      branch: null,
      worktree_path: null,
      latest_turn_id: null,
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: null,
      runtime_mode: "full-access",
      interaction_mode: "default",
      model_selection_json: JSON.stringify({ agentSyncImport: metadata }),
      archived_at: null,
      latest_user_message_at: latestUserMessageAt(conversation.messages),
      pending_approval_count: 0,
      pending_user_input_count: 0,
      has_actionable_proposed_plan: 0,
    },
    messages: conversation.messages.map((message, index) => {
      const created = messageTimestamp(message, conversation);
      const sourceMessageId = message.id ?? String(index);
      return {
        message_id: `agent-sync:${stableHash(`${threadId}:${sourceMessageId}:${index}`)}`,
        thread_id: threadId,
        turn_id: null,
        role: message.role,
        text: message.text ?? "",
        is_streaming: 0,
        created_at: created,
        updated_at: created,
        attachments_json: JSON.stringify({
          agentSyncImport: {
            ...metadata,
            sourceMessageId,
            sourceMessageIndex: index,
          },
        }),
      };
    }),
    session: {
      thread_id: threadId,
      status: "idle",
      provider_name: "agent-sync",
      provider_session_id: conversation.providerConversationId,
      provider_thread_id: threadId,
      active_turn_id: null,
      last_error: null,
      updated_at: updatedAt,
      runtime_mode: "full-access",
      provider_instance_id: "agent-sync",
    },
  };
}

async function existingThreadIds(databasePath: string, threadIds: string[]): Promise<Set<string>> {
  if (threadIds.length === 0) return new Set();
  const sql = `select thread_id from projection_threads where thread_id in (${threadIds.map(sqliteString).join(",")})`;
  const { stdout } = await execFileAsync("sqlite3", ["-json", databasePath, sql]);
  const rows = stdout.trim() ? (JSON.parse(stdout) as Array<{ thread_id: string }>) : [];
  return new Set(rows.map((row) => row.thread_id));
}

function insertProjectSql(row: T3ProjectRow): string {
  return `insert or ignore into projection_projects (project_id,title,workspace_root,scripts_json,created_at,updated_at,deleted_at,default_model_selection_json) values (${[
    sqliteString(row.project_id),
    sqliteString(row.title),
    sqliteString(row.workspace_root),
    sqliteString(row.scripts_json),
    sqliteString(row.created_at),
    sqliteString(row.updated_at),
    sqliteString(row.deleted_at),
    sqliteString(row.default_model_selection_json),
  ].join(",")});`;
}

function insertThreadSql(row: T3ThreadRow): string {
  return `insert or ignore into projection_threads (thread_id,project_id,title,branch,worktree_path,latest_turn_id,created_at,updated_at,deleted_at,runtime_mode,interaction_mode,model_selection_json,archived_at,latest_user_message_at,pending_approval_count,pending_user_input_count,has_actionable_proposed_plan) values (${[
    sqliteString(row.thread_id),
    sqliteString(row.project_id),
    sqliteString(row.title),
    sqliteString(row.branch),
    sqliteString(row.worktree_path),
    sqliteString(row.latest_turn_id),
    sqliteString(row.created_at),
    sqliteString(row.updated_at),
    sqliteString(row.deleted_at),
    sqliteString(row.runtime_mode),
    sqliteString(row.interaction_mode),
    sqliteString(row.model_selection_json),
    sqliteString(row.archived_at),
    sqliteString(row.latest_user_message_at),
    sqliteNumber(row.pending_approval_count),
    sqliteNumber(row.pending_user_input_count),
    sqliteNumber(row.has_actionable_proposed_plan),
  ].join(",")});`;
}

function insertMessageSql(row: T3MessageRow): string {
  return `insert or ignore into projection_thread_messages (message_id,thread_id,turn_id,role,text,is_streaming,created_at,updated_at,attachments_json) values (${[
    sqliteString(row.message_id),
    sqliteString(row.thread_id),
    sqliteString(row.turn_id),
    sqliteString(row.role),
    sqliteString(row.text),
    sqliteNumber(row.is_streaming),
    sqliteString(row.created_at),
    sqliteString(row.updated_at),
    sqliteString(row.attachments_json),
  ].join(",")});`;
}

function insertSessionSql(row: T3SessionRow): string {
  return `insert or ignore into projection_thread_sessions (thread_id,status,provider_name,provider_session_id,provider_thread_id,active_turn_id,last_error,updated_at,runtime_mode,provider_instance_id) values (${[
    sqliteString(row.thread_id),
    sqliteString(row.status),
    sqliteString(row.provider_name),
    sqliteString(row.provider_session_id),
    sqliteString(row.provider_thread_id),
    sqliteString(row.active_turn_id),
    sqliteString(row.last_error),
    sqliteString(row.updated_at),
    sqliteString(row.runtime_mode),
    sqliteString(row.provider_instance_id),
  ].join(",")});`;
}

async function importRecords(databasePath: string, records: T3ImportRecord[], existing: Set<string>): Promise<number> {
  const statements = ["begin transaction;"];
  let imported = 0;

  for (const record of records) {
    if (existing.has(record.thread.thread_id)) continue;
    imported += 1;
    statements.push(insertProjectSql(record.project));
    statements.push(insertThreadSql(record.thread));
    for (const message of record.messages) statements.push(insertMessageSql(message));
    statements.push(insertSessionSql(record.session));
  }

  statements.push("commit;");
  if (imported > 0) {
    await execFileAsync("sqlite3", [databasePath, statements.join("\n")], { maxBuffer: 128 * 1024 * 1024 });
  }

  return imported;
}

async function exportRecords(exportPath: string, records: T3ImportRecord[]): Promise<number> {
  await mkdir(dirname(exportPath), { recursive: true });
  await writeFile(exportPath, `${records.map((record) => JSON.stringify(record)).join("\n")}${records.length > 0 ? "\n" : ""}`);
  return records.length;
}

export async function runPullT3(config: SyncConfig, options: PullT3Options = {}): Promise<PullT3Result> {
  const dryRun = options.dryRun ?? true;
  const archived = filterArchived(await readArchivedConversations(config), options);
  const records = archived.map((item) => buildImportRecord(config, item));
  const databasePath = expandHomePath(options.databasePath ?? defaultT3DatabasePath);
  const existing = dryRun || records.length === 0 ? new Set<string>() : await existingThreadIds(databasePath, records.map((record) => record.thread.thread_id));
  const exported = options.exportPath ? await exportRecords(options.exportPath, records) : 0;
  const imported = dryRun ? 0 : await importRecords(databasePath, records, existing);
  const skipped = dryRun ? 0 : records.length - imported;

  return {
    dryRun,
    planned: records.length,
    imported,
    skipped,
    exported,
    items: records.map((record, index) => ({
      provider: archived[index].conversation.provider,
      project: archived[index].projectName,
      providerConversationId: archived[index].conversation.providerConversationId,
      sourceArchivePath: archived[index].archivePath,
      threadId: record.thread.thread_id,
      title: record.thread.title,
      messageCount: record.messages.length,
      alreadyImported: existing.has(record.thread.thread_id),
    })),
  };
}
