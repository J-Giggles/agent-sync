import { createHash } from "node:crypto";

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  switch (typeof value) {
    case "boolean":
      return `boolean:${value}`;
    case "bigint":
      return `bigint:${value}`;
    case "function":
      return `function:${JSON.stringify(value.name)}`;
    case "number":
      return Number.isFinite(value) ? `number:${value}` : `number:${String(value)}`;
    case "string":
      return `string:${JSON.stringify(value)}`;
    case "symbol":
      return `symbol:${JSON.stringify(value.description)}`;
  }

  if (Array.isArray(value)) {
    const items = [];
    for (let index = 0; index < value.length; index += 1) {
      items.push(Object.hasOwn(value, index) ? stableJson(value[index]) : "hole");
    }

    return `array:[${items.join(",")}]`;
  }

  return `object:{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function createStableId(provider: string, providerConversationId: string, sourcePath: string): string {
  return createHash("sha256").update(stableJson([provider, providerConversationId, sourcePath])).digest("hex").slice(0, 16);
}
