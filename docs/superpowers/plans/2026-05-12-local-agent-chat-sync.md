# Local Agent Chat Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-only TypeScript CLI that syncs Cursor, Codex, Claude Code, and T3 Code chat histories into a central archive and matched project `.agents/chats` folders.

**Architecture:** The CLI is provider-adapter based. Providers discover and normalize local conversation records; the core sync engine handles project matching, archive path generation, Markdown rendering, idempotent writes, diagnostics, and watch orchestration.

**Tech Stack:** TypeScript, Node.js ESM, `tsx`, `vitest`, `chokidar`, `commander`, `zod`, `fast-glob`.

---

## File Structure

- `package.json`: npm scripts, CLI bin, dependencies.
- `tsconfig.json`: TypeScript compiler settings.
- `vitest.config.ts`: unit and integration test configuration.
- `agent-sync.config.json`: default local config for this machine.
- `src/cli.ts`: command parsing for `sync`, `watch`, `status`, and `doctor`.
- `src/config.ts`: config schema, defaults, and loader.
- `src/types.ts`: shared provider, normalized conversation, config, and diagnostic types.
- `src/core/projects.ts`: project discovery and project matching.
- `src/core/archive-paths.ts`: deterministic archive path generation.
- `src/core/render.ts`: JSON and Markdown rendering.
- `src/core/fingerprints.ts`: stable ids and content hashes.
- `src/core/sync.ts`: one-shot sync pipeline and idempotent writes.
- `src/core/watch.ts`: provider watch orchestration and debounce.
- `src/core/doctor.ts`: environment diagnostics.
- `src/providers/index.ts`: enabled provider registry.
- `src/providers/cursor.ts`: Cursor local adapter.
- `src/providers/codex.ts`: Codex local adapter.
- `src/providers/claude-code.ts`: Claude Code local adapter.
- `src/providers/t3code.ts`: T3 Code local adapter.
- `src/providers/generic-json.ts`: reusable JSON/JSONL parsing helpers for provider adapters.
- `tests/fixtures/*`: provider and project matching fixtures.
- `tests/**/*.test.ts`: unit and integration tests.

## Task 1: Project Skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/types.ts`
- Create: `src/cli.ts`
- Create: `agent-sync.config.json`

- [x] **Step 1: Create package metadata**

Create `package.json`:

```json
{
  "name": "agent-sync",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "bin": {
    "agent-sync": "./dist/cli.js"
  },
  "scripts": {
    "dev": "tsx src/cli.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "chokidar": "^4.0.3",
    "commander": "^12.1.0",
    "fast-glob": "^3.3.3",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [x] **Step 2: Create TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

- [x] **Step 3: Create Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [x] **Step 4: Create shared types**

Create `src/types.ts`:

```ts
export type ProviderId = "cursor" | "codex" | "claude-code" | "t3code";

export type MessageRole = "user" | "assistant" | "system" | "tool" | "unknown";

export type SourceKind = "json" | "jsonl" | "sqlite" | "directory" | "unknown";

export type MatchKind = "cwd" | "workspace" | "repo" | "metadata";

export type SyncConfig = {
  projectRoots: string[];
  centralArchiveDir: string;
  unknownProjectDir: string;
  projectArchiveDir: string;
  providers: Record<string, { enabled: boolean; paths?: string[] }>;
};

export type RawConversationRef = {
  provider: ProviderId;
  path: string;
  kind: SourceKind;
  idHint?: string;
};

export type NormalizedMessage = {
  id?: string;
  role: MessageRole;
  createdAt?: string;
  text?: string;
  toolName?: string;
  raw?: unknown;
};

export type ProjectMatch = {
  name: string;
  root: string;
  matchedBy: MatchKind;
};

export type NormalizedConversation = {
  schemaVersion: 1;
  provider: string;
  providerConversationId: string;
  stableId: string;
  title?: string;
  project?: ProjectMatch;
  startedAt: string;
  updatedAt?: string;
  source: {
    path: string;
    kind: SourceKind;
  };
  messages: NormalizedMessage[];
  metadata: Record<string, unknown>;
};

export type ProviderAdapter = {
  id: ProviderId;
  label: string;
  discover(config: SyncConfig): Promise<RawConversationRef[]>;
  read(ref: RawConversationRef): Promise<NormalizedConversation>;
  watchPaths?(config: SyncConfig): string[];
};

export type DiscoveredProject = {
  name: string;
  root: string;
};

