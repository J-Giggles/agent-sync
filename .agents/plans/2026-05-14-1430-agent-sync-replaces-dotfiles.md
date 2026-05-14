# Agent Sync Replaces Dotfiles

**Branch:** staging
**Worktree:** /home/jgigg/code/agent-sync
**Started:** 2026-05-14T14:30+02:00

## Goal
Make agent-sync the complete source of truth and installer for the remaining agent config previously owned by dotfiles, so the dotfiles repo can be deleted.

## Plan
- [x] Inventory remaining dotfiles-owned files and classify each as migrate, replace, or machine-local.
- [x] Move Claude settings, Codex config shape, helper scripts, and custom skills into agent-sync-owned tracked paths.
- [x] Add an idempotent install command that populates all live paths from agent-sync, not only rule files.
- [x] Replace dotfiles-specific sync wrappers with agent-sync equivalents.
- [x] Update docs with the full bootstrap flow and dotfiles deletion checklist.
- [x] Add tests for full config install planning, backup behavior, and idempotency.
- [x] Run typecheck, tests, build, and the installer dry run.

## Acceptance criteria
- agent-sync can install `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`, `~/.claude/settings.json`, `~/.codex/config.toml`, custom Claude skills, and local helper scripts.
- Live symlinks for those migrated files point at agent-sync after installation.
- No command or hook refers to `~/dotfiles`.
- Active generated/private chat archives remain ignored.
- The old dotfiles repo has no remaining unique agent config needed for normal setup.
- Tests cover the new installer behavior.
- `npm run typecheck`, `npm test`, and `npm run build` pass.

## Notes
The user explicitly wants to delete dotfiles and is willing to regenerate secrets. Do not commit active credentials; migrate config structure with placeholder values where needed. `global/codex/config.toml` uses `REGENERATE_ME` for the Jira API token. Live symlinks for rules, settings, scripts, and custom skills now point at agent-sync.
