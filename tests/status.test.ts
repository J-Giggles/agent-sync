import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readStatus } from "../src/cli.js";
import type { SyncConfig } from "../src/types.js";

function configWithArchive(archive: string): SyncConfig {
  return {
    projectRoots: ["/work"],
    centralArchiveDir: archive,
    unknownProjectDir: "/unknown-project",
    projectArchiveDir: ".agents/chats",
    providers: {},
  };
}

describe("readStatus", () => {
  it("returns a useful message for malformed manifests", async () => {
    const root = join(tmpdir(), `agent-sync-status-${crypto.randomUUID()}`);
    const archive = join(root, "archive");
    await mkdir(archive, { recursive: true });
    await writeFile(join(archive, ".agent-sync-manifest.json"), "{not json}\n");

    const status = await readStatus(configWithArchive(archive));

    expect(status.level).toBe("error");
    expect(status.lines.join("\n")).toContain("Could not parse sync manifest");
  });
});