export type SyncDiagnostic = {
  level: "info" | "warn" | "error";
  provider?: string;
  sourcePath?: string;
  message: string;
};
```

- [x] **Step 5: Create CLI placeholder**

Create `src/cli.ts`:

```ts
#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program.name("agent-sync").description("Sync local agent chat histories").version("0.1.0");

program.command("sync").description("Run one-shot chat sync").action(() => {
  console.log("sync is not implemented yet");
});

program.command("watch").description("Watch provider files and sync changes").action(() => {
  console.log("watch is not implemented yet");
});

program.command("status").description("Show sync status").action(() => {
  console.log("status is not implemented yet");
});

program.command("doctor").description("Check provider and archive configuration").action(() => {
  console.log("doctor is not implemented yet");
});

program.parse();
```

- [x] **Step 6: Create default config**

Create `agent-sync.config.json`:

```json
{
  "projectRoots": ["~/code"],
  "centralArchiveDir": "~/code/agent-sync/archive",
  "unknownProjectDir": "~/code/agent-sync/unknown-project",
  "projectArchiveDir": ".agents/chats",
  "providers": {
    "cursor": { "enabled": true },
    "codex": { "enabled": true },
    "claude-code": { "enabled": true },
    "t3code": { "enabled": true }
  }
}
```

- [x] **Step 7: Install dependencies and verify skeleton**

Run:

```bash
npm install
npm run typecheck
npm test
```

Expected: dependency install succeeds, typecheck succeeds, and Vitest reports no tests or an empty test suite.

- [x] **Step 8: Commit**

Run:

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/types.ts src/cli.ts agent-sync.config.json
git commit -m "chore: scaffold agent-sync cli"
```

## Task 2: Config Loading

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing config tests**

