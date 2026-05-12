# agent-sync

`agent-sync` is a local-only CLI for archiving agent chat histories from Cursor, Codex, Claude Code, and T3 Code. It reads provider files from disk, normalizes conversations, and writes JSON plus Markdown copies into a central archive and each matched project's `.agents/chats` folder.

> [!IMPORTANT]
> Chat histories can contain private code, prompts, credentials, customer data, and other sensitive context. Keep archives, unknown-project output, sync manifests, provider data, and project-local `.agents/chats` folders out of public repositories.

## Install and Build

```bash
npm install
npm run typecheck
npm test
npm run build
```

After building, run the CLI with:

```bash
node dist/src/cli.js doctor
node dist/src/cli.js status
node dist/src/cli.js sync
node dist/src/cli.js watch
```

During development, you can also use:

```bash
npm run dev -- doctor
```

## Configuration

Create `agent-sync.config.json` in the directory where you run the CLI. If the file is missing, `agent-sync` uses the built-in defaults shown below.

```json
{
  "projectRoots": ["~/code"],
  "centralArchiveDir": "~/code/agent-sync/archive",
  "unknownProjectDir": "~/code/agent-sync/unknown-project",
  "projectArchiveDir": ".agents/chats",
  "providers": {
    "cursor": { "enabled": true },
    "codex": { "enabled": true },
    "claude-code": { "enabled": true },
    "t3code": { "enabled": true }
  }
}
```

Provider `paths` are optional. When configured, they limit discovery and diagnostics to those locations:

```json
{
  "providers": {
    "codex": {
      "enabled": true,
      "paths": ["~/.codex/sessions"]
    }
  }
}
```

## Commands

```bash
# Check project roots, provider paths, archive directories, and ignore guards.
node dist/src/cli.js doctor

# Show the latest sync manifest summary.
node dist/src/cli.js status

# Run a one-shot sync.
node dist/src/cli.js sync

# Watch enabled provider paths and sync changed providers after a short debounce.
node dist/src/cli.js watch
```

## Archive Layout

Matched conversations are written to both the central archive and the matched project:

```text
archive/<project>/YYYY/MM/DD/<provider>-<timestamp>-<stable-id>.json
archive/<project>/YYYY/MM/DD/<provider>-<timestamp>-<stable-id>.md
<project>/.agents/chats/YYYY/MM/DD/<provider>-<timestamp>-<stable-id>.json
<project>/.agents/chats/YYYY/MM/DD/<provider>-<timestamp>-<stable-id>.md
```

Unmatched conversations are not written into project folders. They go only to:

```text
unknown-project/YYYY/MM/DD/<provider>-<timestamp>-<stable-id>.json
unknown-project/YYYY/MM/DD/<provider>-<timestamp>-<stable-id>.md
```

The sync manifest is written to:

```text
archive/.agent-sync-manifest.json
```

## Project Matching and Unknown Projects

`agent-sync` discovers projects under `projectRoots` and matches conversations using provider metadata such as current working directory, workspace, repository path, and source file location. When no project match is found, the conversation is treated as unknown and is archived only under `unknownProjectDir` for manual review.

## Watch Behavior

`watch` observes enabled provider watch paths, ignores the initial file scan, waits for writes to settle, and debounces rapid changes for 500 ms. A changed provider path triggers a provider-scoped sync when possible; ambiguous changes fall back to the normal sync pipeline. Content fingerprints prevent unchanged archive files from being rewritten.

## Project-Local Ignore Guard

Before writing matched conversations into a project archive, `agent-sync` ensures the project-local archive path is ignored by Git. For the default `.agents/chats` path, it uses the less invasive guard `<project>/.agents/.gitignore` with `chats/`; it does not edit the project's root `.gitignore`. If the project archive path is unsafe or the guard cannot be written, the project-local write is skipped and reported as a diagnostic.

The default is private-by-default. Chat archives stay ignored unless you deliberately force-add them, for example with `git add -f .agents/chats`.

## Public Repo Safety

This repository's `.gitignore` excludes generated archives, provider-local data, manifests, `dist/`, and `node_modules/`. Keep those rules in place before running real sync or watch commands. Do not commit real chat histories, secrets, provider exports, generated archives, or build output.
