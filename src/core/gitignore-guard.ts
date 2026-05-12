import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isSafeRelativePath } from "./path-utils.js";

export type ProjectArchiveIgnoreStatus = {
  ignored: boolean;
  archivePath: string;
};

type GuardSpec = {
  gitignorePath: string;
  rule: string;
};

function normalizeRelativePath(path: string): string {
  return path
    .split(/[\\/]+/)
    .filter((part) => part.length > 0 && part !== ".")
    .join("/");
}

function ruleMatches(content: string, relativePath: string): boolean {
  const candidates = new Set([relativePath, `${relativePath}/`, `/${relativePath}`, `/${relativePath}/`]);
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => candidates.has(line));
}

function guardSpecs(projectRoot: string, projectArchiveDir: string): GuardSpec[] {
  const relativePath = normalizeRelativePath(projectArchiveDir);
  if (relativePath === ".agents/chats") {
    return [{ gitignorePath: join(projectRoot, ".agents", ".gitignore"), rule: "chats/" }];
  }

  return [{ gitignorePath: join(projectRoot, ".gitignore"), rule: `/${relativePath}/` }];
}

async function readUtf8(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function hasGuard(projectRoot: string, projectArchiveDir: string): Promise<boolean> {
  const relativePath = normalizeRelativePath(projectArchiveDir);
  for (const spec of guardSpecs(projectRoot, projectArchiveDir)) {
    const content = await readUtf8(spec.gitignorePath);
    const guardedPath = relativePath === ".agents/chats" && spec.rule === "chats/" ? "chats" : relativePath;
    if (content !== undefined && ruleMatches(content, guardedPath)) {
      return true;
    }
  }
  return false;
}

export async function inspectProjectArchiveIgnore(
  projectRoot: string,
  projectArchiveDir: string
): Promise<ProjectArchiveIgnoreStatus> {
  return {
    ignored: isSafeRelativePath(projectArchiveDir) && (await hasGuard(projectRoot, projectArchiveDir)),
    archivePath: join(projectRoot, projectArchiveDir),
  };
}

export async function ensureProjectArchiveIgnored(projectRoot: string, projectArchiveDir: string): Promise<void> {
  if (!isSafeRelativePath(projectArchiveDir)) {
    throw new Error(`Unsafe projectArchiveDir: ${projectArchiveDir}`);
  }
  if (await hasGuard(projectRoot, projectArchiveDir)) {
    return;
  }

  const [spec] = guardSpecs(projectRoot, projectArchiveDir);
  const existing = (await readUtf8(spec.gitignorePath)) ?? "";
  const prefix = existing.length === 0 || existing.endsWith("\n") ? existing : `${existing}\n`;
  await mkdir(dirname(spec.gitignorePath), { recursive: true });
  await writeFile(spec.gitignorePath, `${prefix}${spec.rule}\n`);
}
