import { lstat, mkdir, readlink, readdir, rename, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type AgentConfigInstallAction = "create" | "replace" | "unchanged";

export type AgentConfigInstallPlanItem = {
  id: string;
  label: string;
  sourcePath: string;
  linkPath: string;
  action: AgentConfigInstallAction;
  backupPath?: string;
};

export type AgentConfigInstallOptions = {
  homeDir?: string;
  sourceRoot?: string;
  dryRun?: boolean;
};

type AgentConfigSpec = {
  id: string;
  label: string;
  sourceRelativePath: string;
  linkRelativePath: string;
};

const BASE_AGENT_CONFIG_SPECS: AgentConfigSpec[] = [
  {
    id: "codex-agents",
    label: "Codex AGENTS.md",
    sourceRelativePath: "global/codex/AGENTS.md",
    linkRelativePath: ".codex/AGENTS.md",
  },
  {
    id: "claude-claude",
    label: "Claude CLAUDE.md",
    sourceRelativePath: "global/claude/CLAUDE.md",
    linkRelativePath: ".claude/CLAUDE.md",
  },
  {
    id: "claude-settings",
    label: "Claude settings.json",
    sourceRelativePath: "global/claude/settings.json",
    linkRelativePath: ".claude/settings.json",
  },
  {
    id: "codex-config",
    label: "Codex config.toml",
    sourceRelativePath: "global/codex/config.toml",
    linkRelativePath: ".codex/config.toml",
  },
  {
    id: "codex-sync",
    label: "codex-sync wrapper",
    sourceRelativePath: "global/bin/codex-sync",
    linkRelativePath: ".local/bin/codex-sync",
  },
  {
    id: "agent-sync-pull",
    label: "agent-sync pull helper",
    sourceRelativePath: "global/bin/agent-sync-pull",
    linkRelativePath: ".local/bin/agent-sync-pull",
  },
  {
    id: "agent-sync-push",
    label: "agent-sync push helper",
    sourceRelativePath: "global/bin/agent-sync-push",
    linkRelativePath: ".local/bin/agent-sync-push",
  },
];

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function isSymlinkTo(linkPath: string, sourcePath: string): Promise<boolean> {
  try {
    const stat = await lstat(linkPath);
    return stat.isSymbolicLink() && resolve(dirname(linkPath), await readlink(linkPath)) === sourcePath;
  } catch {
    return false;
  }
}

async function nextBackupPath(linkPath: string): Promise<string> {
  const first = `${linkPath}.bak`;
  if (!(await pathExists(first))) return first;

  let index = 2;
  while (await pathExists(`${first}.${index}`)) {
    index += 1;
  }
  return `${first}.${index}`;
}

async function requireSource(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() && !stat.isDirectory()) throw new Error(`${path} is not a file or directory`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Missing agent config source: ${path}`);
    }
    throw error;
  }
}

export async function findAgentConfigSourceRoot(startDir = process.cwd()): Promise<string> {
  let current = resolve(startDir);

  while (true) {
    if (await pathExists(join(current, "global", "codex", "AGENTS.md"))) return current;

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(`Could not find agent-sync global config sources from ${startDir}`);
}

async function skillSpecs(sourceRoot: string): Promise<AgentConfigSpec[]> {
  const skillsRoot = join(sourceRoot, "global", "claude", "skills");
  let entries;
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      id: `claude-skill:${entry.name}`,
      label: `Claude skill ${entry.name}`,
      sourceRelativePath: `global/claude/skills/${entry.name}`,
      linkRelativePath: `.claude/skills/${entry.name}`,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function allSpecs(sourceRoot: string): Promise<AgentConfigSpec[]> {
  return [...BASE_AGENT_CONFIG_SPECS, ...(await skillSpecs(sourceRoot))];
}

export async function planAgentConfigInstall(options: AgentConfigInstallOptions = {}): Promise<AgentConfigInstallPlanItem[]> {
  const homeDir = resolve(options.homeDir ?? process.env.HOME ?? "");
  const sourceRoot = resolve(options.sourceRoot ?? (await findAgentConfigSourceRoot()));
  const specs = await allSpecs(sourceRoot);

  return Promise.all(
    specs.map(async (spec) => {
      const sourcePath = join(sourceRoot, spec.sourceRelativePath);
      const linkPath = join(homeDir, spec.linkRelativePath);
      await requireSource(sourcePath);

      if (await isSymlinkTo(linkPath, sourcePath)) {
        return {
          id: spec.id,
          label: spec.label,
          sourcePath,
          linkPath,
          action: "unchanged" as const,
        };
      }

      if (await pathExists(linkPath)) {
        return {
          id: spec.id,
          label: spec.label,
          sourcePath,
          linkPath,
          action: "replace" as const,
          backupPath: await nextBackupPath(linkPath),
        };
      }

      return {
        id: spec.id,
        label: spec.label,
        sourcePath,
        linkPath,
        action: "create" as const,
      };
    })
  );
}

export async function installAgentConfig(options: AgentConfigInstallOptions = {}): Promise<AgentConfigInstallPlanItem[]> {
  const plan = await planAgentConfigInstall(options);
  if (options.dryRun) return plan;

  for (const item of plan) {
    if (item.action === "unchanged") continue;

    await mkdir(dirname(item.linkPath), { recursive: true });
    if (item.action === "replace") {
      if (!item.backupPath) throw new Error(`Missing backup path for ${item.linkPath}`);
      await rename(item.linkPath, item.backupPath);
    }
    await symlink(item.sourcePath, item.linkPath);
  }

  return plan;
}
