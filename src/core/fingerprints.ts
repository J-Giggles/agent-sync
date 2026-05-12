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
