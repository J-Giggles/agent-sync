import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { SyncConfig } from "./types.js";

const providerConfigSchema = z.object({
  enabled: z.boolean(),
  paths: z.array(z.string()).optional(),
});

const syncConfigSchema = z.object({
  projectRoots: z.array(z.string()).min(1),
  centralArchiveDir: z.string().min(1),
  unknownProjectDir: z.string().min(1),
  projectArchiveDir: z.string().min(1),
  providers: z.record(providerConfigSchema),
});

export const defaultConfig: SyncConfig = {
  projectRoots: ["~/code"],
  centralArchiveDir: "~/code/agent-sync/archive",
  unknownProjectDir: "~/code/agent-sync/unknown-project",
  projectArchiveDir: ".agents/chats",
  providers: {
    cursor: { enabled: true },
    codex: { enabled: true },
    "claude-code": { enabled: true },
    t3code: { enabled: true },
  },
};

export async function loadConfig(cwd = process.cwd()): Promise<SyncConfig> {
  const configPath = join(cwd, "agent-sync.config.json");

  try {
    const raw = await readFile(configPath, "utf8");
    return syncConfigSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultConfig;
    }

    throw error;
  }
}
