import { execFile, spawn } from "node:child_process";
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
  selectedSourceConversationKeys?: string[];
  includeSubagents?: boolean;
};

export type PullT3ConversationKind = "top-level" | "subagent";

export type PullT3Item = {
  provider: string;
  project: string;
  providerConversationId: string;
  sourceArchivePath: string;
  threadId: string;
  title: string;
  chatLabel: string;
  messageCount: number;
  alreadyImported: boolean;
  kind: PullT3ConversationKind;
  parentConversationId?: string;
  agentRole?: string;
  agentNickname?: string;
  t3ProviderName?: string;
  t3ProviderInstanceId?: string;
};

export type PullT3Result = {
  dryRun: boolean;
  planned: number;
  deduplicated: number;
  omittedSubagents: number;
  imported: number;
  skipped: number;
  exported: number;
  items: PullT3Item[];
};

export type PullT3ProjectSummary = {
  project: string;
  conversations: number;
  messages: number;
  subagents: number;
};

export type FormatPullT3Options = {
  verbose?: boolean;
};

type ArchivedConversation = {
  conversation: NormalizedConversation;
  archivePath: string;
  projectName: string;
  kind: PullT3ConversationKind;
  parentConversationId?: string;
  agentRole?: string;
  agentNickname?: string;
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

type ExistingT3ProjectRow = {
  project_id: string;
  title: string;
  workspace_root: string;
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function subagentMetadata(conversation: NormalizedConversation): Pick<
  ArchivedConversation,
  "kind" | "parentConversationId" | "agentRole" | "agentNickname"
> {
  const raw = isRecord(conversation.metadata.raw) ? conversation.metadata.raw : undefined;
  const source = raw && isRecord(raw.source) ? raw.source : undefined;
  const subagent = source && isRecord(source.subagent) ? source.subagent : undefined;
  const threadSpawn = subagent && isRecord(subagent.thread_spawn) ? subagent.thread_spawn : undefined;
  const parentConversationId = stringValue(threadSpawn?.parent_thread_id);

  if (!parentConversationId) return { kind: "top-level" };

  return {
    kind: "subagent",
    parentConversationId,
    agentRole: stringValue(threadSpawn?.agent_role),
    agentNickname: stringValue(threadSpawn?.agent_nickname),
  };
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

function archiveWorkspaceRoot(config: SyncConfig, archived: ArchivedConversation): string {
  return (
    archived.conversation.project?.root ??
    stringValue(archived.conversation.metadata.cwd) ??
    stringValue(archived.conversation.metadata.workspace) ??
    expandHomePath(config.centralArchiveDir)
  );
}

function projectMatchKey(title: string, workspaceRoot: string): string {
  return `${title}\0${workspaceRoot}`;
}

async function existingProjects(databasePath: string): Promise<ExistingT3ProjectRow[]> {
  const { stdout } = await execFileAsync(
    "sqlite3",
    [
      "-readonly",
      "-json",
      databasePath,
      "select project_id, title, workspace_root from projection_projects where deleted_at is null",
    ],
    { maxBuffer: 128 * 1024 * 1024 }
  );
  return stdout.trim() ? (JSON.parse(stdout) as ExistingT3ProjectRow[]) : [];
}

function existingProjectIdFor(archived: ArchivedConversation, existing: ExistingT3ProjectRow[], workspaceRoot: string): string | undefined {
  const exact = existing.find(
    (project) => projectMatchKey(project.title, project.workspace_root) === projectMatchKey(archived.projectName, workspaceRoot)
  );
  if (exact) return exact.project_id;

  const sameName = existing.filter((project) => project.title === archived.projectName);
  return sameName.length === 1 ? sameName[0].project_id : undefined;
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
      ...subagentMetadata(parsed),
    });
  }

  for (const archivePath of await findJsonFiles(unknownRoot)) {
    const parsed = JSON.parse(await readFile(archivePath, "utf8")) as unknown;
    if (!isNormalizedConversation(parsed)) continue;
    archived.push({
      conversation: parsed,
      archivePath,
      projectName: parsed.project?.name ?? "unknown-project",
      ...subagentMetadata(parsed),
    });
  }

  return archived.sort((a, b) => {
    const aTime = Date.parse(a.conversation.startedAt);
    const bTime = Date.parse(b.conversation.startedAt);
    if (aTime !== bTime) return aTime - bTime;
    return a.archivePath.localeCompare(b.archivePath);
  });
}

