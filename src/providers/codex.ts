import type { ProviderAdapter } from "../types.js";
import { buildConversation, discoverJsonRefs, expandHomePaths, readJsonRecords } from "./generic-json.js";

const defaultPaths = ["~/.codex", "~/.codex/sessions"];

export const codexProvider: ProviderAdapter = {
  id: "codex",
  label: "Codex",
  discover: (config) => discoverJsonRefs(config, "codex", defaultPaths),
  async read(ref) {
    return buildConversation("codex", ref, await readJsonRecords(ref), {
      idField: "sessionId",
      cwdField: "cwd",
    });
  },
  watchPaths: (config) => expandHomePaths(config.providers.codex?.paths ?? defaultPaths),
};
