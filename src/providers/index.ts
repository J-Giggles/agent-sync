import type { ProviderAdapter, SyncConfig } from "../types.js";
import { claudeCodeProvider } from "./claude-code.js";
import { codexProvider } from "./codex.js";
import { cursorProvider } from "./cursor.js";
import { t3codeProvider } from "./t3code.js";

const allProviders = [cursorProvider, codexProvider, claudeCodeProvider, t3codeProvider];

export function enabledProviders(config: SyncConfig): ProviderAdapter[] {
  return allProviders.filter((provider) => config.providers[provider.id]?.enabled);
}
