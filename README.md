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
node dist/src/cli.js pull:t3 --dry-run
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

# Create missing `.agents/.gitignore` guards without syncing chats.
node dist/src/cli.js doctor --fix-ignore-guards

# Show the latest sync manifest summary.
node dist/src/cli.js status

# Run a one-shot sync.
node dist/src/cli.js sync

# Watch enabled provider paths and sync changed providers after a short debounce.
node dist/src/cli.js watch

# Preview normalized archive conversations that could be surfaced in T3.
node dist/src/cli.js pull:t3 --dry-run

# Narrow the preview before exporting or writing.
node dist/src/cli.js pull:t3 --dry-run --project agent-sync --provider codex --since 2026-05-12 --limit 10

# List every planned conversation instead of only grouped totals.
node dist/src/cli.js pull:t3 --dry-run --verbose

# Export a T3 projection import plan without touching the T3 database.
node dist/src/cli.js pull:t3 --export ./t3-import.ndjson
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

To pre-create those guards without scanning or syncing chats, run `agent-sync doctor --fix-ignore-guards`.

The default is private-by-default. Chat archives stay ignored unless you deliberately force-add them, for example with `git add -f .agents/chats`.

## T3 Archive Pull

`pull:t3` reads normalized JSON conversations from the configured central archive and `unknownProjectDir`. It does not reread provider sources. By default it is a dry run, so this is the safest starting point:

```bash
node dist/src/cli.js pull:t3 --dry-run
```

Use filters before exporting or importing:

```bash
node dist/src/cli.js pull:t3 --dry-run --project agent-sync --provider codex --since 2026-05-12 --limit 10
```

To hand the projection data to another tool without writing to T3, export NDJSON:

```bash
node dist/src/cli.js pull:t3 --export ./t3-import.ndjson
```

SQLite writes are opt-in and require an explicit `--database` path. Only use `--write` after reviewing a dry run or export, and prefer a copy of T3's database until you are comfortable with the result:

```bash
cp ~/.t3/userdata/state.sqlite /tmp/t3-agent-sync-test.sqlite
node dist/src/cli.js pull:t3 --write --database /tmp/t3-agent-sync-test.sqlite --limit 5
```

Imported rows use deterministic `agent-sync:` IDs and metadata markers, so rerunning the command does not duplicate already-imported archive conversations.

If the archive contains duplicate copies of the same provider conversation, for example T3 records synced from both `~/.t3/dev/state.sqlite` and `~/.t3/userdata/state.sqlite`, `pull:t3` collapses them by provider conversation id and reports the number of deduplicated archive copies.

## Public Repo Safety

This repository's `.gitignore` excludes generated archives, provider-local data, manifests, `dist/`, and `node_modules/`. Keep those rules in place before running real sync or watch commands. Do not commit real chat histories, secrets, provider exports, generated archives, or build output.
