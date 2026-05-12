import type { ProviderAdapter } from "../types.js";
import { buildConversation, discoverJsonRefs, expandHomePaths, readJsonRecords } from "./generic-json.js";

const defaultPaths = ["~/.claude", "~/.config/Claude/claude-code-sessions"];

export const claudeCodeProvider: ProviderAdapter = {
  id: "claude-code",
  label: "Claude Code",
  discover: (config) => discoverJsonRefs(config, "claude-code", defaultPaths),
  async read(ref) {
    return buildConversation("claude-code", ref, await readJsonRecords(ref), {
      idField: "sessionId",
      cwdField: "cwd",
    });
  },
  watchPaths: (config) => expandHomePaths(config.providers["claude-code"]?.paths ?? defaultPaths),
};
