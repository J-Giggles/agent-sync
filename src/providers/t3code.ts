import type { ProviderAdapter } from "../types.js";
import { buildConversation, discoverJsonRefs, expandHomePaths, readJsonRecords } from "./generic-json.js";

const defaultPaths = ["~/.config/t3code", "~/.config/t3code-dev"];

export const t3codeProvider: ProviderAdapter = {
  id: "t3code",
  label: "T3 Code",
  discover: (config) => discoverJsonRefs(config, "t3code", defaultPaths),
  async read(ref) {
    return buildConversation("t3code", ref, await readJsonRecords(ref), {
      idField: "id",
      titleField: "title",
      cwdField: "cwd",
    });
  },
  watchPaths: (config) => expandHomePaths(config.providers.t3code?.paths ?? defaultPaths),
};
