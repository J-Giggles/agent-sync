import { mkdir, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeCodeProvider } from "../src/providers/claude-code.js";
import { codexProvider } from "../src/providers/codex.js";
import { cursorProvider } from "../src/providers/cursor.js";
import { t3codeProvider } from "../src/providers/t3code.js";
import type { SyncConfig } from "../src/types.js";

const fixtureRoot = join(process.cwd(), "tests", "fixtures");

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
    const config = configWithProviderPath("codex", join(fixtureRoot, "codex"));

    const refs = await codexProvider.discover(config);

    expect(refs.map((ref) => ref.path).sort()).toContain(join(fixtureRoot, "codex", "session.jsonl"));
    expect(refs.map((ref) => ref.path)).not.toContain(join(fixtureRoot, "codex", "auth.json"));
    expect(refs.map((ref) => ref.path)).not.toContain(join(fixtureRoot, "codex", "settings.json"));
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

  it("t3code provider reads JSON conversations", async () => {
    const config = configWithProviderPath("t3code", join(fixtureRoot, "t3code"));

    const refs = await t3codeProvider.discover(config);
    const conversation = await t3codeProvider.read(refs[0]);

    expect(conversation.provider).toBe("t3code");
    expect(conversation.title).toBe("T3 sync");
    expect(conversation.messages[0].text).toBe("t3 hello");
  });
});
