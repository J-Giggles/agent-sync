import { constants } from "node:fs";
import { access, lstat, mkdir, readlink, rename, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type GlobalRuleId = "codex-agents" | "claude-claude";

export type GlobalRuleInstallAction = "create" | "replace" | "unchanged";

export type GlobalRuleInstallPlanItem = {
  id: GlobalRuleId;
  label: string;
  sourcePath: string;
  linkPath: string;
  action: GlobalRuleInstallAction;
  backupPath?: string;
};

export type GlobalRuleInstallOptions = {
  homeDir?: string;
  sourceRoot?: string;
  dryRun?: boolean;
};

type GlobalRuleSpec = {
  id: GlobalRuleId;
  label: string;
  sourceRelativePath: string;
  linkRelativePath: string;
};

const GLOBAL_RULE_SPECS: GlobalRuleSpec[] = [
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
];

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
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

async function requireSourceFile(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile()) throw new Error(`${path} is not a file`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Missing global rule source: ${path}`);
    }
    throw error;
  }
}

export async function findGlobalRuleSourceRoot(startDir = process.cwd()): Promise<string> {
  let current = resolve(startDir);

  while (true) {
    if (await pathExists(join(current, "global", "codex", "AGENTS.md"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(`Could not find agent-sync global rule sources from ${startDir}`);
}

export async function planGlobalRuleInstall(options: GlobalRuleInstallOptions = {}): Promise<GlobalRuleInstallPlanItem[]> {
  const homeDir = resolve(options.homeDir ?? process.env.HOME ?? "");
  const sourceRoot = resolve(options.sourceRoot ?? (await findGlobalRuleSourceRoot()));

  return Promise.all(
    GLOBAL_RULE_SPECS.map(async (spec) => {
      const sourcePath = join(sourceRoot, spec.sourceRelativePath);
      const linkPath = join(homeDir, spec.linkRelativePath);
      await requireSourceFile(sourcePath);

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

export async function installGlobalRules(options: GlobalRuleInstallOptions = {}): Promise<GlobalRuleInstallPlanItem[]> {
  const plan = await planGlobalRuleInstall(options);
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