function filterArchived(archived: ArchivedConversation[], options: PullT3Options): { conversations: ArchivedConversation[]; omittedSubagents: number } {
  const sinceTime = options.since ? Date.parse(options.since) : undefined;
  if (sinceTime !== undefined && Number.isNaN(sinceTime)) {
    throw new Error(`Invalid --since date: ${options.since}`);
  }

  let omittedSubagents = 0;
  const filtered = archived.filter(({ conversation, projectName, kind }) => {
    if (options.project && projectName !== options.project) return false;
    if (options.provider && conversation.provider !== options.provider) return false;
    if (!options.includeSubagents && kind === "subagent") {
      omittedSubagents += 1;
      return false;
    }
    if (
      options.selectedSourceConversationKeys &&
      !options.selectedSourceConversationKeys.includes(sourceConversationKey(conversation.provider, conversation.providerConversationId))
    ) {
      return false;
    }
    if (sinceTime !== undefined && Date.parse(conversation.startedAt) < sinceTime) return false;
    return true;
  });

  return {
    conversations: options.limit === undefined ? filtered : filtered.slice(0, options.limit),
    omittedSubagents,
  };
}

export function sourceConversationKey(provider: string, providerConversationId: string): string {
  return `${provider}:${providerConversationId}`;
}

function dedupeKey(archived: ArchivedConversation): string {
  return sourceConversationKey(archived.conversation.provider, archived.conversation.providerConversationId);
}

function preferenceScore(archived: ArchivedConversation): number {
  const updatedAt = Date.parse(archived.conversation.updatedAt ?? archived.conversation.startedAt);
  const messageCount = archived.conversation.messages.length;
  return (Number.isFinite(updatedAt) ? updatedAt : 0) + messageCount;
}

function preferArchiveCandidate(existing: ArchivedConversation, candidate: ArchivedConversation): ArchivedConversation {
  const existingScore = preferenceScore(existing);
  const candidateScore = preferenceScore(candidate);
  if (candidateScore !== existingScore) return candidateScore > existingScore ? candidate : existing;
  return candidate.archivePath.localeCompare(existing.archivePath) > 0 ? candidate : existing;
}

function deduplicateArchived(archived: ArchivedConversation[]): { conversations: ArchivedConversation[]; deduplicated: number } {
  const bySourceConversation = new Map<string, ArchivedConversation>();

  for (const conversation of archived) {
    const key = dedupeKey(conversation);
    const existing = bySourceConversation.get(key);
    bySourceConversation.set(key, existing ? preferArchiveCandidate(existing, conversation) : conversation);
  }

  return {
    conversations: [...bySourceConversation.values()].sort((a, b) => {
      const aTime = Date.parse(a.conversation.startedAt);
      const bTime = Date.parse(b.conversation.startedAt);
      if (aTime !== bTime) return aTime - bTime;
      return a.archivePath.localeCompare(b.archivePath);
    }),
    deduplicated: archived.length - bySourceConversation.size,
  };
}

function latestUserMessageAt(messages: NormalizedMessage[]): string | null {
  return [...messages].reverse().find((message) => message.role === "user" && message.createdAt)?.createdAt ?? null;
}

function cleanChatLabelCandidate(value: string): string | undefined {
  const withoutCodeBlocks = value.replace(/```[\s\S]*?```/g, " ");
  const line = withoutCodeBlocks
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0 && !item.startsWith("<") && !item.startsWith("{") && item !== "```");
  if (!line) return undefined;

  const cleaned = line
    .replace(/^#+\s*/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return undefined;

  if (cleaned.length <= 72) return cleaned;

  const clipped = cleaned.slice(0, 72);
  return clipped.replace(/\s+\S*$/, "").trim() || clipped.trim();
}

function isBoilerplateChatLabel(value: string): boolean {
  return [
    /^agents\.md instructions\b/i,
    /^you are working in\b/i,
    /^you write concise thread titles\b/i,
    /^knowledge cutoff\b/i,
    /^current date\b/i,
    /^goal:\s/i,
    /^important privacy constraint\b/i,
  ].some((pattern) => pattern.test(value));
}

function chatLabelFor(conversation: NormalizedConversation): string {
  const userLabels = conversation.messages
    .filter((message) => message.role === "user")
    .map((message) => (message.text ? cleanChatLabelCandidate(message.text) : undefined))
    .filter((label): label is string => Boolean(label));
  const userMessage = userLabels.find((label) => !isBoilerplateChatLabel(label)) ?? userLabels[0];
  if (userMessage) return userMessage;

  const titled = conversation.title ? cleanChatLabelCandidate(conversation.title) : undefined;
  if (titled) return titled;

  const anyMessage = conversation.messages.map((message) => (message.text ? cleanChatLabelCandidate(message.text) : undefined)).find(Boolean);
  return anyMessage ?? "Untitled chat";
}

