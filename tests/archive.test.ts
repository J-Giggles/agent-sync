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

  it("fingerprints undefined distinctly from null", () => {
    expect(() => fingerprint(undefined)).not.toThrow();
    expect(fingerprint(undefined)).not.toBe(fingerprint(null));
  });

  it("fingerprints arrays with undefined distinctly from empty arrays", () => {
    expect(fingerprint([undefined])).not.toBe(fingerprint([]));
  });

  it("creates stable ids without delimiter collisions", () => {
    expect(createStableId("a:b", "c", "d")).not.toBe(createStableId("a", "b:c", "d"));
  });

  it("returns central and project targets for matched conversations", () => {
    const targets = archiveTargets(config, conversation);

    expect(targets.map((target) => target.jsonPath)).toEqual([
      "/sync/archive/my-app/2026/05/12/codex-20260512T103000Z-stable-abc.json",
      "/work/my-app/.agents/chats/2026/05/12/codex-20260512T103000Z-stable-abc.json",
    ]);
    expect(targets.map((target) => target.markdownPath)).toEqual([
      "/sync/archive/my-app/2026/05/12/codex-20260512T103000Z-stable-abc.md",
      "/work/my-app/.agents/chats/2026/05/12/codex-20260512T103000Z-stable-abc.md",
    ]);
  });

  it("returns only unknown-project targets for unmatched conversations", () => {
    const targets = archiveTargets(config, { ...conversation, project: undefined });

    expect(targets).toHaveLength(1);
    expect(targets[0].jsonPath).toBe("/sync/unknown-project/2026/05/12/codex-20260512T103000Z-stable-abc.json");
    expect(targets[0].markdownPath).toBe("/sync/unknown-project/2026/05/12/codex-20260512T103000Z-stable-abc.md");
  });

  it("throws a clear error for invalid startedAt values", () => {
    expect(() => archiveTargets(config, { ...conversation, startedAt: "not-a-date" })).toThrow(
      "Invalid conversation startedAt: not-a-date",
    );
  });

  it("throws a clear error for impossible calendar startedAt values", () => {
    expect(() => archiveTargets(config, { ...conversation, startedAt: "2026-02-30T00:00:00.000Z" })).toThrow(
      "Invalid conversation startedAt: 2026-02-30T00:00:00.000Z",
    );
  });
});
