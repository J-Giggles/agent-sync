import { describe, expect, it } from "vitest";
import { createStableId, fingerprint } from "../src/core/fingerprints.js";
import { archiveTargets } from "../src/core/archive-paths.js";
import type { NormalizedConversation, SyncConfig } from "../src/types.js";

const config: SyncConfig = {
  projectRoots: ["/work"],
  centralArchiveDir: "/sync/archive",
  unknownProjectDir: "/sync/unknown-project",
  projectArchiveDir: ".agents/chats",
  providers: {},
};

const conversation: NormalizedConversation = {
  schemaVersion: 1,
  provider: "codex",
  providerConversationId: "abc",
  stableId: "stable-abc",
  title: "Plan sync",
  project: { name: "my-app", root: "/work/my-app", matchedBy: "cwd" },
  startedAt: "2026-05-12T10:30:00.000Z",
  source: { path: "~/.codex/session.jsonl", kind: "jsonl" },
  messages: [{ role: "user", text: "hello" }],
  metadata: {},
};

describe("archive paths", () => {
  it("creates deterministic stable ids", () => {
    expect(createStableId("codex", "abc", "/tmp/a")).toBe(createStableId("codex", "abc", "/tmp/a"));
  });

  it("creates deterministic fingerprints", () => {
    expect(fingerprint({ b: 2, a: 1 })).toBe(fingerprint({ a: 1, b: 2 }));
  });

  it("returns central and project targets for matched conversations", () => {
    const targets = archiveTargets(config, conversation);

    expect(targets.map((target) => target.jsonPath)).toEqual([
      "/sync/archive/my-app/2026/05/12/codex-20260512T103000Z-stable-abc.json",
      "/work/my-app/.agents/chats/2026/05/12/codex-20260512T103000Z-stable-abc.json",
    ]);
  });

  it("returns only unknown-project targets for unmatched conversations", () => {
    const targets = archiveTargets(config, { ...conversation, project: undefined });

    expect(targets).toHaveLength(1);
    expect(targets[0].jsonPath).toBe("/sync/unknown-project/2026/05/12/codex-20260512T103000Z-stable-abc.json");
  });
});
