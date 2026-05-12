import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { promisify } from "node:util";
import { createStableId } from "../core/fingerprints.js";
import type { NormalizedConversation, NormalizedMessage, ProviderAdapter, RawConversationRef, SyncConfig } from "../types.js";
import {
  buildConversation,
  discoverJsonRefs,
  expandHomePath,
  expandHomePaths,
  normalizeRole,
  readJsonRecords,
} from "./generic-json.js";

const execFileAsync = promisify(execFile);

const defaultPaths = [
  "~/.t3/userdata/state.sqlite",
  "~/.t3/dev/state.sqlite",
  "~/.config/t3code",
  "~/.config/t3code-dev",
];

type T3ThreadRefRow = {
  thread_id: string;
};

type T3MessageRow = {
  thread_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  branch?: string | null;
  worktree_path?: string | null;
  workspace_root?: string | null;
  project_title?: string | null;
  message_id: string;
  turn_id?: string | null;
  role: string;
  text: string;
  message_created_at: string;
  message_updated_at: string;
};

function shellSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function normalizeTimestamp(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

async function lstatIfAccessible(path: string) {
  try {
    return await lstat(path);
  } catch {
    return undefined;
  }
}

async function sqliteJson<T>(databasePath: string, sql: string): Promise<T[]> {
  try {
    const { stdout } = await execFileAsync("sqlite3", ["-readonly", "-json", databasePath, sql], {
      maxBuffer: 128 * 1024 * 1024,
    });
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? (JSON.parse(trimmed) as T[]) : [];
  } catch (error) {
    const stderr = typeof (error as { stderr?: unknown }).stderr === "string" ? (error as { stderr: string }).stderr : "";
    if (/no such table: projection_/i.test(stderr)) return [];
    throw new Error(`Failed to read T3 SQLite database ${databasePath}: ${(error as Error).message}`, { cause: error });
  }
}

async function discoverSqliteRefs(databasePath: string): Promise<RawConversationRef[]> {
  const rows = await sqliteJson<T3ThreadRefRow>(
    databasePath,
    `
      select t.thread_id
      from projection_threads t
      where t.deleted_at is null
        and exists (
          select 1
          from projection_thread_messages m
          where m.thread_id = t.thread_id
        )
      order by t.updated_at, t.thread_id
    `
  );

  return rows.map((row) => ({
    provider: "t3code",
    path: databasePath,
    kind: "sqlite",
    idHint: row.thread_id,
  }));
}

async function sqlitePathsFromConfiguredPath(path: string): Promise<string[]> {
  const expandedPath = expandHomePath(path);
  const pathStat = await lstatIfAccessible(expandedPath);
  if (!pathStat || pathStat.isSymbolicLink()) return [];

  if (pathStat.isFile()) {
    return extname(expandedPath).toLowerCase() === ".sqlite" ? [expandedPath] : [];
  }

  const candidates = [
    join(expandedPath, "state.sqlite"),
    join(expandedPath, "userdata", "state.sqlite"),
    join(expandedPath, "dev", "state.sqlite"),
  ];
  const discovered: string[] = [];

  for (const candidate of candidates) {
    const candidateStat = await lstatIfAccessible(candidate);
    if (candidateStat?.isFile() && !candidateStat.isSymbolicLink()) discovered.push(candidate);
  }

  return discovered;
}

async function discoverT3SqliteRefs(config: SyncConfig): Promise<RawConversationRef[]> {
  const refs = new Map<string, RawConversationRef>();
  const paths = config.providers.t3code?.paths ?? defaultPaths;

  for (const path of paths) {
    for (const sqlitePath of await sqlitePathsFromConfiguredPath(path)) {
      for (const ref of await discoverSqliteRefs(sqlitePath)) {
        refs.set(`${ref.path}:${ref.idHint ?? ""}`, ref);
      }
    }
  }

  return [...refs.values()].sort((a, b) => `${a.path}:${a.idHint ?? ""}`.localeCompare(`${b.path}:${b.idHint ?? ""}`));
}

async function readSqliteConversation(ref: RawConversationRef): Promise<NormalizedConversation> {
  if (!ref.idHint) throw new Error(`Missing T3 SQLite thread id for ${ref.path}`);

  const rows = await sqliteJson<T3MessageRow>(
    ref.path,
    `
      select
        t.thread_id,
        t.title,
        t.created_at,
        t.updated_at,
        t.branch,
        t.worktree_path,
        p.workspace_root,
        p.title as project_title,
        m.message_id,
        m.turn_id,
        m.role,
        m.text,
        m.created_at as message_created_at,
        m.updated_at as message_updated_at
      from projection_threads t
      left join projection_projects p on p.project_id = t.project_id
      join projection_thread_messages m on m.thread_id = t.thread_id
      where t.thread_id = ${shellSqlString(ref.idHint)}
        and t.deleted_at is null
      order by m.created_at, m.message_id
    `
  );
  if (rows.length === 0) throw new Error(`T3 SQLite thread not found: ${ref.idHint}`);

  const first = rows[0];
  const messages: NormalizedMessage[] = rows.map((row) => ({
    id: row.message_id,
    role: normalizeRole(row.role),
    createdAt: normalizeTimestamp(row.message_created_at),
    text: row.text,
    raw: {
      messageId: row.message_id,
      turnId: row.turn_id,
      updatedAt: normalizeTimestamp(row.message_updated_at),
    },
  }));
  const cwd = first.worktree_path || first.workspace_root || undefined;
  const metadata: Record<string, unknown> = {
    sqlitePath: ref.path,
  };

  if (cwd) metadata.cwd = cwd;
  if (first.workspace_root) metadata.workspace = first.workspace_root;
  if (first.branch) metadata.branch = first.branch;
  if (first.project_title) metadata.projectTitle = first.project_title;

  return {
    schemaVersion: 1,
    provider: "t3code",
    providerConversationId: first.thread_id,
    stableId: createStableId("t3code", first.thread_id, ref.path),
    title: first.title,
    startedAt: normalizeTimestamp(first.created_at) ?? messages[0]?.createdAt ?? new Date(0).toISOString(),
    updatedAt:
      normalizeTimestamp(first.updated_at) ??
      [...messages].reverse().find((message) => message.createdAt)?.createdAt ??
      normalizeTimestamp(first.created_at),
    source: {
      path: ref.path,
      kind: "sqlite",
    },
    messages,
    metadata,
  };
}

export const t3codeProvider: ProviderAdapter = {
  id: "t3code",
  label: "T3 Code",
  async discover(config) {
    const refs = new Map<string, RawConversationRef>();

    for (const ref of await discoverT3SqliteRefs(config)) refs.set(`${ref.path}:${ref.idHint ?? ""}`, ref);
    for (const ref of await discoverJsonRefs(config, "t3code", defaultPaths)) refs.set(`${ref.path}:${ref.idHint ?? ""}`, ref);

    return [...refs.values()].sort((a, b) => `${a.path}:${a.idHint ?? ""}`.localeCompare(`${b.path}:${b.idHint ?? ""}`));
  },
  async read(ref) {
    if (ref.kind === "sqlite") return readSqliteConversation(ref);

    return buildConversation("t3code", ref, await readJsonRecords(ref), {
      idField: "id",
      titleField: "title",
      cwdField: "cwd",
    });
  },
  watchPaths: (config) =>
    expandHomePaths(config.providers.t3code?.paths ?? defaultPaths).map((path) =>
      extname(path).toLowerCase() === ".sqlite" ? dirname(path) : path
    ),
};
