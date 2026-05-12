import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { discoverProjects, matchProject } from "../src/core/projects.js";

async function makeRoot() {
  const root = join(tmpdir(), `agent-sync-projects-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

describe("projects", () => {
  it("discovers projects by package.json and .agents", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "app-one"), { recursive: true });
    await writeFile(join(root, "app-one", "package.json"), "{}");
    await mkdir(join(root, "app-two", ".agents"), { recursive: true });

    const projects = await discoverProjects([root]);

    expect(projects.map((project) => project.name).sort()).toEqual(["app-one", "app-two"]);
  });

  it("matches the most specific project root from cwd metadata", () => {
    const projects = [
      { name: "parent", root: "/work/parent" },
      { name: "child", root: "/work/parent/packages/child" },
    ];

    const match = matchProject(projects, {
      cwd: "/work/parent/packages/child/src",
    });

    expect(match).toEqual({
      name: "child",
      root: "/work/parent/packages/child",
      matchedBy: "cwd",
    });
  });

  it("returns undefined when no metadata path matches", () => {
    const match = matchProject([{ name: "app", root: "/work/app" }], {
      cwd: "/other/place",
    });

    expect(match).toBeUndefined();
  });
});
