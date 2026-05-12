export type ProviderId = "cursor" | "codex" | "claude-code" | "t3code";

export type MessageRole = "user" | "assistant" | "system" | "tool" | "unknown";

export type SourceKind = "json" | "jsonl" | "sqlite" | "directory" | "unknown";

export type MatchKind = "cwd" | "workspace" | "repo" | "metadata";

export type SyncConfig = {
  projectRoots: string[];
  centralArchiveDir: string;
  unknownProjectDir: string;
  projectArchiveDir: string;
  providers: Record<string, { enabled: boolean; paths?: string[] }>;
};

export type RawConversationRef = {
  provider: ProviderId;
  path: string;
  kind: SourceKind;
  idHint?: string;
};

export type NormalizedMessage = {
  id?: string;
  role: MessageRole;
  createdAt?: string;
  text?: string;
  toolName?: string;
  raw?: unknown;
};

export type ProjectMatch = {
  name: string;
  root: string;
  matchedBy: MatchKind;
};

export type NormalizedConversation = {
  schemaVersion: 1;
  provider: string;
  providerConversationId: string;
  stableId: string;
  title?: string;
  project?: ProjectMatch;
  startedAt: string;
  updatedAt?: string;
  source: {
    path: string;
    kind: SourceKind;
  };
  messages: NormalizedMessage[];
  metadata: Record<string, unknown>;
};

export type ProviderAdapter = {
  id: ProviderId;
  label: string;
  discover(config: SyncConfig): Promise<RawConversationRef[]>;
  read(ref: RawConversationRef): Promise<NormalizedConversation>;
  watchPaths?(config: SyncConfig): string[];
};

export type DiscoveredProject = {
  name: string;
  root: string;
};

export type SyncDiagnostic = {
  level: "info" | "warn" | "error";
  provider?: string;
  sourcePath?: string;
  message: string;
};
