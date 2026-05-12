import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export function expandHomePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function expandHomePaths(paths: string[]): string[] {
  return paths.map((path) => expandHomePath(path));
}

export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || isAbsolute(path)) return false;
  return !path.split(/[\\/]+/).includes("..");
}