function titleFor(conversation: NormalizedConversation, projectName: string): string {
  return `[agent-sync] ${conversation.provider} / ${projectName} / ${conversation.startedAt.slice(0, 10)} / ${chatLabelFor(conversation)}`;
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
    chatLabel: chatLabelFor(archived.conversation),
    conversationKind: archived.kind,
    parentConversationId: archived.parentConversationId,
    agentRole: archived.agentRole,
    agentNickname: archived.agentNickname,
    t3ProviderName: stringValue(archived.conversation.metadata.t3ProviderName),
    t3ProviderInstanceId: stringValue(archived.conversation.metadata.t3ProviderInstanceId),
  };
}

function fallbackModelSelection() {
  return {
    instanceId: "codex",
    model: "gpt-5.5",
    options: [{ id: "reasoningEffort", value: "medium" }],
  };
}

function importedModelSelection(archived: ArchivedConversation): Record<string, unknown> | undefined {
  if (archived.conversation.provider !== "t3code") return undefined;

  const raw = archived.conversation.metadata.t3ModelSelection;
  if (!isRecord(raw)) return undefined;

  const instanceId = stringValue(raw.instanceId);
  const model = stringValue(raw.model);
  if (!instanceId || !model) return undefined;

  return {
    ...raw,
    instanceId,
    model,
    options: Array.isArray(raw.options) ? raw.options : [],
  };
}

function modelSelectionJson(archived: ArchivedConversation, metadata: ReturnType<typeof metadataFor>): string {
  return JSON.stringify({
    ...(importedModelSelection(archived) ?? fallbackModelSelection()),
    agentSyncImport: metadata,
  });
}

