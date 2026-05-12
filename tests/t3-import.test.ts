import { execFile } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { formatPullT3Result, parsePullT3Selection, runPullT3, summarizePullT3Projects } from "../src/core/t3-import.js";
import type { SyncConfig } from "../src/types.js";

const execFileAsync = promisify(execFile);

async function makeTempRoot(name: string): Promise<string> {
  const root = join(tmpdir(), `${name}-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

async function createFixtureDatabase(path: string): Promise<void> {
  await execFileAsync("sqlite3", [path, `.read ${join(process.cwd(), "tests/fixtures/t3/projection-schema.sql")}`]);
}

async function sqliteRows<T>(databasePath: string, sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync("sqlite3", ["-json", databasePath, sql]);
  return stdout.trim() ? (JSON.parse(stdout) as T[]) : [];
}

async function fixtureConfig(root: string): Promise<SyncConfig> {
  const archive = join(root, "archive");
  await cp(join(process.cwd(), "tests/fixtures/normalized-archive"), archive, { recursive: true });
  return {
    projectRoots: [join(root, "projects")],
    centralArchiveDir: archive,
    unknownProjectDir: join(root, "unknown-project"),
    projectArchiveDir: ".agents/chats",
    providers: {},
  };
}

describe("runPullT3", () => {
  it("dry-runs by default without writing to the T3 projection database", async () => {
    const root = await makeTempRoot("agent-sync-t3-dry-run");
    const config = await fixtureConfig(root);
    const databasePath = join(root, "t3.sqlite");
    await createFixtureDatabase(databasePath);

    const result = await runPullT3(config, { databasePath });
    const threads = await sqliteRows(databasePath, "select thread_id from projection_threads");

    expect(result.dryRun).toBe(true);
    expect(result.planned).toBe(3);
    expect(result.deduplicated).toBe(1);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.items.map((item) => item.title)).toEqual([
      "[agent-sync] t3code / t3code / 2026-05-05 / Fixture T3 user message",
      "[agent-sync] claude-code / liftpass-online / 2026-05-08 / Fixture Claude user message",
      "[agent-sync] codex / agent-sync / 2026-05-12 / Fixture user message",
    ]);
    expect(threads).toEqual([]);
  });

  it("filters archive conversations by project provider since and limit", async () => {
    const root = await makeTempRoot("agent-sync-t3-filter");
    const config = await fixtureConfig(root);

    const result = await runPullT3(config, {
      dryRun: true,
      project: "agent-sync",
      provider: "codex",
      since: "2026-05-12",
      limit: 1,
    });

    expect(result.planned).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        provider: "codex",
        project: "agent-sync",
        providerConversationId: "codex-original-1",
        kind: "top-level",
        chatLabel: "Fixture user message",
      })
    );
  });

  it("generates a stable short chat label from the first meaningful user message", async () => {
    const root = await makeTempRoot("agent-sync-t3-label");
    const config = await fixtureConfig(root);

    const result = await runPullT3(config, {
      dryRun: true,
      project: "t3code",
      provider: "t3code",
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        chatLabel: "Fixture T3 user message",
        title: "[agent-sync] t3code / t3code / 2026-05-05 / Fixture T3 user message",
      })
    );
  });

  it("skips setup boilerplate when generating chat labels", async () => {
    const root = await makeTempRoot("agent-sync-t3-label-boilerplate");
    const config = await fixtureConfig(root);
    const fixturePath = join(
      config.centralArchiveDir,
      "label-project",
      "2026",
      "05",
      "12",
      "codex-20260512T120000Z-stable-label.json"
    );
    await mkdir(join(config.centralArchiveDir, "label-project", "2026", "05", "12"), { recursive: true });
    await writeFile(
      fixturePath,
      JSON.stringify(
        {
          schemaVersion: 1,
          provider: "codex",
          providerConversationId: "codex-label-1",
          stableId: "stable-label",
          project: {
            name: "label-project",
            root: "/work/label-project",
            matchedBy: "cwd",
          },
          startedAt: "2026-05-12T12:00:00.000Z",
          updatedAt: "2026-05-12T12:05:00.000Z",
          source: {
            path: "/provider/codex/label.jsonl",
            kind: "jsonl",
          },
          messages: [
            {
              id: "setup",
              role: "user",
              createdAt: "2026-05-12T12:00:00.000Z",
              text: "# AGENTS.md instructions for /work/label-project",
            },
            {
              id: "request",
              role: "user",
              createdAt: "2026-05-12T12:01:00.000Z",
              text: "Please build generated chat labels for the selector",
            },
          ],
          metadata: {
            cwd: "/work/label-project",
          },
        },
        null,
        2
      )
    );

    const result = await runPullT3(config, {
      dryRun: true,
      project: "label-project",
      provider: "codex",
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        chatLabel: "Please build generated chat labels for the selector",
        title: "[agent-sync] codex / label-project / 2026-05-12 / Please build generated chat labels for the selector",
      })
    );
  });

  it("hides subagent conversations by default", async () => {
    const root = await makeTempRoot("agent-sync-t3-hide-subagents");
    const config = await fixtureConfig(root);

    const result = await runPullT3(config, {
      dryRun: true,
      project: "agent-sync",
      provider: "codex",
    });

    expect(result.planned).toBe(1);
    expect(result.omittedSubagents).toBe(1);
    expect(result.items.map((item) => item.providerConversationId)).toEqual(["codex-original-1"]);
  });

  it("includes and labels subagent conversations when requested", async () => {
    const root = await makeTempRoot("agent-sync-t3-include-subagents");
    const config = await fixtureConfig(root);

    const result = await runPullT3(config, {
      dryRun: true,
      project: "agent-sync",
      provider: "codex",
      includeSubagents: true,
    });

    expect(result.planned).toBe(2);
    expect(result.omittedSubagents).toBe(0);
    expect(result.items[1]).toEqual(
      expect.objectContaining({
        providerConversationId: "codex-subagent-1",
        kind: "subagent",
        parentConversationId: "codex-original-1",
        agentRole: "worker",
      })
    );
  });

  it("filters archive conversations by selected source conversation keys", async () => {
    const root = await makeTempRoot("agent-sync-t3-selected-keys");
    const config = await fixtureConfig(root);

    const result = await runPullT3(config, {
      dryRun: true,
      selectedSourceConversationKeys: ["codex:codex-original-1"],
    });

    expect(result.planned).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        provider: "codex",
        providerConversationId: "codex-original-1",
        title: "[agent-sync] codex / agent-sync / 2026-05-12 / Fixture user message",
      })
    );
  });

  it("exports planned imports as NDJSON without writing to the database", async () => {
    const root = await makeTempRoot("agent-sync-t3-export");
    const config = await fixtureConfig(root);
    const databasePath = join(root, "t3.sqlite");
    const exportPath = join(root, "t3-import.ndjson");
    await createFixtureDatabase(databasePath);

    const result = await runPullT3(config, { databasePath, exportPath });
    const lines = (await readFile(exportPath, "utf8")).trim().split("\n");
    const first = JSON.parse(lines[0]) as { type: string; thread: { title: string }; messages: unknown[] };
    const threads = await sqliteRows(databasePath, "select thread_id from projection_threads");

    expect(result.exported).toBe(3);
    expect(result.imported).toBe(0);
    expect(lines).toHaveLength(3);
    expect(first.type).toBe("agent-sync.t3-import.v1");
    expect(first.thread.title).toBe("[agent-sync] t3code / t3code / 2026-05-05 / Fixture T3 user message");
    expect(first.messages).toHaveLength(2);
    expect(threads).toEqual([]);
  });

  it("imports idempotently and does not duplicate threads or messages", async () => {
    const root = await makeTempRoot("agent-sync-t3-import");
    const config = await fixtureConfig(root);
    const databasePath = join(root, "t3.sqlite");
    await createFixtureDatabase(databasePath);

    const first = await runPullT3(config, { databasePath, dryRun: false });
    const second = await runPullT3(config, { databasePath, dryRun: false });
    const threadRows = await sqliteRows<{ thread_id: string; title: string; model_selection_json: string }>(
      databasePath,
      "select thread_id, title, model_selection_json from projection_threads order by title"
    );
    const messageRows = await sqliteRows<{ message_id: string; attachments_json: string }>(
      databasePath,
      "select message_id, attachments_json from projection_thread_messages order by message_id"
    );
    const sessionRows = await sqliteRows<{ thread_id: string; provider_name: string }>(
      databasePath,
      "select thread_id, provider_name from projection_thread_sessions order by thread_id"
    );

    expect(first.imported).toBe(3);
    expect(first.skipped).toBe(0);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(3);
    expect(threadRows).toHaveLength(3);
    expect(messageRows).toHaveLength(5);
    expect(sessionRows).toHaveLength(3);
    expect(threadRows[0].thread_id).toMatch(/^agent-sync:/);
    expect(JSON.parse(threadRows[0].model_selection_json).agentSyncImport.sourceProvider).toBe("claude-code");
    expect(JSON.parse(messageRows[0].attachments_json).agentSyncImport.sourceArchivePath).toContain("archive");
  });

  it("attaches imported threads to an existing T3 project when the archive project matches", async () => {
    const root = await makeTempRoot("agent-sync-t3-existing-project");
    const config = await fixtureConfig(root);
    const databasePath = join(root, "t3.sqlite");
    await createFixtureDatabase(databasePath);
    await execFileAsync("sqlite3", [
      databasePath,
      `
      insert into projection_projects values (
        'existing-agent-sync-project',
        'agent-sync',
        '/work/agent-sync',
        '{}',
        '2026-05-12T09:00:00.000Z',
        '2026-05-12T09:00:00.000Z',
        null,
        '{}'
      );
      `,
    ]);

    const result = await runPullT3(config, {
      databasePath,
      dryRun: false,
      project: "agent-sync",
      provider: "codex",
    });
    const threadRows = await sqliteRows<{ project_id: string }>(
      databasePath,
      "select project_id from projection_threads where thread_id like 'agent-sync:%'"
    );
    const importedProjectRows = await sqliteRows<{ count: number }>(
      databasePath,
      "select count(*) as count from projection_projects where project_id like 'agent-sync:project:%'"
    );

    expect(result.imported).toBe(1);
    expect(threadRows).toEqual([{ project_id: "existing-agent-sync-project" }]);
    expect(importedProjectRows[0].count).toBe(0);
  });

  it("imports large conversations without exceeding command argument limits", async () => {
    const root = await makeTempRoot("agent-sync-t3-large-import");
    const config = await fixtureConfig(root);
    const databasePath = join(root, "t3.sqlite");
    await createFixtureDatabase(databasePath);
    const archiveDir = join(config.centralArchiveDir, "large-project", "2026", "05", "12");
    await mkdir(archiveDir, { recursive: true });
    await writeFile(
      join(archiveDir, "codex-20260512T120000Z-stable-large.json"),
      JSON.stringify({
        schemaVersion: 1,
        provider: "codex",
        providerConversationId: "codex-large-1",
        stableId: "stable-large",
        project: {
          name: "large-project",
          root: "/work/large-project",
          matchedBy: "cwd",
        },
        startedAt: "2026-05-12T12:00:00.000Z",
        updatedAt: "2026-05-12T13:00:00.000Z",
        source: {
          path: "/provider/codex/large.jsonl",
          kind: "jsonl",
        },
        messages: Array.from({ length: 900 }, (_, index) => ({
          id: `m${index}`,
          role: index % 2 === 0 ? "user" : "assistant",
          createdAt: "2026-05-12T12:00:00.000Z",
          text: `large message ${index} ${"x".repeat(200)}`,
        })),
        metadata: {
          cwd: "/work/large-project",
        },
      })
    );

    const result = await runPullT3(config, {
      databasePath,
      dryRun: false,
      project: "large-project",
      provider: "codex",
    });
    const messageRows = await sqliteRows<{ count: number }>(
      databasePath,
      "select count(*) as count from projection_thread_messages"
    );

    expect(result.imported).toBe(1);
    expect(messageRows[0].count).toBe(900);
  });

  it("deduplicates archive copies with the same provider conversation id", async () => {
    const root = await makeTempRoot("agent-sync-t3-deduplicate");
    const config = await fixtureConfig(root);

    const result = await runPullT3(config, { dryRun: true, provider: "t3code" });

    expect(result.planned).toBe(1);
    expect(result.deduplicated).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        provider: "t3code",
        providerConversationId: "t3-original-1",
        messageCount: 2,
      })
    );
    expect(result.items[0].sourceArchivePath).toContain("stable-t3-userdata");
  });

  it("formats dry-run output as a compact summary by default", () => {
    const lines = formatPullT3Result(
      {
        dryRun: true,
        planned: 2,
        deduplicated: 1,
        omittedSubagents: 0,
        imported: 0,
        skipped: 0,
        exported: 0,
        items: [
          {
            provider: "codex",
            project: "agent-sync",
            providerConversationId: "codex-original-1",
            sourceArchivePath: "/archive/agent-sync/codex.json",
            threadId: "agent-sync:codex",
            title: "[agent-sync] codex / agent-sync / 2026-05-12",
            chatLabel: "Fixture user message",
            messageCount: 2,
            alreadyImported: false,
            kind: "top-level",
          },
          {
            provider: "claude-code",
            project: "liftpass-online",
            providerConversationId: "claude-original-1",
            sourceArchivePath: "/archive/liftpass-online/claude.json",
            threadId: "agent-sync:claude",
            title: "[agent-sync] claude-code / liftpass-online / 2026-05-08",
            chatLabel: "Fixture Claude user message",
            messageCount: 1,
            alreadyImported: false,
            kind: "top-level",
          },
        ],
      },
      { verbose: false }
    );

    expect(lines).toContain("deduplicated archive copies: 1");
    expect(lines).toContain("omitted subagents: 0");
    expect(lines).toContain("by provider:");
    expect(lines).toContain("  - claude-code: 1 conversations, 1 messages");
    expect(lines).toContain("  - codex: 1 conversations, 2 messages");
    expect(lines).toContain("No changes written. Re-run with --write --database <t3-state.sqlite> after reviewing this dry run.");
    expect(lines).not.toContain("- would import: [agent-sync] codex / agent-sync / 2026-05-12 (2 messages)");
  });

  it("formats per-conversation dry-run output when verbose", () => {
    const lines = formatPullT3Result(
      {
        dryRun: true,
        planned: 1,
        deduplicated: 0,
        omittedSubagents: 0,
        imported: 0,
        skipped: 0,
        exported: 0,
        items: [
          {
            provider: "codex",
            project: "agent-sync",
            providerConversationId: "codex-original-1",
            sourceArchivePath: "/archive/agent-sync/codex.json",
            threadId: "agent-sync:codex",
            title: "[agent-sync] codex / agent-sync / 2026-05-12",
            chatLabel: "Fixture user message",
            messageCount: 2,
            alreadyImported: false,
            kind: "subagent",
            parentConversationId: "parent-1",
            agentRole: "worker",
            t3ProviderName: "claudeAgent",
          },
        ],
      },
      { verbose: true }
    );

    expect(lines).toContain(
      "- would import: [subagent:worker] [agent-sync] codex / agent-sync / 2026-05-12 (2 messages, source codex-original-1, parent parent-1, t3 provider claudeAgent)"
    );
  });

  it("summarizes hidden subagents per project for the interactive selector", () => {
    const visible = [
      {
        provider: "codex",
        project: "agent-sync",
        providerConversationId: "codex-original-1",
        sourceArchivePath: "/archive/agent-sync/codex.json",
        threadId: "agent-sync:codex",
        title: "[agent-sync] codex / agent-sync / 2026-05-12",
        chatLabel: "Fixture user message",
        messageCount: 2,
        alreadyImported: false,
        kind: "top-level" as const,
      },
    ];
    const summaries = summarizePullT3Projects(visible, [
      ...visible,
      {
        provider: "codex",
        project: "agent-sync",
        providerConversationId: "codex-subagent-1",
        sourceArchivePath: "/archive/agent-sync/codex-subagent.json",
        threadId: "agent-sync:codex-subagent",
        title: "[agent-sync] codex / agent-sync / 2026-05-12",
        chatLabel: "Fixture subagent user message",
        messageCount: 2,
        alreadyImported: false,
        kind: "subagent" as const,
        parentConversationId: "codex-original-1",
      },
      {
        provider: "codex",
        project: "agent-sync",
        providerConversationId: "codex-subagent-2",
        sourceArchivePath: "/archive/agent-sync/codex-subagent-2.json",
        threadId: "agent-sync:codex-subagent-2",
        title: "[agent-sync] codex / agent-sync / 2026-05-12",
        chatLabel: "Fixture subagent user message 2",
        messageCount: 3,
        alreadyImported: false,
        kind: "subagent" as const,
        parentConversationId: "codex-original-1",
      },
    ]);

    expect(summaries).toEqual([
      {
        project: "agent-sync",
        conversations: 1,
        messages: 2,
        subagents: 2,
      },
    ]);
  });

  it("parses interactive number and range selections", () => {
    expect(parsePullT3Selection("1,3-5", 6)).toEqual([0, 2, 3, 4]);
    expect(parsePullT3Selection("all", 3)).toEqual([0, 1, 2]);
    expect(parsePullT3Selection(" 2 , 2 , 1 ", 3)).toEqual([1, 0]);
    expect(parsePullT3Selection("", 3)).toEqual([]);
  });

  it("rejects invalid interactive selections", () => {
    expect(() => parsePullT3Selection("0", 3)).toThrow("Selection 0 is outside the valid range 1-3.");
    expect(() => parsePullT3Selection("4", 3)).toThrow("Selection 4 is outside the valid range 1-3.");
    expect(() => parsePullT3Selection("3-2", 3)).toThrow("Invalid descending range: 3-2.");
    expect(() => parsePullT3Selection("abc", 3)).toThrow("Invalid selection token: abc.");
  });
});
