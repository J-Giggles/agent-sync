# Global Agent Rules

**Branch:** staging
**Worktree:** /home/jgigg/code/agent-sync
**Started:** 2026-05-14T14:14+02:00

## Goal
Make agent-sync the source of truth and install/sync tool for global Codex and Claude agent rules/config previously owned directly by dotfiles.

## Plan
- [ ] Inspect agent-sync and dotfiles ownership, bootstrap behavior, ignored private archives, and current CLI/test patterns.
- [ ] Add tracked global source files for Codex and Claude rules/config inside agent-sync.
- [ ] Add tested rule/config install planning and idempotent symlink behavior with backup handling.
- [ ] Expose the installer through the agent-sync CLI for new-machine setup.
- [ ] Update docs with the architecture, install command, dotfiles delegation path, and privacy/ignore guarantees.
- [ ] Add or update tests for config loading, install behavior, and CLI-facing status where practical.
- [ ] Run typecheck, tests, and build.

## Acceptance criteria
- agent-sync owns tracked source files for `~/.codex/AGENTS.md` and `~/.claude/CLAUDE.md`, preserving current live rule behavior.
- A new machine can install/sync those global files from agent-sync with a documented command.
- Existing generated/private chat archives remain ignored.
- dotfiles is no longer required to directly own global rule files; either a delegation path is documented or a compatible script snippet is provided.
- Tests cover the new installer behavior where practical.
- `npm run typecheck`, `npm test`, and `npm run build` pass.

## Notes
The current request asks to do the work in this `agent-sync` worktree on `staging`, so this plan does not create a separate feature worktree. The separate `~/dotfiles` repository is currently on `main`; avoid editing it directly unless explicitly approved. Provide a clean delegation path from agent-sync so dotfiles can be removed later once remaining settings/scripts are migrated or declared machine-local.
