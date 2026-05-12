# T3 Archive Import

**Branch:** staging
**Worktree:** /home/jgigg/code/agent-sync
**Started:** 2026-05-12T23:15:55+02:00

## Goal
Add a local-only `agent-sync pull:t3` command that previews, exports, and safely imports normalized archive conversations into a T3-compatible projection database without committing private chat data.

## Plan
- [ ] Inspect T3 projection schema metadata without printing message text.
- [ ] Add fixture normalized archive conversations and a fixture T3-style SQLite database for tests.
- [ ] Write failing tests for dry-run summary, archive filtering, export output, idempotent SQLite import, and duplicate prevention.
- [ ] Implement archive discovery and filtering from the central normalized archive.
- [ ] Implement T3 projection import planning, deterministic IDs, metadata markers, dry-run default behavior, and NDJSON export.
- [ ] Wire the `pull:t3` CLI command and document safe usage.
- [ ] Run `npm run typecheck`, `npm test`, and `npm run build`.
- [ ] Commit the completed implementation on `staging` without generated chat archives or provider data.

## Acceptance criteria
- `agent-sync pull:t3 --dry-run` reads the normalized central archive and reports planned imports without writing to T3.
- Filters support `--project <name>`, `--provider <provider>`, `--since <date>`, and `--limit <n>`.
- `--export ./t3-import.ndjson` writes an importable NDJSON projection without touching a T3 database.
- SQLite import is opt-in and idempotent; running twice does not create duplicate threads or messages.
- Imported T3 rows include clear `[agent-sync] <provider> / <project> / <date>` titles and metadata preserving provider, source archive path, project, timestamps, and provider conversation id.
- Tests cover dry-run, filtering, idempotency, and duplicate prevention against fixture archives and a fixture projection schema.
- Privacy guards remain intact: no chat archives, provider data, copied SQLite databases, or `.agents/chats` are committed.

## Notes
Use the central archive as source of truth rather than rereading provider stores. Do not write to the live T3 database by default; tests should write only to temporary fixture databases. T3 schema inspection performed locally must show only table names, column names, counts, IDs, and timestamps.
