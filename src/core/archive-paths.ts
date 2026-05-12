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
  if (Number.isNaN(date.getTime()) || date.toISOString() !== iso) {
    throw new Error(`Invalid conversation startedAt: ${iso}`);
  }

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
