import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

async function tempDir() {
  const dir = join(tmpdir(), `agent-sync-config-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("loadConfig", () => {
  it("loads agent-sync.config.json from cwd", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, "agent-sync.config.json"),
      JSON.stringify({
        projectRoots: ["/tmp/projects"],
        centralArchiveDir: "/tmp/archive",
        unknownProjectDir: "/tmp/unknown",
        projectArchiveDir: ".agents/chats",
        providers: { codex: { enabled: true } },
      })
    );

    const config = await loadConfig(dir);

    expect(config.projectRoots).toEqual(["/tmp/projects"]);
    expect(config.providers.codex.enabled).toBe(true);
  });

  it("returns defaults when no config file exists", async () => {
    const dir = await tempDir();
    const config = await loadConfig(dir);

    expect(config.projectRoots).toEqual(["~/code"]);
    expect(config.providers.cursor.enabled).toBe(true);
    expect(config.projectArchiveDir).toBe(".agents/chats");
  });
});
