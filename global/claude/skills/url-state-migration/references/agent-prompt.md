# Agent prompt template

The controller composes this for each file in Phase 3. Replace `<...>` placeholders with concrete values per file.

```
You are migrating modal state to URL state using nuqs in a single file.

## File

<absolute path>

## Modals to migrate (from app-coverage catalog)

<list of (stable-name, classification, current-pattern-hint, suggested-param-name) — one per line>

## References

Read these before editing:
- ~/.claude/skills/url-state-migration/references/migration-recipes.md
- ~/.claude/skills/url-state-migration/references/nuqs-patterns.md

## Steps

1. Read the file at the path above. Confirm it contains the modals listed.
2. For each modal in the list, identify which Recipe (1-6) in migration-recipes.md applies. Pick by matching the source-state pattern.
3. Apply the matching recipe verbatim. Use the suggested param-name for the nuqs key.
4. After all modals in the file are migrated (or skipped per Recipe 4/5/6 as DONE_WITH_CONCERNS):
   a. Run `pnpm lint --fix <path>` (resolve `<path>` to the relative path from the repo root).
   b. Run `pnpm tsc --noEmit`. If type-check fails on the migrated file or anywhere downstream, see "Failure handling" below.
5. Verify the diff is scoped only to the assigned file:
   ```bash
   git status --porcelain
   ```
   The output must show only the assigned file as modified. If anything else appears, undo it (`git checkout -- <other-file>`) before continuing.
6. Commit:
   ```bash
   git add <path>
   git commit -m "$(cat <<'EOF'
   refactor(<feature>): URL-control modal state in <basename> via nuqs

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```
   `<feature>` is the parent feature directory name (e.g. `finance`, `invoices`); `<basename>` is the file's basename without extension.
7. Report DONE (or DONE_WITH_CONCERNS if any modals were skipped) with:
   - File path
   - Per-modal result: `<stable-name> → <recipe-applied or "skipped: <reason>"> → <url-contract or "n/a">`
   - Commit SHA: `git rev-parse HEAD`

## Failure handling

If `pnpm tsc --noEmit` fails:
- Read the error.
- If the error is in the migrated file and is fixable by adjusting the migration (e.g. an unused import, a wrong type annotation), fix it and re-run typecheck.
- If the error is downstream (in a file that imports from this one) and the migration changed a type signature you didn't intend, the migration overstepped — `git checkout -- <path>` and report BLOCKED with the error.
- If the error is downstream and the migration changed a public type by necessity (e.g. a state setter signature), that's a sign this migration shouldn't be in scope — report BLOCKED with the error.

If `pnpm lint --fix` fails:
- Read the error. If it's an auto-fixable lint rule that wasn't auto-fixed, apply the fix manually.
- If the lint error indicates a real code-quality issue introduced by the migration, fix it.
- If the lint error is in unrelated code in the same file (pre-existing), do NOT fix it — out of scope. Report DONE_WITH_CONCERNS noting the pre-existing issue.

If `git status` shows files outside the assigned path:
- These are agent overreach. Run `git checkout -- <other-file>` to revert each.
- If reverting affects the typecheck, restart the migration from step 1.
- Report DONE_WITH_CONCERNS noting which files you reverted.

## Constraints

- Do not modify any file other than the assigned path. The skill controller verifies this post-commit and rejects out-of-bounds commits.
- Do not add new dependencies. `nuqs` is already installed.
- Do not change modal *behavior* — only the source of open/close/ID state. The user-visible result is identical except the URL now reflects the open state.
- If a modal pattern doesn't match Recipes 1-3, report DONE_WITH_CONCERNS naming the modal and skip it. Do not improvise.
- Do not edit the catalog at `docs/superpowers/app-coverage.md`. The skill controller updates the catalog in Phase 4 based on your DONE results.

## Report format

```
Status: DONE | DONE_WITH_CONCERNS | BLOCKED
File: <path>
Commit: <sha or "none">
Modals:
- <stable-name>: <result>
- ...
Concerns: <free-form, if any>
```
```
