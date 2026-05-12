import { join } from "node:path";
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

describe("provider adapters", () => {
  it("codex provider reads jsonl conversations", async () => {
    const config = configWithProviderPath("codex", join(fixtureRoot, "codex"));

    const refs = await codexProvider.discover(config);
    const conversation = await codexProvider.read(refs[0]);

    expect(conversation.provider).toBe("codex");
    expect(conversation.startedAt).toBe("2026-05-12T10:00:00.000Z");
    expect(conversation.messages).toHaveLength(2);
    expect(conversation.metadata.cwd).toBe("/work/app");
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
