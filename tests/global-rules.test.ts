import { lstat, mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installGlobalRules, planGlobalRuleInstall } from "../src/core/global-rules.js";

async function tempRoot(): Promise<string> {
  const root = join(tmpdir(), `agent-sync-global-rules-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

async function writeSourceRules(sourceRoot: string): Promise<void> {
  await mkdir(join(sourceRoot, "global", "codex"), { recursive: true });
  await mkdir(join(sourceRoot, "global", "claude"), { recursive: true });
  await writeFile(join(sourceRoot, "global", "codex", "AGENTS.md"), "# Codex rules\n");
  await writeFile(join(sourceRoot, "global", "claude", "CLAUDE.md"), "# Claude rules\n");
}

describe("global rule installer", () => {
  it("plans tracked agent-sync rules as symlink targets", async () => {
    const root = await tempRoot();
    const home = join(root, "home");
    const sourceRoot = join(root, "agent-sync");
    await writeSourceRules(sourceRoot);

    const plan = await planGlobalRuleInstall({ homeDir: home, sourceRoot });

    expect(plan).toEqual([
      {
        id: "codex-agents",
        label: "Codex AGENTS.md",
        sourcePath: join(sourceRoot, "global", "codex", "AGENTS.md"),
        linkPath: join(home, ".codex", "AGENTS.md"),
        action: "create",
      },
      {
        id: "claude-claude",
        label: "Claude CLAUDE.md",
        sourcePath: join(sourceRoot, "global", "claude", "CLAUDE.md"),
        linkPath: join(home, ".claude", "CLAUDE.md"),
        action: "create",
      },
    ]);
  });

  it("creates idempotent symlinks to agent-sync-owned rules", async () => {
    const root = await tempRoot();
    const home = join(root, "home");
    const sourceRoot = join(root, "agent-sync");
    await writeSourceRules(sourceRoot);

    const first = await installGlobalRules({ homeDir: home, sourceRoot });
    const second = await installGlobalRules({ homeDir: home, sourceRoot });

    expect(first.map((item) => item.action)).toEqual(["create", "create"]);
    expect(second.map((item) => item.action)).toEqual(["unchanged", "unchanged"]);
    expect(await readlink(join(home, ".codex", "AGENTS.md"))).toBe(join(sourceRoot, "global", "codex", "AGENTS.md"));
    expect(await readlink(join(home, ".claude", "CLAUDE.md"))).toBe(join(sourceRoot, "global", "claude", "CLAUDE.md"));
  });

  it("backs up existing files before replacing them with symlinks", async () => {
    const root = await tempRoot();
    const home = join(root, "home");
    const sourceRoot = join(root, "agent-sync");
    await writeSourceRules(sourceRoot);
    await mkdir(join(home, ".codex"), { recursive: true });
    await writeFile(join(home, ".codex", "AGENTS.md"), "# local codex rule\n");

    const result = await installGlobalRules({ homeDir: home, sourceRoot });

    const codex = result.find((item) => item.id === "codex-agents");
    expect(codex?.action).toBe("replace");
    expect(codex?.backupPath).toBe(join(home, ".codex", "AGENTS.md.bak"));
    expect(await readFile(join(home, ".codex", "AGENTS.md.bak"), "utf8")).toBe("# local codex rule\n");
    expect((await lstat(join(home, ".codex", "AGENTS.md"))).isSymbolicLink()).toBe(true);
  });

  it("does not modify the home directory during a dry run", async () => {
    const root = await tempRoot();
    const home = join(root, "home");
    const sourceRoot = join(root, "agent-sync");
    await writeSourceRules(sourceRoot);

    const result = await installGlobalRules({ homeDir: home, sourceRoot, dryRun: true });

    expect(result.map((item) => item.action)).toEqual(["create", "create"]);
    await expect(lstat(join(home, ".codex", "AGENTS.md"))).rejects.toThrow();
    await expect(lstat(join(home, ".claude", "CLAUDE.md"))).rejects.toThrow();
  });
});
