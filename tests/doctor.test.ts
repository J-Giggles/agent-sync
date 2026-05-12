import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDoctor } from "../src/core/doctor.js";
import type { SyncConfig } from "../src/types.js";

describe("runDoctor", () => {
  it("reports existing project roots and missing provider paths", async () => {
    const root = join(tmpdir(), `agent-sync-doctor-${crypto.randomUUID()}`);
    await mkdir(root, { recursive: true });

    const config: SyncConfig = {
      projectRoots: [root],
      centralArchiveDir: join(root, "archive"),
      unknownProjectDir: join(root, "unknown-project"),
      projectArchiveDir: ".agents/chats",
      providers: { codex: { enabled: true, paths: [join(root, "missing")] } },
    };

    const diagnostics = await runDoctor(config);

    expect(diagnostics.some((item) => item.level === "info" && item.message.includes(root))).toBe(true);
    expect(diagnostics.some((item) => item.level === "warn" && item.message.includes("missing"))).toBe(true);
  });

  it("distinguishes non-directory project roots and provider paths", async () => {
    const root = join(tmpdir(), `agent-sync-doctor-${crypto.randomUUID()}`);
    const filePath = join(root, "not-a-directory");
    await mkdir(root, { recursive: true });
    await writeFile(filePath, "{}\n");

    const config: SyncConfig = {
      projectRoots: [filePath],
      centralArchiveDir: join(root, "archive"),
      unknownProjectDir: join(root, "unknown-project"),
      projectArchiveDir: ".agents/chats",
      providers: { codex: { enabled: true, paths: [filePath] } },
    };

    const diagnostics = await runDoctor(config);

    expect(diagnostics.some((item) => item.level === "warn" && item.message.includes("Project root is not a directory"))).toBe(
      true
    );
    expect(diagnostics.some((item) => item.level === "warn" && item.message.includes("Provider path is not a directory"))).toBe(
      true
    );
  });

  it("reports project discovery and provider read diagnostics without writing archives", async () => {
    const root = join(tmpdir(), `agent-sync-doctor-${crypto.randomUUID()}`);
    const projectsRoot = join(root, "projects");
    const projectRoot = join(projectsRoot, "app");
    const providerDir = join(root, "provider");
    const archive = join(root, "archive");

    await mkdir(projectRoot, { recursive: true });
    await mkdir(providerDir, { recursive: true });
    await writeFile(join(projectRoot, "package.json"), "{}\n");
    await writeFile(join(providerDir, "bad-session.jsonl"), "{not json}\n");

    const diagnostics = await runDoctor({
      projectRoots: [projectsRoot],
      centralArchiveDir: archive,
      unknownProjectDir: join(root, "unknown-project"),
      projectArchiveDir: ".agents/chats",
      providers: { codex: { enabled: true, paths: [providerDir] } },
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          message: "Discovered projects: 1 (app)",
        }),
        expect.objectContaining({
          level: "info",
          provider: "codex",
          message: "Provider records discovered: 1",
        }),
        expect.objectContaining({
          level: "error",
          provider: "codex",
          sourcePath: join(providerDir, "bad-session.jsonl"),
          message: expect.stringContaining("Failed to read conversation"),
        }),
      ])
    );
  });

  it("warns when a discovered project is missing an ignore guard for project-local archives", async () => {
    const root = join(tmpdir(), `agent-sync-doctor-${crypto.randomUUID()}`);
    const projectsRoot = join(root, "projects");
    const projectRoot = join(projectsRoot, "app");

    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, "package.json"), "{}\n");

    const diagnostics = await runDoctor({
      projectRoots: [projectsRoot],
      centralArchiveDir: join(root, "archive"),
      unknownProjectDir: join(root, "unknown-project"),
      projectArchiveDir: ".agents/chats",
      providers: {},
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message: expect.stringContaining("Project archive is not ignored"),
          sourcePath: join(projectRoot, ".agents", "chats"),
        }),
      ])
    );
  });

  it("does not warn when a discovered project has an ignore guard for project-local archives", async () => {
    const root = join(tmpdir(), `agent-sync-doctor-${crypto.randomUUID()}`);
    const projectsRoot = join(root, "projects");
    const projectRoot = join(projectsRoot, "app");

    await mkdir(join(projectRoot, ".agents"), { recursive: true });
    await writeFile(join(projectRoot, "package.json"), "{}\n");
    await writeFile(join(projectRoot, ".agents", ".gitignore"), "chats/\n");

    const diagnostics = await runDoctor({
      projectRoots: [projectsRoot],
      centralArchiveDir: join(root, "archive"),
      unknownProjectDir: join(root, "unknown-project"),
      projectArchiveDir: ".agents/chats",
      providers: {},
    });

    expect(diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message: expect.stringContaining("Project archive is not ignored"),
        }),
      ])
    );
  });

  it("requires the less invasive .agents gitignore guard for default project-local archives", async () => {
    const root = join(tmpdir(), `agent-sync-doctor-${crypto.randomUUID()}`);
    const projectsRoot = join(root, "projects");
    const projectRoot = join(projectsRoot, "app");

    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, "package.json"), "{}\n");
    await writeFile(join(projectRoot, ".gitignore"), "/.agents/chats/\n");

    const diagnostics = await runDoctor({
      projectRoots: [projectsRoot],
      centralArchiveDir: join(root, "archive"),
      unknownProjectDir: join(root, "unknown-project"),
      projectArchiveDir: ".agents/chats",
      providers: {},
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message: expect.stringContaining("Project archive is not ignored"),
          sourcePath: join(projectRoot, ".agents", "chats"),
        }),
      ])
    );
  });

  it("can create missing project archive ignore guards without syncing chats", async () => {
    const root = join(tmpdir(), `agent-sync-doctor-${crypto.randomUUID()}`);
    const projectsRoot = join(root, "projects");
    const projectRoot = join(projectsRoot, "app");

    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, "package.json"), "{}\n");

    const diagnostics = await runDoctor(
      {
        projectRoots: [projectsRoot],
        centralArchiveDir: join(root, "archive"),
        unknownProjectDir: join(root, "unknown-project"),
        projectArchiveDir: ".agents/chats",
        providers: {},
      },
      { fixIgnoreGuards: true }
    );

    expect(await readFile(join(projectRoot, ".agents", ".gitignore"), "utf8")).toBe("chats/\n");
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          message: expect.stringContaining("Created project archive ignore guard"),
          sourcePath: join(projectRoot, ".agents", "chats"),
        }),
      ])
    );
    expect(diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message: expect.stringContaining("Project archive is not ignored"),
        }),
      ])
    );
  });

  it("does not read provider records while creating ignore guards", async () => {
    const root = join(tmpdir(), `agent-sync-doctor-${crypto.randomUUID()}`);
    const projectsRoot = join(root, "projects");
    const projectRoot = join(projectsRoot, "app");
    const providerDir = join(root, "provider");

    await mkdir(projectRoot, { recursive: true });
    await mkdir(providerDir, { recursive: true });
    await writeFile(join(projectRoot, "package.json"), "{}\n");
    await writeFile(join(providerDir, "bad-session.jsonl"), "{not json}\n");

    const diagnostics = await runDoctor(
      {
        projectRoots: [projectsRoot],
        centralArchiveDir: join(root, "archive"),
        unknownProjectDir: join(root, "unknown-project"),
        projectArchiveDir: ".agents/chats",
        providers: { codex: { enabled: true, paths: [providerDir] } },
      },
      { fixIgnoreGuards: true }
    );

    expect(await readFile(join(projectRoot, ".agents", ".gitignore"), "utf8")).toBe("chats/\n");
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          provider: "codex",
          message: "Provider discover/read skipped: fixing ignore guards",
        }),
      ])
    );
    expect(diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          provider: "codex",
          message: expect.stringContaining("Failed to read conversation"),
        }),
      ])
    );
  });
});
