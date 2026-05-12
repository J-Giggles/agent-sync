# Local Agent Chat Sync Design

## Goal

Build a local-only TypeScript CLI that syncs chat histories from Cursor, Codex, Claude Code, and T3 Code into a central `agent-sync` archive and each matched project's `.agents/chats` directory.

## Scope

The first version reads only local files. It does not use provider APIs. The architecture must still be provider-adapter based so new providers or better provider-specific readers can be added later.

The tool writes full normalized archives in both destinations for matched projects. If a chat cannot be matched to a known project, it is written only to the central `unknown-project` archive.

## CLI

The CLI exposes four commands:

```bash
agent-sync sync
agent-sync watch
agent-sync status
agent-sync doctor
```

`agent-sync sync` performs a one-shot sync from all enabled providers.

`agent-sync watch` keeps running and syncs changes as provider files are created or updated.

`agent-sync status` reports discovered providers, discovered projects, latest synced conversations, and unknown-project items.

`agent-sync doctor` checks provider paths, readable source files, project matching behavior, and adapter warnings.

## Configuration

The tool reads `agent-sync.config.json` from the current working directory by default.

Initial configuration:

```json
{
  "projectRoots": ["~/code"],
  "centralArchiveDir": "~/code/agent-sync/archive",
  "unknownProjectDir": "~/code/agent-sync/unknown-project",
  "projectArchiveDir": ".agents/chats",
  "providers": {
    "cursor": { "enabled": true },
    "codex": { "enabled": true },
    "claudeCode": { "enabled": true },
    "t3code": { "enabled": true }
  }
}
```

Provider source paths should have sensible Linux defaults but remain configurable per provider.

## Provider Architecture

Each provider is implemented as an adapter with a common interface:

```ts
interface ProviderAdapter {
  id: "cursor" | "codex" | "claude-code" | "t3code";
  label: string;
  discover(config: SyncConfig): Promise<RawConversationRef[]>;
  read(ref: RawConversationRef): Promise<NormalizedConversation>;
  watch?(
    config: SyncConfig,
    onChange: (ref: RawConversationRef) => void
  ): Promise<WatcherHandle>;
}
```

Adapters are responsible for discovering raw local records and translating provider-specific storage into the normalized schema. Provider-specific fields that do not belong in the common schema are preserved under `metadata`.

## Normalized Schema

Each synced conversation is stored as normalized JSON and human-readable Markdown.

```ts
type NormalizedConversation = {
  schemaVersion: 1;
  provider: string;
  providerConversationId: string;
  stableId: string;
  title?: string;
  project?: {
    name: string;
    root: string;
    matchedBy: "cwd" | "workspace" | "repo" | "metadata";
  };
  startedAt: string;
  updatedAt?: string;
  source: {
    path: string;
    kind: "json" | "jsonl" | "sqlite" | "directory" | "unknown";
  };
  messages: Array<{
    id?: string;
    role: "user" | "assistant" | "system" | "tool" | "unknown";
    createdAt?: string;
    text?: string;
    toolName?: string;
    raw?: unknown;
  }>;
  metadata: Record<string, unknown>;
};
```

`stableId` is deterministic and must be derived from durable provider fields where possible. If a provider lacks a durable id, it can be derived from source path and initial timestamp.

## Archive Layout

Central matched archive:

```text
archive/
  <project-slug>/
    YYYY/
      MM/
        DD/
          <provider>-<chat-start>-<stable-id>.json
          <provider>-<chat-start>-<stable-id>.md
```

Central unmatched archive:

```text
unknown-project/
  YYYY/
    MM/
      DD/
        <provider>-<chat-start>-<stable-id>.json
        <provider>-<chat-start>-<stable-id>.md
```

Project-local archive:

```text
<project>/.agents/chats/
  YYYY/
    MM/
      DD/
        <provider>-<chat-start>-<stable-id>.json
        <provider>-<chat-start>-<stable-id>.md
```

The archive date is based on the chat start date when available. If the provider does not expose a start date, the source file modified time is used.

## Project Matching

The sync engine discovers projects under configured `projectRoots`. A project is a directory that is a Git repository, has a known project manifest such as `package.json`, or already has a `.agents` directory.

Conversation project identity is inferred from provider metadata such as current working directory, workspace path, repo root, or recorded file paths.

Matched conversations are written to both central and project-local archives. Unmatched conversations are written only to `unknown-project` so they can be reviewed and moved later.

## Sync Behavior

Sync must be idempotent. Re-running the CLI updates the same destination files instead of creating duplicates.

The sync pipeline is:

1. Load config.
2. Discover projects.
3. Run enabled provider adapters.
4. Normalize conversations.
5. Match each conversation to a project.
6. Render JSON and Markdown.
7. Write matched conversations to central and project-local archives.
8. Write unmatched conversations only to central `unknown-project`.
9. Update a sync manifest for fingerprints, latest write times, warnings, and source-to-output mapping.

The sync manifest should be small and machine-readable. It is an optimization and diagnostic aid, not the source of truth.

## Watch Behavior

Watch mode uses provider watch paths and the same sync pipeline as one-shot sync.

File changes are debounced before processing. If a provider can map a changed file to one conversation, only that conversation is resynced. If not, that provider performs a scoped rescan.

Watch mode must avoid excessive rewrites by comparing content fingerprints before writing output files.

## Error Handling

Provider failures are isolated. A failure in one provider must not prevent other providers from syncing.

Conversations that cannot be parsed should not be written into project `.agents` directories. Diagnostics can be written to a central `errors/` area with provider id, source path, timestamp, and error message.

`doctor` should report missing provider paths, unreadable files, unknown-project count, adapter warnings, and project matching issues.

## Testing

The implementation should include:

- Unit tests for provider discovery and parsing using fixtures.
- Unit tests for project discovery and project matching.
- Unit tests for deterministic archive paths and idempotent writes.
- Integration tests that sync fixture conversations into temporary central and project archive directories.
- Focused watch tests for debounce behavior and changed-file routing.

## Acceptance Criteria

- `agent-sync sync` archives local Cursor, Codex, Claude Code, and T3 Code conversations through provider adapters.
- Matched conversations are written as full normalized JSON and Markdown to both central and project-local archives.
- Unmatched conversations are written only to `unknown-project`.
- Archive folders are ordered by chat start date, falling back to source file modified time.
- Re-running sync is idempotent.
- `agent-sync watch` syncs changes through the same logic as one-shot sync.
- Provider-specific metadata is preserved under `metadata`.
- Provider failures are isolated and visible through diagnostics.
