import { execFile } from "node:child_process";
import { mkdir, symlink, utimes, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { claudeCodeProvider } from "../src/providers/claude-code.js";
import { codexProvider } from "../src/providers/codex.js";
import { cursorProvider } from "../src/providers/cursor.js";
import { t3codeProvider } from "../src/providers/t3code.js";
import type { SyncConfig } from "../src/types.js";

const fixtureRoot = join(process.cwd(), "tests", "fixtures");
const execFileAsync = promisify(execFile);

function configWithProviderPath(provider: string, path: string): SyncConfig {
  return {
    projectRoots: ["/work"],
    centralArchiveDir: "/archive",
    unknownProjectDir: "/unknown-project",
    projectArchiveDir: ".agents/chats",
    providers: {
      [provider]: { enabled: true, paths: [path] },
    },
  };
}

function refPath(paths: { path: string }[], name: string): string {
  const ref = paths.find((item) => basename(item.path) === name);
  if (!ref) throw new Error(`Missing fixture ref: ${name}`);
  return ref.path;
}

describe("provider adapters", () => {
  it("codex provider reads jsonl conversations", async () => {
    const config = configWithProviderPath("codex", join(fixtureRoot, "codex"));

    const refs = await codexProvider.discover(config);
    const conversation = await codexProvider.read({
      provider: "codex",
      path: refPath(refs, "session.jsonl"),
      kind: "jsonl",
    });

    expect(conversation.provider).toBe("codex");
    expect(conversation.startedAt).toBe("2026-05-12T10:00:00.000Z");
    expect(conversation.messages).toHaveLength(2);
    expect(conversation.metadata.cwd).toBe("/work/app");
  });

  it("codex provider discovers rollout sessions and reads payload messages", async () => {
    const root = join(tmpdir(), `agent-sync-codex-rollout-${crypto.randomUUID()}`);
    const sessionDir = join(root, "sessions", "2026", "05", "12");
    const sessionPath = join(sessionDir, "rollout-2026-05-12T18-49-58-019e1d18-669d-7ef2-8321-234146880e59.jsonl");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      sessionPath,
      '{"timestamp":"2026-05-12T18:49:58.000Z","type":"session_meta","payload":{"id":"019e1d18-669d-7ef2-8321-234146880e59","cwd":"/work/app"}}\n' +
        '{"timestamp":"2026-05-12T18:50:00.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"codex rollout hello"}]}}\n' +
        '{"timestamp":"2026-05-12T18:51:00.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"codex rollout response"}]}}\n'
    );
    const config = configWithProviderPath("codex", root);

    const refs = await codexProvider.discover(config);
    const conversation = await codexProvider.read(refs[0]);

    expect(refs).toEqual([
      {
        provider: "codex",
        path: sessionPath,
        kind: "jsonl",
        idHint: "019e1d18-669d-7ef2-8321-234146880e59",
      },
    ]);
    expect(conversation.providerConversationId).toBe("019e1d18-669d-7ef2-8321-234146880e59");
    expect(conversation.startedAt).toBe("2026-05-12T18:49:58.000Z");
    expect(conversation.updatedAt).toBe("2026-05-12T18:51:00.000Z");
    expect(conversation.metadata.cwd).toBe("/work/app");
    expect(conversation.messages.map((message) => message.text)).toEqual(["codex rollout hello", "codex rollout response"]);
  });

  it("expands configured tilde paths without reading real home provider directories", async () => {
    const previousHome = process.env.HOME;
    process.env.HOME = join(fixtureRoot, "home");

    try {
      const config = configWithProviderPath("codex", "~/codex");

      const refs = await codexProvider.discover(config);

      expect(refs.map((ref) => ref.path)).toEqual([join(fixtureRoot, "home", "codex", "session.jsonl")]);
    } finally {
      process.env.HOME = previousHome;
    }
  });

  it("expands provider watch paths", () => {
    const previousHome = process.env.HOME;
    process.env.HOME = join(fixtureRoot, "home");

    try {
      const configured = codexProvider.watchPaths?.(configWithProviderPath("codex", "~/codex")) ?? [];
      const defaults = codexProvider.watchPaths?.({
        projectRoots: ["/work"],
        centralArchiveDir: "/archive",
        unknownProjectDir: "/unknown-project",
        projectArchiveDir: ".agents/chats",
        providers: { codex: { enabled: true } },
      }) ?? [];

      expect(configured).toEqual([join(fixtureRoot, "home", "codex")]);
      expect(defaults).toEqual([join(fixtureRoot, "home", ".codex"), join(fixtureRoot, "home", ".codex", "sessions")]);
    } finally {
      process.env.HOME = previousHome;
    }
  });

  it("ignores non-conversation files under provider directories", async () => {
    const root = join(tmpdir(), `agent-sync-provider-index-${crypto.randomUUID()}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "session.jsonl"), '{"id":"m1","role":"user","content":"inside"}\n');
    await writeFile(join(root, "session_index.jsonl"), '{"id":"idx","updatedAt":"2026-05-06T15:13:29.656Z"}\n');
    await writeFile(join(root, "conversation-cache.json"), "{}\n");
    const config = configWithProviderPath("codex", root);

    const refs = await codexProvider.discover(config);

    expect(refs.map((ref) => ref.path)).toEqual([join(root, "session.jsonl")]);
  });

  it("does not follow symlinks out of provider directories", async () => {
    const root = join(tmpdir(), `agent-sync-provider-${crypto.randomUUID()}`);
    const external = join(tmpdir(), `agent-sync-external-${crypto.randomUUID()}`);
    await mkdir(root, { recursive: true });
    await mkdir(external, { recursive: true });
    await writeFile(join(root, "session.jsonl"), '{"id":"m1","role":"user","content":"inside"}\n');
    await writeFile(join(external, "session.jsonl"), '{"id":"m2","role":"user","content":"outside"}\n');
    await symlink(external, join(root, "linked"));
    const config = configWithProviderPath("codex", root);

    const refs = await codexProvider.discover(config);

    expect(refs.map((ref) => ref.path)).toEqual([join(root, "session.jsonl")]);
  });

  it("skips configured provider roots that are symlinks", async () => {
    const root = join(tmpdir(), `agent-sync-provider-root-${crypto.randomUUID()}`);
    const external = join(tmpdir(), `agent-sync-external-root-${crypto.randomUUID()}`);
    await mkdir(root, { recursive: true });
    await mkdir(external, { recursive: true });
    await writeFile(join(external, "session.jsonl"), '{"id":"m1","role":"user","content":"outside"}\n');
    const linkedRoot = join(root, "linked-root");
    await symlink(external, linkedRoot);
    const config = configWithProviderPath("codex", linkedRoot);

    const refs = await codexProvider.discover(config);

    expect(refs).toEqual([]);
  });

  it("includes source path and line number for malformed JSONL errors", async () => {
    const path = join(fixtureRoot, "codex", "bad-session.jsonl");
    const config = configWithProviderPath("codex", path);

    const refs = await codexProvider.discover(config);

    await expect(codexProvider.read(refs[0])).rejects.toThrow(`${path}:2`);
  });

  it("uses source mtime when records have no timestamps", async () => {
    const path = join(fixtureRoot, "codex", "no-timestamp-session.jsonl");
    const mtime = new Date("2026-05-12T14:00:00.000Z");
    await utimes(path, mtime, mtime);
    const config = configWithProviderPath("codex", path);

    const refs = await codexProvider.discover(config);
    const conversation = await codexProvider.read(refs[0]);

    expect(conversation.startedAt).toBe("2026-05-12T14:00:00.000Z");
    expect(conversation.updatedAt).toBe("2026-05-12T14:00:00.000Z");
  });

  it("uses source mtime when provider timestamps are invalid", async () => {
    const path = join(fixtureRoot, "codex", "invalid-timestamp-session.jsonl");
    const mtime = new Date("2026-05-12T16:00:00.000Z");
    await utimes(path, mtime, mtime);
    const config = configWithProviderPath("codex", path);

    const refs = await codexProvider.discover(config);
    const conversation = await codexProvider.read(refs[0]);

    expect(conversation.startedAt).toBe("2026-05-12T16:00:00.000Z");
    expect(conversation.updatedAt).toBe("2026-05-12T16:00:00.000Z");
  });

  it("uses source mtime when provider timestamps are impossible dates", async () => {
    const path = join(fixtureRoot, "codex", "impossible-timestamp-session.jsonl");
    const mtime = new Date("2026-05-12T17:00:00.000Z");
    await utimes(path, mtime, mtime);
    const config = configWithProviderPath("codex", path);

    const refs = await codexProvider.discover(config);
    const conversation = await codexProvider.read(refs[0]);

    expect(conversation.startedAt).toBe("2026-05-12T17:00:00.000Z");
    expect(conversation.updatedAt).toBe("2026-05-12T17:00:00.000Z");
  });

  it("normalizes numeric provider timestamps from seconds and milliseconds", async () => {
    const path = join(fixtureRoot, "codex", "numeric-timestamp-session.jsonl");
    const config = configWithProviderPath("codex", path);

    const refs = await codexProvider.discover(config);
    const conversation = await codexProvider.read(refs[0]);

    expect(conversation.startedAt).toBe("2026-05-12T18:00:00.000Z");
    expect(conversation.updatedAt).toBe("2026-05-12T18:01:00.000Z");
    expect(conversation.messages[0].createdAt).toBe("2026-05-12T18:00:00.000Z");
  });

  it("normalizes ISO provider timestamps without millisecond precision", async () => {
    const root = join(tmpdir(), `agent-sync-iso-timestamp-${crypto.randomUUID()}`);
    const path = join(root, "session.jsonl");
    await mkdir(root, { recursive: true });
    await writeFile(path, '{"id":"m1","role":"user","content":"iso timestamp","timestamp":"2026-05-12T10:00:00Z"}\n');
    const config = configWithProviderPath("codex", path);

    const refs = await codexProvider.discover(config);
    const conversation = await codexProvider.read(refs[0]);

    expect(conversation.startedAt).toBe("2026-05-12T10:00:00.000Z");
    expect(conversation.messages[0].createdAt).toBe("2026-05-12T10:00:00.000Z");
  });

  it("normalizes ISO provider timestamps with timezone offsets", async () => {
    const root = join(tmpdir(), `agent-sync-offset-timestamp-${crypto.randomUUID()}`);
    const path = join(root, "session.jsonl");
    await mkdir(root, { recursive: true });
    await writeFile(
      path,
      '{"id":"m1","role":"user","content":"offset timestamp","timestamp":"2026-05-12T10:00:00+02:00"}\n'
    );
    const config = configWithProviderPath("codex", path);

    const refs = await codexProvider.discover(config);
    const conversation = await codexProvider.read(refs[0]);

    expect(conversation.startedAt).toBe("2026-05-12T08:00:00.000Z");
    expect(conversation.messages[0].createdAt).toBe("2026-05-12T08:00:00.000Z");
  });

  it("chooses updatedAt from parseable timestamps by numeric time", async () => {
    const path = join(fixtureRoot, "codex", "timestamp-order-session.jsonl");
    const config = configWithProviderPath("codex", path);

    const refs = await codexProvider.discover(config);
    const conversation = await codexProvider.read(refs[0]);

    expect(conversation.updatedAt).toBe("2026-05-12T09:00:00.000Z");
  });

  it("claude-code provider reads jsonl conversations", async () => {
    const config = configWithProviderPath("claude-code", join(fixtureRoot, "claude-code"));

    const refs = await claudeCodeProvider.discover(config);
    const conversation = await claudeCodeProvider.read(refs[0]);

    expect(conversation.provider).toBe("claude-code");
    expect(conversation.messages[0].text).toBe("hello");
  });

  it("claude-code provider discovers project UUID sessions and ignores plugin/cache files", async () => {
    const root = join(tmpdir(), `agent-sync-claude-projects-${crypto.randomUUID()}`);
    const encodedHome = `-${homedir().slice(1).replaceAll("/", "-")}`;
    const projectDir = join(root, "projects", `${encodedHome}-code-giggabit-invoice`);
    const pluginDir = join(projectDir, "vercel-plugin");
    const cacheDir = join(root, "cache");
    const sessionPath = join(projectDir, "9bed6517-8599-417d-aa82-6f945926df2c.jsonl");
    await mkdir(pluginDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    await writeFile(sessionPath, '{"uuid":"m1","type":"user","message":{"content":"hello"},"timestamp":"2026-05-12T10:00:00.000Z"}\n');
    await writeFile(join(pluginDir, "skill-injections.jsonl"), '{"content":"not a chat"}\n');
    await writeFile(join(cacheDir, "my-closed-issues.json"), "{}\n");
    const config = configWithProviderPath("claude-code", root);

    const refs = await claudeCodeProvider.discover(config);
    const conversation = await claudeCodeProvider.read(refs[0]);

    expect(refs.map((ref) => ref.path)).toEqual([sessionPath]);
    expect(conversation.metadata.cwd).toBe(join(homedir(), "code", "giggabit-invoice"));
    expect(conversation.messages[0].role).toBe("user");
    expect(conversation.messages[0].text).toBe("hello");
  });

  it("claude-code provider maps encoded t3 worktree sessions back to project roots", async () => {
    const root = join(tmpdir(), `agent-sync-claude-worktrees-${crypto.randomUUID()}`);
    const encodedHome = `-${homedir().slice(1).replaceAll("/", "-")}`;
    const projectDir = join(root, "projects", `${encodedHome}--t3-worktrees-liftpass-online-t3code-7d976d87`);
    const sessionPath = join(projectDir, "099f2334-5c50-4908-a8ff-e03b27c5adeb.jsonl");
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      sessionPath,
      '{"uuid":"m1","type":"user","message":{"content":"worktree"},"timestamp":"2026-05-12T10:00:00.000Z","cwd":"/tmp/worktree"}\n'
    );
    const config = configWithProviderPath("claude-code", root);

    const refs = await claudeCodeProvider.discover(config);
    const conversation = await claudeCodeProvider.read(refs[0]);

    expect(conversation.metadata.cwd).toBe("/tmp/worktree");
    expect(conversation.metadata.repo).toBe(join(homedir(), "code", "liftpass-online"));
  });

  it("cursor provider reads JSON conversations", async () => {
    const config = configWithProviderPath("cursor", join(fixtureRoot, "cursor"));

    const refs = await cursorProvider.discover(config);
    const conversation = await cursorProvider.read(refs[0]);

    expect(conversation.provider).toBe("cursor");
    expect(conversation.title).toBe("Cursor sync");
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0].text).toBe("cursor hello");
    expect(conversation.metadata.workspace).toBe("/work/app");
  });

  it("cursor provider discovers project agent transcripts and infers the project root", async () => {
    const root = join(tmpdir(), `agent-sync-cursor-projects-${crypto.randomUUID()}`);
    const projectDir = join(root, "home-jgigg-code-mountain-technologies-lifepass-neon-monorepo");
    const transcriptDir = join(projectDir, "agent-transcripts", "f4bed908-ce56-4cc7-b0e5-f4e592c70fee");
    const transcriptPath = join(transcriptDir, "f4bed908-ce56-4cc7-b0e5-f4e592c70fee.jsonl");
    await mkdir(transcriptDir, { recursive: true });
    await writeFile(
      transcriptPath,
      '{"role":"user","message":{"content":[{"text":"cursor transcript hello"}]}}\n' +
        '{"role":"assistant","message":{"content":[{"text":"cursor transcript response"}]}}\n'
    );
    const config = configWithProviderPath("cursor", root);

    const refs = await cursorProvider.discover(config);
    const conversation = await cursorProvider.read(refs[0]);

    expect(refs).toEqual([
      {
        provider: "cursor",
        path: transcriptPath,
        kind: "jsonl",
        idHint: "f4bed908-ce56-4cc7-b0e5-f4e592c70fee",
      },
    ]);
    expect(conversation.provider).toBe("cursor");
    expect(conversation.providerConversationId).toBe("f4bed908-ce56-4cc7-b0e5-f4e592c70fee");
    expect(conversation.messages.map((message) => message.text)).toEqual([
      "cursor transcript hello",
      "cursor transcript response",
    ]);
    expect(conversation.metadata.cwd).toBe("/home/jgigg/code/mountain-technologies-lifepass-neon-monorepo");
  });

  it("t3code provider reads JSON conversations", async () => {
    const config = configWithProviderPath("t3code", join(fixtureRoot, "t3code"));

    const refs = await t3codeProvider.discover(config);
    const conversation = await t3codeProvider.read(refs[0]);

    expect(conversation.provider).toBe("t3code");
    expect(conversation.title).toBe("T3 sync");
    expect(conversation.messages[0].text).toBe("t3 hello");
  });

  it("t3code provider discovers and reads SQLite thread projections", async () => {
    const root = join(tmpdir(), `agent-sync-t3-sqlite-${crypto.randomUUID()}`);
    const path = join(root, "state.sqlite");
    await mkdir(root, { recursive: true });
    await execFileAsync("sqlite3", [
      path,
      `
      create table projection_projects (
        project_id text primary key,
        title text not null,
        workspace_root text not null,
        scripts_json text not null,
        created_at text not null,
        updated_at text not null,
        deleted_at text
      );
      create table projection_threads (
        thread_id text primary key,
        project_id text not null,
        title text not null,
        branch text,
        worktree_path text,
        latest_turn_id text,
        created_at text not null,
        updated_at text not null,
        deleted_at text
      );
      create table projection_thread_messages (
        message_id text primary key,
        thread_id text not null,
        turn_id text,
        role text not null,
        text text not null,
        is_streaming integer not null,
        created_at text not null,
        updated_at text not null
      );
      insert into projection_projects values (
        'project-1',
        'Project',
        '/work/app',
        '{}',
        '2026-05-12T10:00:00.000Z',
        '2026-05-12T10:02:00.000Z',
        null
      );
      insert into projection_threads values (
        'thread-1',
        'project-1',
        'T3 SQLite sync',
        'staging',
        '/work/app',
        'turn-1',
        '2026-05-12T10:00:00.000Z',
        '2026-05-12T10:03:00.000Z',
        null
      );
      insert into projection_thread_messages values (
        'message-1',
        'thread-1',
        'turn-1',
        'user',
        't3 sqlite hello',
        0,
        '2026-05-12T10:01:00.000Z',
        '2026-05-12T10:01:00.000Z'
      );
      insert into projection_thread_messages values (
        'message-2',
        'thread-1',
        'turn-1',
        'assistant',
        't3 sqlite response',
        0,
        '2026-05-12T10:02:00.000Z',
        '2026-05-12T10:02:00.000Z'
      );
      `,
    ]);
    const config = configWithProviderPath("t3code", path);

    const refs = await t3codeProvider.discover(config);
    const conversation = await t3codeProvider.read(refs[0]);

    expect(refs).toEqual([
      {
        provider: "t3code",
        path,
        kind: "sqlite",
        idHint: "thread-1",
      },
    ]);
    expect(conversation.provider).toBe("t3code");
    expect(conversation.providerConversationId).toBe("thread-1");
    expect(conversation.title).toBe("T3 SQLite sync");
    expect(conversation.startedAt).toBe("2026-05-12T10:00:00.000Z");
    expect(conversation.updatedAt).toBe("2026-05-12T10:03:00.000Z");
    expect(conversation.messages.map((message) => message.text)).toEqual(["t3 sqlite hello", "t3 sqlite response"]);
    expect(conversation.metadata.cwd).toBe("/work/app");
    expect(conversation.metadata.branch).toBe("staging");
  });
});