Create `tests/config.test.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

async function tempDir() {
  const dir = join(tmpdir(), `agent-sync-config-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("loadConfig", () => {
  it("loads agent-sync.config.json from cwd", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, "agent-sync.config.json"),
      JSON.stringify({
        projectRoots: ["/tmp/projects"],
        centralArchiveDir: "/tmp/archive",
        unknownProjectDir: "/tmp/unknown",
        projectArchiveDir: ".agents/chats",
        providers: { codex: { enabled: true } },
      })
    );

    const config = await loadConfig(dir);

    expect(config.projectRoots).toEqual(["/tmp/projects"]);
    expect(config.providers.codex.enabled).toBe(true);
  });

  it("returns defaults when no config file exists", async () => {
    const dir = await tempDir();
    const config = await loadConfig(dir);

    expect(config.projectRoots).toEqual(["~/code"]);
    expect(config.providers.cursor.enabled).toBe(true);
    expect(config.projectArchiveDir).toBe(".agents/chats");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/config.test.ts
```

Expected: FAIL because `src/config.ts` does not exist.

- [ ] **Step 3: Implement config loader**

Create `src/config.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { SyncConfig } from "./types.js";

const providerConfigSchema = z.object({
  enabled: z.boolean(),
  paths: z.array(z.string()).optional(),
});

const syncConfigSchema = z.object({
  projectRoots: z.array(z.string()).min(1),
  centralArchiveDir: z.string().min(1),
  unknownProjectDir: z.string().min(1),
  projectArchiveDir: z.string().min(1),
  providers: z.record(providerConfigSchema),
});

export const defaultConfig: SyncConfig = {
  projectRoots: ["~/code"],
  centralArchiveDir: "~/code/agent-sync/archive",
  unknownProjectDir: "~/code/agent-sync/unknown-project",
  projectArchiveDir: ".agents/chats",
  providers: {
    cursor: { enabled: true },
    codex: { enabled: true },
    "claude-code": { enabled: true },
    t3code: { enabled: true },
  },
};

export async function loadConfig(cwd = process.cwd()): Promise<SyncConfig> {
  const configPath = join(cwd, "agent-sync.config.json");

  try {
    const raw = await readFile(configPath, "utf8");
    return syncConfigSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultConfig;
    }

    throw error;
  }
}
```

- [ ] **Step 4: Wire config into CLI**

Modify `src/cli.ts` command actions to load config:

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "./config.js";

const program = new Command();

program.name("agent-sync").description("Sync local agent chat histories").version("0.1.0");

program.command("sync").description("Run one-shot chat sync").action(async () => {
  const config = await loadConfig();
  console.log(`sync is not implemented yet: ${Object.keys(config.providers).length} providers configured`);
});

program.command("watch").description("Watch provider files and sync changes").action(async () => {
  const config = await loadConfig();
  console.log(`watch is not implemented yet: ${Object.keys(config.providers).length} providers configured`);
});

program.command("status").description("Show sync status").action(async () => {
  const config = await loadConfig();
  console.log(`status is not implemented yet: archive ${config.centralArchiveDir}`);
});

program.command("doctor").description("Check provider and archive configuration").action(async () => {
  const config = await loadConfig();
  console.log(`doctor is not implemented yet: ${config.projectRoots.join(", ")}`);
});

program.parse();
```

- [x] **Step 5: Verify tests pass**

Run:

```bash
npm test -- tests/config.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 6: Commit**

Run:

```bash
git add src/config.ts src/cli.ts tests/config.test.ts
git commit -m "feat: load agent-sync config"
```

## Task 3: Project Discovery and Matching

**Files:**
- Create: `src/core/projects.ts`
- Test: `tests/projects.test.ts`

- [ ] **Step 1: Write failing project tests**

Create `tests/projects.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/projects.test.ts
```

Expected: FAIL because `src/core/projects.ts` does not exist.

- [ ] **Step 3: Implement project discovery and matching**

Create `src/core/projects.ts`:

```ts
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

export function matchProject(projects: DiscoveredProject[], input: MatchInput): ProjectMatch | undefined {
  const candidates = [
    { matchedBy: "cwd" as const, path: input.cwd },
    { matchedBy: "workspace" as const, path: input.workspace },
    { matchedBy: "repo" as const, path: input.repo },
    ...(input.metadataPaths ?? []).map((path) => ({ matchedBy: "metadata" as const, path })),
  ].filter((candidate): candidate is { matchedBy: ProjectMatch["matchedBy"]; path: string } => Boolean(candidate.path));

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
```

- [ ] **Step 4: Verify tests pass**

Run:

```bash
npm test -- tests/projects.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/core/projects.ts tests/projects.test.ts
git commit -m "feat: discover and match projects"
```

## Task 4: Archive Paths, Fingerprints, and Rendering

**Files:**
- Create: `src/core/fingerprints.ts`
- Create: `src/core/archive-paths.ts`
- Create: `src/core/render.ts`
- Test: `tests/archive.test.ts`
- Test: `tests/render.test.ts`

- [ ] **Step 1: Write failing archive tests**

Create `tests/archive.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createStableId, fingerprint } from "../src/core/fingerprints.js";
import { archiveTargets } from "../src/core/archive-paths.js";
import type { NormalizedConversation, SyncConfig } from "../src/types.js";

const config: SyncConfig = {
  projectRoots: ["/work"],
  centralArchiveDir: "/sync/archive",
  unknownProjectDir: "/sync/unknown-project",
  projectArchiveDir: ".agents/chats",
  providers: {},
};

const conversation: NormalizedConversation = {
  schemaVersion: 1,
  provider: "codex",
  providerConversationId: "abc",
  stableId: "stable-abc",
  title: "Plan sync",
  project: { name: "my-app", root: "/work/my-app", matchedBy: "cwd" },
  startedAt: "2026-05-12T10:30:00.000Z",
  source: { path: "~/.codex/session.jsonl", kind: "jsonl" },
  messages: [{ role: "user", text: "hello" }],
  metadata: {},
};

describe("archive paths", () => {
  it("creates deterministic stable ids", () => {
    expect(createStableId("codex", "abc", "/tmp/a")).toBe(createStableId("codex", "abc", "/tmp/a"));
  });

  it("creates deterministic fingerprints", () => {
    expect(fingerprint({ b: 2, a: 1 })).toBe(fingerprint({ a: 1, b: 2 }));
  });

  it("returns central and project targets for matched conversations", () => {
    const targets = archiveTargets(config, conversation);

    expect(targets.map((target) => target.jsonPath)).toEqual([
      "/sync/archive/my-app/2026/05/12/codex-20260512T103000Z-stable-abc.json",
      "/work/my-app/.agents/chats/2026/05/12/codex-20260512T103000Z-stable-abc.json",
    ]);
  });

  it("returns only unknown-project targets for unmatched conversations", () => {
    const targets = archiveTargets(config, { ...conversation, project: undefined });

    expect(targets).toHaveLength(1);
    expect(targets[0].jsonPath).toBe("/sync/unknown-project/2026/05/12/codex-20260512T103000Z-stable-abc.json");
  });
});
```

- [ ] **Step 2: Write failing render tests**

Create `tests/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/core/render.js";
import type { NormalizedConversation } from "../src/types.js";

describe("renderMarkdown", () => {
  it("renders readable conversation markdown", () => {
    const markdown = renderMarkdown({
      schemaVersion: 1,
      provider: "codex",
      providerConversationId: "abc",
      stableId: "stable-abc",
      title: "Sync design",
      startedAt: "2026-05-12T10:30:00.000Z",
      source: { path: "/tmp/session.jsonl", kind: "jsonl" },
      messages: [
        { role: "user", text: "Build this" },
        { role: "assistant", text: "Here is the plan" },
      ],
      metadata: { cwd: "/work/app" },
    } satisfies NormalizedConversation);

    expect(markdown).toContain("# Sync design");
    expect(markdown).toContain("Provider: codex");
    expect(markdown).toContain("## user");
    expect(markdown).toContain("Build this");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- tests/archive.test.ts tests/render.test.ts
```

Expected: FAIL because core modules do not exist.

- [ ] **Step 4: Implement fingerprints**

Create `src/core/fingerprints.ts`:

```ts
import { createHash } from "node:crypto";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function createStableId(provider: string, providerConversationId: string, sourcePath: string): string {
  return createHash("sha256").update(`${provider}:${providerConversationId}:${sourcePath}`).digest("hex").slice(0, 16);
}
```

- [ ] **Step 5: Implement archive paths**

Create `src/core/archive-paths.ts`:

```ts
import { join } from "node:path";
import type { NormalizedConversation, SyncConfig } from "../types.js";

export type ArchiveTarget = {
  jsonPath: string;
  markdownPath: string;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function dateParts(iso: string) {
  const date = new Date(iso);
  const year = String(date.getUTCFullYear());
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const stamp = `${year}${month}${day}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  return { year, month, day, stamp };
}

function fileBase(conversation: NormalizedConversation): string {
  const { stamp } = dateParts(conversation.startedAt);
  return `${slug(conversation.provider)}-${stamp}-${conversation.stableId}`;
}

function datedPath(baseDir: string, conversation: NormalizedConversation): ArchiveTarget {
  const { year, month, day } = dateParts(conversation.startedAt);
  const base = join(baseDir, year, month, day, fileBase(conversation));
  return {
    jsonPath: `${base}.json`,
    markdownPath: `${base}.md`,
  };
}

export function archiveTargets(config: SyncConfig, conversation: NormalizedConversation): ArchiveTarget[] {
  if (!conversation.project) {
    return [datedPath(config.unknownProjectDir, conversation)];
  }

  return [
    datedPath(join(config.centralArchiveDir, slug(conversation.project.name)), conversation),
    datedPath(join(conversation.project.root, config.projectArchiveDir), conversation),
  ];
}
```

- [ ] **Step 6: Implement Markdown rendering**

Create `src/core/render.ts`:

```ts
import type { NormalizedConversation } from "../types.js";

export function renderJson(conversation: NormalizedConversation): string {
  return `${JSON.stringify(conversation, null, 2)}\n`;
}

export function renderMarkdown(conversation: NormalizedConversation): string {
  const title = conversation.title || `${conversation.provider} ${conversation.providerConversationId}`;
  const lines = [
    `# ${title}`,
    "",
    `Provider: ${conversation.provider}`,
    `Started: ${conversation.startedAt}`,
    `Source: ${conversation.source.path}`,
  ];

  if (conversation.project) {
    lines.push(`Project: ${conversation.project.name}`);
  }

  lines.push("");

  for (const message of conversation.messages) {
    lines.push(`## ${message.role}`);
    if (message.createdAt) lines.push(`Created: ${message.createdAt}`);
    if (message.toolName) lines.push(`Tool: ${message.toolName}`);
    lines.push("");
    lines.push(message.text || "");
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
```

- [ ] **Step 7: Verify tests pass**

Run:

```bash
npm test -- tests/archive.test.ts tests/render.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/core/fingerprints.ts src/core/archive-paths.ts src/core/render.ts tests/archive.test.ts tests/render.test.ts
git commit -m "feat: render archive outputs"
```

## Task 5: Generic Provider Helpers and Adapters

**Files:**
- Create: `src/providers/generic-json.ts`
- Create: `src/providers/codex.ts`
- Create: `src/providers/claude-code.ts`
- Create: `src/providers/cursor.ts`
- Create: `src/providers/t3code.ts`
- Create: `src/providers/index.ts`
- Test: `tests/providers.test.ts`
- Create: `tests/fixtures/codex/session.jsonl`
- Create: `tests/fixtures/claude-code/session.jsonl`
- Create: `tests/fixtures/cursor/chat.json`
- Create: `tests/fixtures/t3code/chat.json`

- [ ] **Step 1: Write provider fixture files**

Create `tests/fixtures/codex/session.jsonl`:

```jsonl
{"id":"m1","role":"user","content":"sync chats","timestamp":"2026-05-12T10:00:00.000Z","cwd":"/work/app"}
{"id":"m2","role":"assistant","content":"ok","timestamp":"2026-05-12T10:01:00.000Z","cwd":"/work/app"}
```

Create `tests/fixtures/claude-code/session.jsonl`:

```jsonl
{"uuid":"m1","type":"user","message":{"content":"hello"},"timestamp":"2026-05-12T11:00:00.000Z","cwd":"/work/app"}
{"uuid":"m2","type":"assistant","message":{"content":"hi"},"timestamp":"2026-05-12T11:01:00.000Z","cwd":"/work/app"}
```

Create `tests/fixtures/cursor/chat.json`:

```json
{
  "id": "cursor-1",
  "title": "Cursor sync",
  "workspace": "/work/app",
  "createdAt": "2026-05-12T12:00:00.000Z",
  "messages": [
    { "id": "m1", "role": "user", "text": "cursor hello" }
  ]
}
```

Create `tests/fixtures/t3code/chat.json`:

```json
{
  "id": "t3-1",
  "title": "T3 sync",
  "cwd": "/work/app",
  "createdAt": "2026-05-12T13:00:00.000Z",
  "messages": [
    { "id": "m1", "role": "assistant", "content": "t3 hello" }
  ]
}
```

- [ ] **Step 2: Write failing provider tests**

Create `tests/providers.test.ts`:

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SyncConfig } from "../src/types.js";
import { codexProvider } from "../src/providers/codex.js";
import { claudeCodeProvider } from "../src/providers/claude-code.js";
import { cursorProvider } from "../src/providers/cursor.js";
import { t3codeProvider } from "../src/providers/t3code.js";

const fixtureRoot = join(process.cwd(), "tests", "fixtures");

function config(provider: string, path: string): SyncConfig {
  return {
    projectRoots: ["/work"],
    centralArchiveDir: "/archive",
    unknownProjectDir: "/unknown",
    projectArchiveDir: ".agents/chats",
    providers: { [provider]: { enabled: true, paths: [path] } },
  };
}

describe("provider adapters", () => {
  it("reads codex jsonl conversations", async () => {
    const refs = await codexProvider.discover(config("codex", join(fixtureRoot, "codex")));
    const conversation = await codexProvider.read(refs[0]);

    expect(conversation.provider).toBe("codex");
    expect(conversation.startedAt).toBe("2026-05-12T10:00:00.000Z");
    expect(conversation.messages).toHaveLength(2);
    expect(conversation.metadata.cwd).toBe("/work/app");
  });

  it("reads claude-code jsonl conversations", async () => {
    const refs = await claudeCodeProvider.discover(config("claude-code", join(fixtureRoot, "claude-code")));
    const conversation = await claudeCodeProvider.read(refs[0]);

    expect(conversation.provider).toBe("claude-code");
    expect(conversation.messages[0].text).toBe("hello");
  });

  it("reads cursor json conversations", async () => {
    const refs = await cursorProvider.discover(config("cursor", join(fixtureRoot, "cursor")));
    const conversation = await cursorProvider.read(refs[0]);

    expect(conversation.title).toBe("Cursor sync");
    expect(conversation.metadata.workspace).toBe("/work/app");
  });

  it("reads t3code json conversations", async () => {
    const refs = await t3codeProvider.discover(config("t3code", join(fixtureRoot, "t3code")));
    const conversation = await t3codeProvider.read(refs[0]);

    expect(conversation.title).toBe("T3 sync");
    expect(conversation.messages[0].text).toBe("t3 hello");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- tests/providers.test.ts
```

Expected: FAIL because provider modules do not exist.

- [ ] **Step 4: Implement generic JSON helpers**

Create `src/providers/generic-json.ts` with these exported functions:

```ts
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { MessageRole, NormalizedConversation, NormalizedMessage, ProviderId, RawConversationRef, SourceKind, SyncConfig } from "../types.js";
import { createStableId } from "../core/fingerprints.js";

export async function discoverJsonRefs(config: SyncConfig, provider: ProviderId, defaultPaths: string[]): Promise<RawConversationRef[]> {
  const roots = config.providers[provider]?.paths ?? defaultPaths;
  const refs: RawConversationRef[] = [];

  for (const root of roots) {
    try {
      const entries = await readdir(root, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const path = join(entry.parentPath, entry.name);
        const extension = extname(path);
        if (extension !== ".json" && extension !== ".jsonl") continue;
        refs.push({ provider, path, kind: extension === ".jsonl" ? "jsonl" : "json" });
      }
    } catch {
      continue;
    }
  }

  return refs.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readJsonRecords(ref: RawConversationRef): Promise<unknown[]> {
  const raw = await readFile(ref.path, "utf8");
  if (ref.kind === "jsonl") {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function normalizeRole(value: unknown): MessageRole {
  if (value === "user" || value === "assistant" || value === "system" || value === "tool") return value;
  return "unknown";
}

export function textFrom(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFrom).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return textFrom(record.text ?? record.content ?? record.message);
  }
  return undefined;
}

export async function buildConversation(provider: ProviderId, ref: RawConversationRef, records: unknown[], options: { title?: string; id?: string; cwd?: string; workspace?: string } = {}): Promise<NormalizedConversation> {
  const sourceStat = await stat(ref.path);
  const first = (records[0] ?? {}) as Record<string, unknown>;
  const id = options.id ?? String(first.id ?? first.uuid ?? ref.path);
  const startedAt = String(first.timestamp ?? first.createdAt ?? sourceStat.mtime.toISOString());
  const messages: NormalizedMessage[] = records.map((record) => {
    const item = record as Record<string, unknown>;
    return {
      id: typeof item.id === "string" ? item.id : typeof item.uuid === "string" ? item.uuid : undefined,
      role: normalizeRole(item.role ?? item.type),
      createdAt: typeof item.timestamp === "string" ? item.timestamp : typeof item.createdAt === "string" ? item.createdAt : undefined,
      text: textFrom(item.text ?? item.content ?? item.message),
      raw: record,
    };
  });

  return {
    schemaVersion: 1,
    provider,
    providerConversationId: id,
    stableId: createStableId(provider, id, ref.path),
    title: options.title,
    startedAt,
    updatedAt: sourceStat.mtime.toISOString(),
    source: { path: ref.path, kind: ref.kind as SourceKind },
    messages,
    metadata: {
      cwd: options.cwd ?? first.cwd,
      workspace: options.workspace ?? first.workspace,
    },
  };
}
```

- [ ] **Step 5: Implement provider adapters**

Create the four provider modules. Each module follows the same pattern and changes only `id`, `label`, default paths, and JSON object field extraction:

- Cursor: `~/.config/cursor/chats`, `~/.config/Cursor/User/globalStorage`, `~/.cursor/plans`
- Codex: `~/.codex`, `~/.codex/sessions`
- Claude Code: `~/.claude`, `~/.config/Claude/claude-code-sessions`
- T3 Code: `~/.config/t3code`, `~/.config/t3code-dev`

For `src/providers/codex.ts`, use:

```ts
import type { ProviderAdapter } from "../types.js";
import { buildConversation, discoverJsonRefs, readJsonRecords } from "./generic-json.js";

const defaultPaths = ["~/.codex", "~/.codex/sessions"];

export const codexProvider: ProviderAdapter = {
  id: "codex",
  label: "Codex",
  discover: (config) => discoverJsonRefs(config, "codex", defaultPaths),
  async read(ref) {
    const records = await readJsonRecords(ref);
    const first = (records[0] ?? {}) as Record<string, unknown>;
    return buildConversation("codex", ref, records, {
      id: typeof first.sessionId === "string" ? first.sessionId : undefined,
      cwd: typeof first.cwd === "string" ? first.cwd : undefined,
    });
  },
  watchPaths: (config) => config.providers.codex?.paths ?? defaultPaths,
};
```

For `src/providers/claude-code.ts`, use the same pattern with provider id `"claude-code"`, label `"Claude Code"`, default paths `["~/.claude", "~/.config/Claude/claude-code-sessions"]`, id field `sessionId`, and cwd field `cwd`.

For `src/providers/cursor.ts`, use the same pattern with provider id `"cursor"`, label `"Cursor"`, default paths `["~/.config/cursor/chats", "~/.config/Cursor/User/globalStorage", "~/.cursor/plans"]`, id field `id`, title field `title`, and workspace field `workspace`.

For `src/providers/t3code.ts`, use the same pattern with provider id `"t3code"`, label `"T3 Code"`, default paths `["~/.config/t3code", "~/.config/t3code-dev"]`, id field `id`, title field `title`, and cwd field `cwd`.

- [ ] **Step 6: Create provider registry**

Create `src/providers/index.ts`:

```ts
import type { ProviderAdapter, SyncConfig } from "../types.js";
import { claudeCodeProvider } from "./claude-code.js";
import { codexProvider } from "./codex.js";
import { cursorProvider } from "./cursor.js";
import { t3codeProvider } from "./t3code.js";

const allProviders = [cursorProvider, codexProvider, claudeCodeProvider, t3codeProvider];

export function enabledProviders(config: SyncConfig): ProviderAdapter[] {
  return allProviders.filter((provider) => config.providers[provider.id]?.enabled);
}
```

- [ ] **Step 7: Verify tests pass**

Run:

```bash
npm test -- tests/providers.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/providers tests/fixtures tests/providers.test.ts
git commit -m "feat: add local provider adapters"
```

## Task 6: Sync Pipeline and Idempotent Writes

**Files:**
- Create: `src/core/sync.ts`
- Test: `tests/sync.test.ts`
- Modify: `src/cli.ts`

- [x] **Step 1: Write failing sync integration test**

Create `tests/sync.test.ts`:

```ts
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runSync } from "../src/core/sync.js";
import type { SyncConfig } from "../src/types.js";

async function makeDir(name: string) {
  const dir = join(tmpdir(), `${name}-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function listJson(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true });
  return entries.filter((entry) => String(entry).endsWith(".json")).map(String).sort();
}

describe("runSync", () => {
  it("writes matched conversations to central and project archives and unmatched conversations only to unknown", async () => {
    const root = await makeDir("agent-sync-run");
    const providerDir = join(root, "provider");
    const projectRoot = join(root, "projects", "app");
    const archive = join(root, "archive");
    const unknown = join(root, "unknown-project");
    await mkdir(providerDir, { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, "package.json"), "{}");
    await writeFile(join(providerDir, "matched.jsonl"), JSON.stringify({ id: "m1", role: "user", content: "hello", timestamp: "2026-05-12T10:00:00.000Z", cwd: projectRoot }));
    await writeFile(join(providerDir, "unknown.jsonl"), JSON.stringify({ id: "u1", role: "user", content: "unknown", timestamp: "2026-05-12T11:00:00.000Z", cwd: "/elsewhere" }));

    const config: SyncConfig = {
      projectRoots: [join(root, "projects")],
      centralArchiveDir: archive,
      unknownProjectDir: unknown,
      projectArchiveDir: ".agents/chats",
      providers: { codex: { enabled: true, paths: [providerDir] } },
    };

    const first = await runSync(config);
    const second = await runSync(config);

    expect(first.written).toBeGreaterThan(0);
    expect(second.skipped).toBeGreaterThan(0);
    expect(await listJson(join(archive, "app"))).toHaveLength(1);
    expect(await listJson(join(projectRoot, ".agents", "chats"))).toHaveLength(1);
    expect(await listJson(unknown)).toHaveLength(1);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/sync.test.ts
```

Expected: FAIL because `src/core/sync.ts` does not exist.

- [x] **Step 3: Implement sync pipeline**

Create `src/core/sync.ts` with:

- `runSync(config: SyncConfig): Promise<{ written: number; skipped: number; diagnostics: SyncDiagnostic[] }>`
- provider failure isolation with try/catch around each provider
- project discovery before provider reads
- project matching from `metadata.cwd`, `metadata.workspace`, `metadata.repo`, and source path
- archive target generation
- content fingerprint comparison before writes
- parent directory creation before writes
- `.agent-sync-manifest.json` written under `centralArchiveDir`

- [x] **Step 4: Wire `sync` command**

Modify `src/cli.ts` so `agent-sync sync` calls `runSync`, prints written/skipped counts, prints warnings/errors, and exits non-zero only for fatal config errors.

- [ ] **Step 5: Verify tests pass**

Run:

```bash
npm test -- tests/sync.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/core/sync.ts src/cli.ts tests/sync.test.ts
git commit -m "feat: sync normalized conversations"
```

## Task 7: Watch, Status, and Doctor

**Files:**
- Create: `src/core/watch.ts`
- Create: `src/core/doctor.ts`
- Test: `tests/watch.test.ts`
- Test: `tests/doctor.test.ts`
- Modify: `src/cli.ts`

- [x] **Step 1: Write failing watch tests**

Create `tests/watch.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createDebouncedRunner } from "../src/core/watch.js";

describe("createDebouncedRunner", () => {
  it("collapses repeated calls into one run", async () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const debounced = createDebouncedRunner(run, 500);

    debounced();
    debounced();
    debounced();
    await vi.advanceTimersByTimeAsync(500);

    expect(run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
```

- [x] **Step 2: Write failing doctor tests**

Create `tests/doctor.test.ts`:

```ts
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
});
```

- [x] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- tests/watch.test.ts tests/doctor.test.ts
```

Expected: FAIL because watch and doctor modules do not exist.

- [x] **Step 4: Implement watch**

Create `src/core/watch.ts` with `runWatch(config: SyncConfig): Promise<void>`. Use `chokidar` to watch enabled provider paths. Debounce changes for 500 ms and call `runSync(config)`. Reuse provider `watchPaths(config)` when present.

- [x] **Step 5: Implement doctor**

Create `src/core/doctor.ts` with `runDoctor(config: SyncConfig): Promise<SyncDiagnostic[]>`. Check project root existence, provider configured paths/default paths, central archive parent existence, and unknown-project count when the directory exists.

- [x] **Step 6: Wire CLI commands**

Modify `src/cli.ts`:

- `watch` calls `runWatch(config)`
- `status` reads `.agent-sync-manifest.json` when present and prints latest aggregate counts
- `doctor` calls `runDoctor(config)` and prints diagnostics

- [x] **Step 7: Verify tests pass**

Run:

```bash
npm test -- tests/watch.test.ts tests/doctor.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 8: Commit**

Run:

```bash
git add src/core/watch.ts src/core/doctor.ts src/cli.ts tests/watch.test.ts tests/doctor.test.ts
git commit -m "feat: add watch and diagnostics"
```

## Task 8: Final Verification and README

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/plans/2026-05-12-local-agent-chat-sync.md`

- [x] **Step 1: Write README**

Create `README.md`:

```md
# agent-sync

`agent-sync` archives local agent chat histories from Cursor, Codex, Claude Code, and T3 Code.

The tool is local-only. It reads provider files from disk, normalizes conversations, and writes full JSON and Markdown copies to a central archive and each matched project's `.agents/chats` directory.

## Commands

```bash
agent-sync sync
agent-sync watch
agent-sync status
agent-sync doctor
```

## Configuration

```json
{
  "projectRoots": ["~/code"],
  "centralArchiveDir": "~/code/agent-sync/archive",
  "unknownProjectDir": "~/code/agent-sync/unknown-project",
  "projectArchiveDir": ".agents/chats",
  "providers": {
    "cursor": { "enabled": true },
    "codex": { "enabled": true },
    "claude-code": { "enabled": true },
    "t3code": { "enabled": true }
  }
}
```

Matched chats are written to `archive/<project>/YYYY/MM/DD/` and `<project>/.agents/chats/YYYY/MM/DD/`.

Unmatched chats are written only to `unknown-project/YYYY/MM/DD/` for later review.

Watch mode uses the same sync pipeline as one-shot sync, so archive behavior stays consistent.
```

- [x] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
node dist/src/cli.js doctor
```

Expected: typecheck, tests, and build pass. `doctor` may report warnings for missing provider paths but must not crash.

- [x] **Step 3: Mark plan checkboxes as complete**

Update this plan file as tasks are finished by changing completed steps from `- [ ]` to `- [x]`.

- [x] **Step 4: Commit**

Run:

```bash
git add README.md docs/superpowers/plans/2026-05-12-local-agent-chat-sync.md
git commit -m "docs: document agent-sync cli"
```

## Implementation Notes

- Do not write unmatched conversations into any project `.agents` folder.
- Do not use provider APIs in v1.
- Prefer conservative parsing. If an adapter cannot confidently extract text, preserve raw message data under `raw` and emit a warning.
- Use content fingerprints before writing files so watch mode does not churn archives.
- Treat provider adapters as independent failure boundaries.

## Spec Coverage Review

- Local-only provider adapters: Tasks 5 and 6.
- Full normalized JSON and Markdown archives: Tasks 4 and 6.
- Central and project-local writes for matched chats: Tasks 3, 4, and 6.
- Unknown-project central-only writes: Tasks 4 and 6.
- Chat-start-date archive ordering with fallback: Tasks 4 and 5.
- Idempotent sync: Tasks 4 and 6.
- Watch mode through same pipeline: Task 7.
- Provider metadata preservation: Tasks 4 and 5.
- Diagnostics and isolated provider failures: Tasks 6 and 7.