function buildImportRecord(config: SyncConfig, archived: ArchivedConversation): T3ImportRecord {
  const conversation = archived.conversation;
  const metadata = metadataFor(archived);
  const createdAt = normalizedTimestamp(conversation.startedAt, new Date(0).toISOString());
  const updatedAt = normalizedTimestamp(conversation.updatedAt, createdAt);
  const threadId = `agent-sync:${stableHash(`${conversation.provider}:${conversation.providerConversationId}`)}`;
  const workspaceRoot = archiveWorkspaceRoot(config, archived);
  const projectId = `agent-sync:project:${stableHash(`${archived.projectName}:${workspaceRoot}`)}`;

  return {
    type: "agent-sync.t3-import.v1",
    project: {
      project_id: projectId,
      title: archived.projectName,
      workspace_root: workspaceRoot,
      scripts_json: "{}",
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: null,
      default_model_selection_json: JSON.stringify({
        ...(importedModelSelection(archived) ?? fallbackModelSelection()),
        agentSyncImport: { archiveRoot: expandHomePath(config.centralArchiveDir) },
      }),
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
      model_selection_json: modelSelectionJson(archived, metadata),
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

function applyExistingProject(record: T3ImportRecord, projectId: string): T3ImportRecord {
  return {
    ...record,
    project: {
      ...record.project,
      project_id: projectId,
    },
    thread: {
      ...record.thread,
      project_id: projectId,
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
    await runSqliteScript(databasePath, statements.join("\n"));
  }

  return imported;
}

async function runSqliteScript(databasePath: string, script: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("sqlite3", [databasePath], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    const stderr: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`sqlite3 exited with code ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
    child.stdin.end(script);
  });
}

async function exportRecords(exportPath: string, records: T3ImportRecord[]): Promise<number> {
  await mkdir(dirname(exportPath), { recursive: true });
  await writeFile(exportPath, `${records.map((record) => JSON.stringify(record)).join("\n")}${records.length > 0 ? "\n" : ""}`);
  return records.length;
}

export async function runPullT3(config: SyncConfig, options: PullT3Options = {}): Promise<PullT3Result> {
  const dryRun = options.dryRun ?? true;
  const filtered = filterArchived(await readArchivedConversations(config), options);
  const deduped = deduplicateArchived(filtered.conversations);
  const archived = deduped.conversations;
  const databasePath = expandHomePath(options.databasePath ?? defaultT3DatabasePath);
  const existingProjectRows = dryRun ? [] : await existingProjects(databasePath);
  const records = archived.map((item) => {
    const record = buildImportRecord(config, item);
    const projectId = existingProjectIdFor(item, existingProjectRows, record.project.workspace_root);
    return projectId ? applyExistingProject(record, projectId) : record;
  });
  const existing = dryRun || records.length === 0 ? new Set<string>() : await existingThreadIds(databasePath, records.map((record) => record.thread.thread_id));
  const exported = options.exportPath ? await exportRecords(options.exportPath, records) : 0;
  const imported = dryRun ? 0 : await importRecords(databasePath, records, existing);
  const skipped = dryRun ? 0 : records.length - imported;

  return {
    dryRun,
    planned: records.length,
    deduplicated: deduped.deduplicated,
    omittedSubagents: filtered.omittedSubagents,
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
      chatLabel: chatLabelFor(archived[index].conversation),
      messageCount: record.messages.length,
      alreadyImported: existing.has(record.thread.thread_id),
      kind: archived[index].kind,
      parentConversationId: archived[index].parentConversationId,
      agentRole: archived[index].agentRole,
      agentNickname: archived[index].agentNickname,
      t3ProviderName: stringValue(archived[index].conversation.metadata.t3ProviderName),
      t3ProviderInstanceId: stringValue(archived[index].conversation.metadata.t3ProviderInstanceId),
    })),
  };
}

type SummaryGroup = {
  conversations: number;
  messages: number;
};

function groupedSummary(items: PullT3Item[], key: "provider" | "project"): Array<[string, SummaryGroup]> {
  const groups = new Map<string, SummaryGroup>();
  for (const item of items) {
    const label = item[key];
    const group = groups.get(label) ?? { conversations: 0, messages: 0 };
    group.conversations += 1;
    group.messages += item.messageCount;
    groups.set(label, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function formatPullT3Result(result: PullT3Result, options: FormatPullT3Options = {}): string[] {
  const lines = [
    `dry-run: ${result.dryRun}`,
    `planned: ${result.planned}`,
    `deduplicated archive copies: ${result.deduplicated}`,
    `omitted subagents: ${result.omittedSubagents}`,
    `imported: ${result.imported}`,
    `skipped: ${result.skipped}`,
    `exported: ${result.exported}`,
    "by provider:",
    ...groupedSummary(result.items, "provider").map(
      ([provider, group]) => `  - ${provider}: ${group.conversations} conversations, ${group.messages} messages`
    ),
    "by project:",
    ...groupedSummary(result.items, "project").map(
      ([project, group]) => `  - ${project}: ${group.conversations} conversations, ${group.messages} messages`
    ),
  ];

  if (options.verbose) {
    lines.push("conversations:");
    for (const item of result.items) {
      const status = item.alreadyImported ? "already imported" : result.dryRun ? "would import" : "imported";
      const kind = item.kind === "subagent" ? `[subagent:${item.agentRole ?? "unknown"}] ` : "";
      const t3Provider = item.t3ProviderName ? `, t3 provider ${item.t3ProviderName}` : "";
      const parent = item.parentConversationId ? `, parent ${item.parentConversationId}` : "";
      lines.push(
        `- ${status}: ${kind}${item.title} (${item.messageCount} messages, source ${item.providerConversationId}${parent}${t3Provider})`
      );
    }
  } else {
    lines.push("Use --verbose to list every planned conversation.");
  }

  if (result.dryRun && result.planned > 0) {
    lines.push("No changes written. Re-run with --write --database <t3-state.sqlite> after reviewing this dry run.");
  }

  return lines;
}

function assertSelectionInRange(value: number, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`Selection ${value} is outside the valid range 1-${max}.`);
  }
}

export function summarizePullT3Projects(visibleItems: PullT3Item[], allItems: PullT3Item[] = visibleItems): PullT3ProjectSummary[] {
  const groups = new Map<string, PullT3ProjectSummary>();

  for (const item of visibleItems) {
    const group = groups.get(item.project) ?? {
      project: item.project,
      conversations: 0,
      messages: 0,
      subagents: 0,
    };
    group.conversations += 1;
    group.messages += item.messageCount;
    groups.set(item.project, group);
  }

  for (const item of allItems) {
    if (item.kind !== "subagent") continue;
    const group = groups.get(item.project) ?? {
      project: item.project,
      conversations: 0,
      messages: 0,
      subagents: 0,
    };
    group.subagents += 1;
    groups.set(item.project, group);
  }

  return [...groups.values()].sort((a, b) => a.project.localeCompare(b.project));
}

export function parsePullT3Selection(input: string, max: number): number[] {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "") return [];
  if (trimmed === "all") return Array.from({ length: max }, (_, index) => index);

  const selected = new Set<number>();
  for (const token of trimmed.split(",").map((part) => part.trim()).filter(Boolean)) {
    const rangeMatch = /^(\d+)-(\d+)$/.exec(token);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      if (end < start) throw new Error(`Invalid descending range: ${token}.`);
      assertSelectionInRange(start, max);
      assertSelectionInRange(end, max);
      for (let value = start; value <= end; value += 1) selected.add(value - 1);
      continue;
    }

    if (!/^\d+$/.test(token)) throw new Error(`Invalid selection token: ${token}.`);
    const value = Number.parseInt(token, 10);
    assertSelectionInRange(value, max);
    selected.add(value - 1);
  }

  return [...selected];
}
