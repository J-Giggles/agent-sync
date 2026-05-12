import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { archiveTargets } from "./archive-paths.js";
import { discoverProjects, matchProject } from "./projects.js";
import { renderJson, renderMarkdown } from "./render.js";
import { enabledProviders } from "../providers/index.js";
import type { NormalizedConversation, SyncConfig, SyncDiagnostic } from "../types.js";

export type SyncResult = {
  written: number;
  skipped: number;
  diagnostics: SyncDiagnostic[];
};

type RenderedTarget = {
  path: string;
  content: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringMetadata(conversation: NormalizedConversation, key: string): string | undefined {
  const value = conversation.metadata[key];
  return typeof value === "string" ? value : undefined;
}

function metadataPaths(conversation: NormalizedConversation): string[] {
  const value = conversation.metadata.metadataPaths;
  const paths = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return [...paths, conversation.source.path];
}

async function writeIfChanged(path: string, content: string): Promise<"written" | "skipped"> {
  try {
    if ((await readFile(path, "utf8")) === content) {
      return "skipped";
    }
  } catch {
    // Missing or unreadable files are rewritten below. Real write failures still surface.
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return "written";
}

async function writeRenderedTargets(targets: RenderedTarget[]): Promise<Pick<SyncResult, "written" | "skipped">> {
  let written = 0;
  let skipped = 0;

  for (const target of targets) {
    const result = await writeIfChanged(target.path, target.content);
    if (result === "written") written += 1;
    else skipped += 1;
  }

  return { written, skipped };
}

async function writeManifest(config: SyncConfig, result: SyncResult): Promise<void> {
  const manifestPath = `${config.centralArchiveDir}/.agent-sync-manifest.json`;
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        written: result.written,
        skipped: result.skipped,
        diagnostics: result.diagnostics,
      },
      null,
      2
    )}\n`
  );
}

export async function runSync(config: SyncConfig): Promise<SyncResult> {
  const diagnostics: SyncDiagnostic[] = [];
  let written = 0;
  let skipped = 0;
  const projects = await discoverProjects(config.projectRoots);

  for (const provider of enabledProviders(config)) {
    let refs;
    try {
      refs = await provider.discover(config);
    } catch (error) {
      diagnostics.push({
        level: "error",
        provider: provider.id,
        message: `Failed to discover provider records: ${errorMessage(error)}`,
      });
      continue;
    }

    for (const ref of refs) {
      let conversation: NormalizedConversation;
      try {
        conversation = await provider.read(ref);
      } catch (error) {
        diagnostics.push({
          level: "error",
          provider: provider.id,
          sourcePath: ref.path,
          message: `Failed to read conversation: ${errorMessage(error)}`,
        });
        continue;
      }

      conversation.project = matchProject(projects, {
        cwd: stringMetadata(conversation, "cwd"),
        workspace: stringMetadata(conversation, "workspace"),
        repo: stringMetadata(conversation, "repo"),
        metadataPaths: metadataPaths(conversation),
      });

      let renderedTargets: RenderedTarget[];
      try {
        renderedTargets = archiveTargets(config, conversation).flatMap((target) => [
          { path: target.jsonPath, content: renderJson(conversation) },
          { path: target.markdownPath, content: renderMarkdown(conversation) },
        ]);
      } catch (error) {
        diagnostics.push({
          level: "error",
          provider: provider.id,
          sourcePath: ref.path,
          message: `Failed to render archive targets: ${errorMessage(error)}`,
        });
        continue;
      }

      try {
        const counts = await writeRenderedTargets(renderedTargets);
        written += counts.written;
        skipped += counts.skipped;
      } catch (error) {
        diagnostics.push({
          level: "error",
          provider: provider.id,
          sourcePath: ref.path,
          message: `Failed to write archive output: ${errorMessage(error)}`,
        });
      }
    }
  }

  const result = { written, skipped, diagnostics };
  await writeManifest(config, result);
  return result;
}
