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

  it("summarizes enabled providers, discovered projects, latest outputs, and unknown archive count", async () => {
    const root = join(tmpdir(), `agent-sync-status-${crypto.randomUUID()}`);
    const projectsRoot = join(root, "projects");
    const projectRoot = join(projectsRoot, "app");
    const archive = join(root, "archive");
    const unknown = join(root, "unknown-project");
    const outputPath = join(archive, "app", "2026", "05", "12", "codex-20260512T100000Z-abc.md");

    await mkdir(projectRoot, { recursive: true });
    await mkdir(archive, { recursive: true });
    await mkdir(join(unknown, "2026", "05", "12"), { recursive: true });
    await writeFile(join(projectRoot, "package.json"), "{}\n");
    await writeFile(join(unknown, "2026", "05", "12", "codex-unknown.json"), "{}\n");
    await writeFile(join(unknown, "2026", "05", "12", "codex-unknown.md"), "# Unknown\n");
    await writeFile(
      join(archive, ".agent-sync-manifest.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          updatedAt: "2026-05-12T10:30:00.000Z",
          written: 1,
          skipped: 2,
          diagnostics: [],
          conversations: [
            {
              provider: "codex",
              sourcePath: join(root, "provider", "session.jsonl"),
              projectName: "app",
              updatedAt: "2026-05-12T10:00:00.000Z",
              outputs: [outputPath],
            },
          ],
        },
        null,
        2
      )}\n`
    );

    const status = await readStatus({
      projectRoots: [projectsRoot],
      centralArchiveDir: archive,
      unknownProjectDir: unknown,
      projectArchiveDir: ".agents/chats",
      providers: { codex: { enabled: true, paths: [join(root, "provider")] } },
    });

    const lines = status.lines.join("\n");
    expect(status.level).toBe("info");
    expect(lines).toContain("enabled providers: codex");
    expect(lines).toContain("discovered projects: 1 (app)");
    expect(lines).toContain("latest synced conversations:");
    expect(lines).toContain(outputPath);
    expect(lines).toContain("unknown-project archive files: 2");
  });
});
