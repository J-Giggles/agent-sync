import type { ProviderAdapter } from "../types.js";
import { buildConversation, discoverJsonRefs, expandHomePaths, readJsonRecords } from "./generic-json.js";

const defaultPaths = ["~/.config/cursor/chats", "~/.config/Cursor/User/globalStorage", "~/.cursor/plans"];

export const cursorProvider: ProviderAdapter = {
  id: "cursor",
  label: "Cursor",
  discover: (config) => discoverJsonRefs(config, "cursor", defaultPaths),
  async read(ref) {
    return buildConversation("cursor", ref, await readJsonRecords(ref), {
      idField: "id",
      titleField: "title",
      workspaceField: "workspace",
    });
  },
  watchPaths: (config) => expandHomePaths(config.providers.cursor?.paths ?? defaultPaths),
};
