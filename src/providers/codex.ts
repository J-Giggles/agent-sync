import type { ProviderAdapter } from "../types.js";
import { buildConversation, discoverJsonRefs, readJsonRecords } from "./generic-json.js";

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
  watchPaths: (config) => config.providers.codex?.paths ?? defaultPaths,
};
