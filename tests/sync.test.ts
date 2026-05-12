import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { runSync } from "../src/core/sync.js";
import type { SyncConfig } from "../src/types.js";

async function makeTempRoot(name: string): Promise<string> {
  const root = join(tmpdir(), `${name}-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

async function listFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => relative(root, join(entry.parentPath, entry.name)))
      .sort();
  } catch {
    return [];
  }
}

function archiveFiles(files: string[]): string[] {
  return files.filter((file) => file.endsWith(".json") || file.endsWith(".md"));
}

describe("runSync", () => {
  it("writes matched conversations to central and project archives and unmatched conversations only to unknown", async () => {
    const root = await makeTempRoot("agent-sync-run");
    const projectsRoot = join(root, "projects");
    const providerDir = join(root, "provider");
    const projectRoot = join(projectsRoot, "app");
    const archive = join(root, "archive");
    const unknown = join(root, "unknown-project");

    await mkdir(providerDir, { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, "package.json"), "{}\n");
    await writeFile(
      join(providerDir, "matched-session.jsonl"),
      `${JSON.stringify({
        id: "m1",
        role: "user",
        content: "hello from matched",
        timestamp: "2026-05-12T10:00:00.000Z",
        cwd: projectRoot,
      })}\n`
    );
    await writeFile(
      join(providerDir, "unknown-session.jsonl"),
      `${JSON.stringify({
        id: "u1",
        role: "user",
        content: "hello from elsewhere",
        timestamp: "2026-05-12T11:00:00.000Z",
        cwd: "/elsewhere",
      })}\n`
    );

    const config: SyncConfig = {
      projectRoots: [projectsRoot],
      centralArchiveDir: archive,
      unknownProjectDir: unknown,
      projectArchiveDir: ".agents/chats",
      providers: { codex: { enabled: true, paths: [providerDir] } },
    };

    const first = await runSync(config);
    const second = await runSync(config);

    expect(first.diagnostics).toEqual([]);
    expect(first.written).toBe(6);
    expect(first.skipped).toBe(0);
    expect(second.written).toBe(0);
    expect(second.skipped).toBe(6);
    expect(second.diagnostics).toEqual([]);

    const centralMatched = archiveFiles(await listFiles(join(archive, "app")));
    const projectLocal = archiveFiles(await listFiles(join(projectRoot, ".agents", "chats")));
    const unknownFiles = archiveFiles(await listFiles(unknown));

    expect(centralMatched).toHaveLength(2);
    expect(centralMatched.some((file) => file.endsWith(".json"))).toBe(true);
    expect(centralMatched.some((file) => file.endsWith(".md"))).toBe(true);
    expect(projectLocal).toHaveLength(2);
    expect(projectLocal.some((file) => file.endsWith(".json"))).toBe(true);
    expect(projectLocal.some((file) => file.endsWith(".md"))).toBe(true);
    expect(unknownFiles).toHaveLength(2);
    expect(unknownFiles.some((file) => file.endsWith(".json"))).toBe(true);
    expect(unknownFiles.some((file) => file.endsWith(".md"))).toBe(true);

    expect(projectLocal.join("\n")).not.toContain("unknown");
    expect(await listFiles(archive)).toContain(".agent-sync-manifest.json");

    const manifest = JSON.parse(await readFile(join(archive, ".agent-sync-manifest.json"), "utf8")) as {
      schemaVersion: number;
      written: number;
      skipped: number;
      diagnostics: unknown[];
    };
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.written).toBe(0);
    expect(manifest.skipped).toBe(6);
    expect(manifest.diagnostics).toEqual([]);
  });

  it("reports malformed provider files and continues syncing valid conversations", async () => {
    const root = await makeTempRoot("agent-sync-failure-isolation");
    const projectsRoot = join(root, "projects");
    const providerDir = join(root, "provider");
    const projectRoot = join(projectsRoot, "app");
    const archive = join(root, "archive");
    const unknown = join(root, "unknown-project");

    await mkdir(providerDir, { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, "package.json"), "{}\n");
    await writeFile(join(providerDir, "bad-session.jsonl"), "{not json}\n");
    await writeFile(
      join(providerDir, "good-session.jsonl"),
      `${JSON.stringify({
        id: "m1",
        role: "user",
        content: "valid survives",
        timestamp: "2026-05-12T10:00:00.000Z",
        cwd: projectRoot,
      })}\n`
    );

    const config: SyncConfig = {
      projectRoots: [projectsRoot],
      centralArchiveDir: archive,
      unknownProjectDir: unknown,
      projectArchiveDir: ".agents/chats",
      providers: { codex: { enabled: true, paths: [providerDir] } },
    };

    const result = await runSync(config);

    expect(result.written).toBe(4);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        level: "error",
        provider: "codex",
        sourcePath: join(providerDir, "bad-session.jsonl"),
      }),
    ]);
    expect(archiveFiles(await listFiles(join(archive, "app")))).toHaveLength(2);
    expect(archiveFiles(await listFiles(join(projectRoot, ".agents", "chats")))).toHaveLength(2);
  });
});
