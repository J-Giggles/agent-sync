import { lstat, mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installAgentConfig, planAgentConfigInstall } from "../src/core/agent-config.js";

async function tempRoot(): Promise<string> {
  const root = join(tmpdir(), `agent-sync-config-install-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

async function writeSourceTree(sourceRoot: string): Promise<void> {
  const files = {
    "global/codex/AGENTS.md": "# Codex\n",
    "global/codex/config.toml": 'model = "gpt-5.5"\n',
    "global/claude/CLAUDE.md": "# Claude\n",
    "global/claude/settings.json": "{}\n",
    "global/bin/codex-sync": "#!/usr/bin/env bash\n",
    "global/bin/agent-sync-pull": "#!/usr/bin/env bash\n",
    "global/bin/agent-sync-push": "#!/usr/bin/env bash\n",
    "global/claude/skills/custom-skill/SKILL.md": "---\nname: custom-skill\n---\n",
  };

  await Promise.all(
    Object.keys(files).map(async (path) => {
      await mkdir(join(sourceRoot, path, ".."), { recursive: true });
    })
  );

  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(sourceRoot, path, ".."), { recursive: true });
    await writeFile(join(sourceRoot, path), content);
  }
}

describe("agent config installer", () => {
  it("plans every global config link needed to replace dotfiles", async () => {
    const root = await tempRoot();
    const home = join(root, "home");
    const sourceRoot = join(root, "agent-sync");
    await writeSourceTree(sourceRoot);

    const plan = await planAgentConfigInstall({ homeDir: home, sourceRoot });

    expect(plan.map((item) => [item.id, item.action, item.linkPath])).toEqual([
      ["codex-agents", "create", join(home, ".codex", "AGENTS.md")],
      ["claude-claude", "create", join(home, ".claude", "CLAUDE.md")],
      ["claude-settings", "create", join(home, ".claude", "settings.json")],
      ["codex-config", "create", join(home, ".codex", "config.toml")],
      ["codex-sync", "create", join(home, ".local", "bin", "codex-sync")],
      ["agent-sync-pull", "create", join(home, ".local", "bin", "agent-sync-pull")],
      ["agent-sync-push", "create", join(home, ".local", "bin", "agent-sync-push")],
      ["claude-skill:custom-skill", "create", join(home, ".claude", "skills", "custom-skill")],
    ]);
  });

  it("installs files and skill directories idempotently", async () => {
    const root = await tempRoot();
    const home = join(root, "home");
    const sourceRoot = join(root, "agent-sync");
    await writeSourceTree(sourceRoot);

    const first = await installAgentConfig({ homeDir: home, sourceRoot });
    const second = await installAgentConfig({ homeDir: home, sourceRoot });

    expect(first.every((item) => item.action === "create")).toBe(true);
    expect(second.every((item) => item.action === "unchanged")).toBe(true);
    expect(await readlink(join(home, ".codex", "config.toml"))).toBe(join(sourceRoot, "global", "codex", "config.toml"));
    expect(await readlink(join(home, ".claude", "skills", "custom-skill"))).toBe(
      join(sourceRoot, "global", "claude", "skills", "custom-skill")
    );
  });

  it("backs up existing links or files before replacing them", async () => {
    const root = await tempRoot();
    const home = join(root, "home");
    const sourceRoot = join(root, "agent-sync");
    await writeSourceTree(sourceRoot);
    await mkdir(join(home, ".claude"), { recursive: true });
    await writeFile(join(home, ".claude", "settings.json"), "{\"local\":true}\n");

    const result = await installAgentConfig({ homeDir: home, sourceRoot });
    const settings = result.find((item) => item.id === "claude-settings");

    expect(settings?.action).toBe("replace");
    expect(settings?.backupPath).toBe(join(home, ".claude", "settings.json.bak"));
    expect(await readFile(join(home, ".claude", "settings.json.bak"), "utf8")).toBe("{\"local\":true}\n");
    expect((await lstat(join(home, ".claude", "settings.json"))).isSymbolicLink()).toBe(true);
  });
});
