import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/core/render.js";
import type { NormalizedConversation } from "../src/types.js";

describe("renderMarkdown", () => {
  it("renders readable conversation markdown", () => {
    const markdown = renderMarkdown({
      schemaVersion: 1,
      provider: "codex",
      providerConversationId: "abc",
      stableId: "stable-abc",
      title: "Sync design",
      startedAt: "2026-05-12T10:30:00.000Z",
      source: { path: "/tmp/session.jsonl", kind: "jsonl" },
      messages: [
        { role: "user", text: "Build this" },
        { role: "assistant", text: "Here is the plan" },
      ],
      metadata: { cwd: "/work/app" },
    } satisfies NormalizedConversation);

    expect(markdown).toContain("# Sync design");
    expect(markdown).toContain("Provider: codex");
    expect(markdown).toContain("## user");
    expect(markdown).toContain("Build this");
  });
});
