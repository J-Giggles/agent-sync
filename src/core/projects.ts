import { access, readdir, stat } from "node:fs/promises";
import { join, normalize, relative, sep } from "node:path";
import type { DiscoveredProject, ProjectMatch } from "../types.js";

type MatchInput = {
  cwd?: string;
  workspace?: string;
  repo?: string;
  metadataPaths?: string[];
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isProject(path: string): Promise<boolean> {
  return (
    (await exists(join(path, ".git"))) ||
    (await exists(join(path, "package.json"))) ||
    (await exists(join(path, ".agents")))
  );
}

export async function discoverProjects(projectRoots: string[]): Promise<DiscoveredProject[]> {
  const projects = new Map<string, DiscoveredProject>();

  for (const root of projectRoots) {
    if (!(await exists(root))) continue;

    const entries = await readdir(root);
    for (const entry of entries) {
      const path = join(root, entry);
      const entryStat = await stat(path);
      if (!entryStat.isDirectory()) continue;
      if (!(await isProject(path))) continue;
      projects.set(path, { name: entry, root: path });
    }
  }

  return [...projects.values()].sort((a, b) => a.root.localeCompare(b.root));
}

function isInside(path: string, projectRoot: string): boolean {
  const rel = relative(normalize(projectRoot), normalize(path));
  return rel === "" || (!rel.startsWith("..") && rel !== ".." && !rel.startsWith(`..${sep}`));
}

export function matchProject(
  projects: DiscoveredProject[],
  input: MatchInput
): ProjectMatch | undefined {
  const candidates = [
    { matchedBy: "cwd" as const, path: input.cwd },
    { matchedBy: "workspace" as const, path: input.workspace },
    { matchedBy: "repo" as const, path: input.repo },
    ...(input.metadataPaths ?? []).map((path) => ({ matchedBy: "metadata" as const, path })),
  ].filter(
    (candidate): candidate is { matchedBy: ProjectMatch["matchedBy"]; path: string } =>
      Boolean(candidate.path)
  );

  for (const candidate of candidates) {
    const matches = projects
      .filter((project) => isInside(candidate.path, project.root))
      .sort((a, b) => b.root.length - a.root.length);

    if (matches[0]) {
      return {
        name: matches[0].name,
        root: matches[0].root,
        matchedBy: candidate.matchedBy,
      };
    }
  }

  return undefined;
}
