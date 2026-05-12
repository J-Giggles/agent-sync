import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { archiveTargets } from "./archive-paths.js";
import { expandHomePath, isSafeRelativePath } from "./path-utils.js";
import { discoverProjects, matchProject } from "./projects.js";
import { renderJson, renderMarkdown } from "./render.js";
import { enabledProviders } from "../providers/index.js";
import type { NormalizedConversation, ProviderId, SyncConfig, SyncDiagnostic } from "../types.js";

export type SyncedConversationOutput = {
  provider: string;
  sourcePath: string;
  projectName?: string;
  updatedAt?: string;
  outputs: string[];
};

export type SyncResult = {
  written: number;
  skipped: number;
  diagnostics: SyncDiagnostic[];
  conversations: SyncedConversationOutput[];
};

export type RunSyncOptions = {
  providerIds?: ProviderId[];
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
  const summary = {
    schemaVersion: 1,
    written: result.written,
    skipped: result.skipped,
    diagnostics: result.diagnostics,
    conversations: result.conversations,
  };
  let updatedAt = new Date().toISOString();

  try {
    const existing = JSON.parse(await readFile(manifestPath, "utf8")) as { updatedAt?: unknown };
    const { updatedAt: existingUpdatedAt, ...existingSummary } = existing;
    if (JSON.stringify(existingSummary) === JSON.stringify(summary) && typeof existingUpdatedAt === "string") {
      updatedAt = existingUpdatedAt;
    }
  } catch {
    // Missing or malformed manifests are replaced below.
  }

  await writeIfChanged(
    manifestPath,
    `${JSON.stringify(
      {
        ...summary,
        updatedAt,
      },
      null,
      2
    )}\n`
  );
}

export async function runSync(config: SyncConfig, options: RunSyncOptions = {}): Promise<SyncResult> {
  const diagnostics: SyncDiagnostic[] = [];
  const conversations: SyncedConversationOutput[] = [];
  let written = 0;
  let skipped = 0;
  if (!isSafeRelativePath(config.projectArchiveDir)) {
    return {
      written,
      skipped,
      conversations,
      diagnostics: [
        {
          level: "error",
          message: `Unsafe projectArchiveDir: ${config.projectArchiveDir}`,
        },
      ],
    };
  }

  const archiveConfig: SyncConfig = {
    ...config,
    centralArchiveDir: expandHomePath(config.centralArchiveDir),
    unknownProjectDir: expandHomePath(config.unknownProjectDir),
  };
  const projects = await discoverProjects(config.projectRoots);
  const enabledProviderList = enabledProviders(archiveConfig).filter(
    (provider) => !options.providerIds || options.providerIds.includes(provider.id)
  );

  for (const provider of enabledProviderList) {
    let refs;
    try {
      refs = await provider.discover(archiveConfig);
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
        renderedTargets = archiveTargets(archiveConfig, conversation).flatMap((target) => [
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
        conversations.push({
          provider: provider.id,
          sourcePath: ref.path,
          projectName: conversation.project?.name,
          updatedAt: conversation.updatedAt ?? conversation.startedAt,
          outputs: renderedTargets.map((target) => target.path),
        });
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

  const result = { written, skipped, diagnostics, conversations };
  await writeManifest(archiveConfig, result);
  return result;
}
