# Feature-momentum rule

Real software work fragments easily — tangents accumulate, branches collect half-done features, and "I'll come back to it" rarely happens. The user has explicitly opted into the discipline below. Be opinionated about it. Casual pushback ("just quickly do X first", "while you're in there") does not bypass the rules. Only an explicit override — phrasings like "ignore the current feature, do this instead" or "skip the rules for this turn" — does.

This is the global Codex feature-momentum rule file and is synced into `~/.codex/AGENTS.md` by `agent-sync rules:install`.

## Architecture: staging-first, short-lived task branches

Default to working on `staging`, not `main`. `main` is protected: do not edit it directly unless the user explicitly grants permission in that moment. The normal flow is `staging` → PR/merge → `main`; `main` should only change via a PR or merge from `staging`.

`staging` is the integration branch. Parallel work should converge there continuously in small, verified slices. Avoid long-lived "agent branches" that drift for days and then try to merge a pile of unrelated work at the end. Branches and worktrees are for isolating a coherent task, not for giving every agent a private universe.

Do not create a branch or worktree automatically just because the user asks for a change. First decide whether the current branch is acceptable:

- If the current branch is `staging`, small and medium changes can happen there directly.
- If the current branch is `main`, stop before code changes and ask whether to switch/create `staging` or continue on `main`; recommend `staging`.
- If the work is risky, large, multi-turn, likely to conflict with other work, or intended to run in parallel with another agent, ask whether to create a separate branch/worktree. Do not create it without user approval.

Worktrees are still the preferred tool for parallel feature work, but they are opt-in for the task at hand rather than mandatory for every change. When they are used, keep them short-lived and merge finished slices back to `staging` quickly.

This also composes cleanly with [obra/superpowers](https://github.com/obra/superpowers), which must be installed globally (see "Starting work" step 1 below). Superpowers brings the execution methodology (brainstorming, TDD, subagent-driven development, code review), this rule brings the lifecycle discipline (staging-first protection, plan files for larger work, completion commits, ship through staging). They are complementary — defer to Superpowers' skills for *how* to build; this rule governs *what* to build, when to stop, and how to ship.

## Orientation (run silently at the start of any turn that involves code)

Before responding, build a picture of state with these checks. Don't narrate them; only surface what's actionable.

1. `pwd` and `git rev-parse --show-toplevel` — confirm which worktree this chat lives in.
2. `git branch --show-current` and `git status --short`.
3. **Locate this chat's plan file only when one exists or is needed.** If the conversation has already created or read a plan file in `.agents/plans/`, use that exact file path — don't re-search. If this is isolated feature work, find the matching plan file (most recent file whose kebab-name suffix matches the current branch) and read it. Tiny direct changes on `staging` do not need a plan file.
4. **Verify the chat's branch anchor when a plan file exists.** Compare `git branch --show-current` against the plan file's `**Branch:**` field. If they differ, stop and surface the mismatch — see "Plan file is the chat's identity" below. Do not proceed with code work tied to that plan.
5. `git log --oneline -10` for recent history.

From this, answer three questions: which branch is active, whether the request belongs on `staging` or needs isolation, and whether an existing plan file constrains the work.

## Project memory protocol

Use project-local memory as the durable source of truth. Before substantial investigation or implementation, read `AGENTS.md` plus `.context/index.md` and `.context/docs.md` when they exist. Also honor nearby harness adapters such as `.cursor/rules/*.mdc`, `CLAUDE.md`, `GEMINI.md`, or nested `AGENTS.md`.

During work, collect candidate learnings but do not immediately persist them. At the end of substantial work, propose a short **Memory Candidates** block with:

- Learned fact or rule
- Evidence/source
- Confidence
- Suggested destination

Use `.context/docs.md` for durable project facts, workflows, architecture notes, commands, ports, and gotchas. Use `.context/index.md` only for high-level orientation. Use harness rule files only for instructions future agents must actively follow. Never save secrets, private env values, customer data, speculation, or one-off debugging noise as durable project memory.

## Starting work

Before any code is written, walk this exact sequence:

1. **Verify Superpowers is installed globally.** Check `test -d ~/.agents/skills/using-superpowers`. If missing, install it once for the whole machine — no per-worktree install needed:

   ```bash
   npx --yes skills add obra/superpowers -g --all
   ```

   This brings in Jesse Vincent's methodology skills (brainstorming, writing-plans, subagent-driven-development, TDD, code review, finishing-a-development-branch, using-git-worktrees) and symlinks them into every supported agent's skill directory. They trigger automatically as needed across every project and every worktree. If the check passes, skip this step.

2. **Enforce the branch policy.**

   - If the current branch is `main`, stop and ask:

     > *"This checkout is on `main`. Your rule says `main` should only change via PR/merge from `staging`. Should I switch/create `staging` and do the work there, or do you explicitly want me to continue on `main` for this change?"*

     Do not edit files on `main` until the user explicitly answers.

   - If the current branch is `staging`, continue there unless the change clearly needs isolation.
   - If there is no `staging` branch, ask whether to create it from `main` before proceeding.
   - If the current branch is a feature/fix/chore branch, continue only if the request belongs to that branch; otherwise ask whether to switch to `staging` or create a separate branch/worktree.

3. **Ask before creating a branch/worktree.** Recommend a separate branch/worktree only when the work is large, risky, multi-turn, or parallel to existing work. Use this prompt:

   > *"Do you want this directly on `staging`, or should I create a separate branch/worktree for it?"*

   If the user chooses a separate branch/worktree, create it from `staging`:

   ```bash
   git worktree add ../<repo-name>-<feature-suffix> staging -b feat/<kebab-name>
   ```

   Pick the branch prefix by intent: `feat/` for new functionality, `fix/` for bugs, `chore/` for tooling/cleanup. The `<feature-suffix>` in the path is usually a short version of the kebab-name.

   After creating a task branch/worktree, push it early once the plan/init commit exists:

   ```bash
   git push -u origin <branch-name>
   ```

   This remote branch is for backup, visibility, and review. It is not a replacement for integrating back to `staging`.

4. **Open the worktree in a fresh editor window when a worktree was chosen.** Tell the user to open the new directory and start a new Codex chat there. Do not continue feature implementation in the old checkout if the new worktree was created for isolation.

5. **Write the plan file for larger or isolated work** at `.agents/plans/<YYYY-MM-DD-HHMM>-<kebab-name>.md` (no seconds; example: `2026-05-02-1430-invoice-pdf-export.md`). A plan file is required for separate feature worktrees and recommended for multi-turn work on `staging`; tiny direct changes on `staging` can skip it. The file is committed, not gitignored — it travels with the branch and shows up in PR diffs. If `.agents/` appears in `.gitignore`, remove that entry first and tell the user. Template:

   ```markdown
   # <Feature name>

   **Branch:** <branch-name>
   **Worktree:** <absolute-path-to-worktree>
   **Started:** <ISO datetime>

   ## Goal
   <one-line goal>

   ## Plan
   - [ ] <step 1>
   - [ ] <step 2>
   - [ ] <step 3>

   ## Acceptance criteria
   - <what "done" looks like>

   ## Notes
   <constraints, decisions, open questions>
   ```

   If the user's request doesn't yet contain enough detail for a plan, have a brief back-and-forth before writing the file — or, better, let Superpowers' `brainstorming` skill drive that conversation. The plan is the contract for the rest of the work.

6. **Make the init commit when a plan file is created** containing only the plan file (and any Superpowers install artifacts, if `npx skills add` modified tracked files):

   ```
   chore(plan): <feature name>
   ```

   No production code in this commit. It's the anchor at the base of the branch.

7. **Tick `[ ]` → `[x]` in the plan file as work progresses.** These updates ride along with relevant code commits, not in standalone "checklist" commits.

## Parallel work integration

Use this workflow when multiple agents or worktrees are active in the same project:

1. Start every task branch from current `staging`, not from `main` and not from another feature branch unless the dependency is explicit in the plan.
2. Keep each branch scoped to one coherent task. If the work splits into unrelated concerns, stop and ask whether to split it into separate task branches.
3. Before substantial edits, before running final tests, and before opening a PR, sync the task branch with latest `staging`:

   ```bash
   git fetch origin
   git merge origin/staging
   ```

   Prefer `git merge origin/staging` for agent work because it preserves the integration history and avoids force-push pressure. Use `git rebase origin/staging` only when the repo convention or user explicitly asks for a linear branch.

4. Resolve conflicts immediately while the context is fresh. Run focused tests after each conflict resolution, then the broader project verification before pushing.
5. Push active task branches after meaningful commits so other agents can see the work:

   ```bash
   git push
   ```

6. Merge completed branches into `staging` promptly through a PR when available. Do not wait for several unrelated branches to finish before integrating the first completed slice.
7. After a branch merges to `staging`, every overlapping active branch must sync from `staging` before continuing. This is the point where integration issues should surface.

Avoid merging task branches directly to `main`. Avoid merging one feature branch into another unless the second branch explicitly depends on the first and the plan says so. Avoid using long-lived per-agent branches as permanent lanes; that only moves the hard merge to the end.

## Plan file is the chat's identity

When a plan file exists, each Codex chat is anchored to exactly one plan file in exactly one worktree. End-of-turn next steps, continuation intuition, and drift checks all read *that specific file* — never "the most recent file in `.agents/plans/`." This is what keeps multiple parallel chats from stepping on each other. Tiny direct changes on `staging` may have no plan file.

If a plan exists and the current branch doesn't match the plan file's `**Branch:**` field — or worse, the current `pwd` doesn't match the `**Worktree:**` field — the chat's environment has been disrupted. Stop and surface this exactly:

> *"This chat is anchored to `<plan-file-path>` for branch `<plan-branch>` in worktree `<plan-worktree>`, but the current state is branch `<actual-branch>` in `<actual-pwd>`. Either restore the original worktree, or close this chat and start a fresh one for the work you actually want to do here. I won't make changes until the environment matches the chat's plan."*

Do not silently re-anchor onto a different plan file — that's how cross-feature contamination happens.

## Continuation intuition

When the user asks "what now?", "where were we?", "continue", or returns mid-feature, never propose generic next steps. Reconstruct what *this* feature is from the chat's anchored plan file (open `[ ]` checkboxes and acceptance criteria), recent commits, the uncommitted diff, and TODO/FIXME comments in that diff. Then frame suggestions as: *"To finish this feature, you still need: …"* tied to specific open items. If checkboxes are all ticked but acceptance criteria aren't fully met, surface that gap explicitly — checkboxes are a proxy, criteria are the contract.

## Drift handling

If the user's next request is not clearly part of the current feature (different domain, different files, different concern from what the branch is about), do not auto-fork and do not create a worktree without asking. Protect the current work, then ask for the target:

- Continue on `staging`
- Switch to `staging` first, if currently elsewhere
- Create a separate branch/worktree from `staging`
- Explicitly continue on `main` only if the user grants permission after the `main` warning

If the chat has prior turns of code work, has anchored to a plan file, or has uncommitted changes for the current feature, stop and respond with exactly three sections:

#### 1. Target branch/worktree question

Ask where the new request should happen. Include:

- Goal in one sentence.
- Recommended target: usually `staging`, unless the current feature branch is the right place.
- A separate branch/worktree option only if isolation is warranted.
- The exact `git worktree add` command only if recommending a worktree.
- A reminder that `main` requires explicit permission and should normally change only via PR/merge from `staging`.
- Specific files or areas to read first.
- Any constraints the user mentioned.

#### 2. Improvement suggestions for the current feature

2–4 concrete things that would make the in-progress work better, grounded in the actual diff and measured against the plan's acceptance criteria. Edge cases not handled, tests missing (Superpowers' `test-driven-development` skill should be running anyway — flag if it isn't), error paths, UX polish, performance — whatever is genuinely missing. If you can't point to something specific, leave the section short rather than padding with generic advice.

#### 3. A "ship it" option

Offer to complete the current feature now using the **Feature-complete sequence** below.

Casual pushback ("just quickly do X first") does not bypass the mid-conversation stop. Only an explicit override ("ignore the current feature, do this instead") does. The hard stop matters because once two features mix on one branch, untangling is painful and PRs become unreviewable. If you're uncertain whether a request is drift or part of the feature, lean toward stopping and asking — the cost of a moment of friction is much lower than a tangled branch.

## Feature-complete sequence

When the user confirms the feature is done, or accepts the "ship it" option:

1. Verify the plan file: every `[ ]` ticked, every acceptance criterion met. If something is missing, finish it or explicitly defer it (and note the deferral in the plan's Notes section).
2. Run the project's test/typecheck commands. Resolve breakage. Don't push with red tests. (If Superpowers' `finishing-a-development-branch` skill is available, defer to it for this verification step — it knows the project's conventions.)
3. Create the completion commit:

   ```
   feat(<scope>): <summary> [feature-complete]

   <body — what shipped vs the plan, anything deferred>

   Feature-Complete: true
   Plan: .agents/plans/<filename>.md
   ```

   Both the `[feature-complete]` subject tag and the `Feature-Complete: true` trailer are intentional: the subject is human-skimmable in `git log`, the trailer is machine-greppable (`git log --grep "Feature-Complete: true"`).
4. Push the branch.
5. Open a PR targeting `staging`. If the work was done directly on `staging`, push `staging` and open/merge the separate PR from `staging` to `main` only when the user asks to promote staging. Link the plan file in the PR body so reviewers see the original contract.
6. After the PR merges, clean up the worktree:

   ```bash
   git worktree remove <path>
   git branch -d feat/<kebab-name>
   ```

## End-of-turn next steps

Every turn that touched code ends with a short "Recommended next steps" block: 1–3 concrete bullets tied to the plan's open checkboxes. Don't pad it; if there's only one obvious next step, just say one.

If the feature appears complete (acceptance criteria met, no obvious TODOs left, diff implements the stated goal), the recommended next step is the **Feature-complete sequence** — frame it as an offer the user can accept.

This block is the main hook that pulls the user back toward finishing instead of drifting. Keep it tight; if it gets noisy, the user will start ignoring it.

## Branch awareness on request

When the user asks "what was I working on", "what's outstanding", or similar:

- `git worktree list` — show every active worktree (these are features in flight, most likely to need attention).
- `gh pr list --author @me --state all` — open and closed PRs.
- `git branch -a` filtered to branches the user authored (check via `git log --author=...`) for branches without PRs.

For each branch/worktree, surface: state vs. base (ahead/behind), open PR if any, last commit age, whether the branch has a `Feature-Complete: true` commit, whether a worktree is still checked out for it, and the linked plan file if `.agents/plans/` contains a matching one. Order so the most-likely-to-need-attention items (active worktree but no completion commit, or no PR despite ticked plan) come first. The point is to remind the user of half-finished features they should return to *before* starting anything new.

## Merge conflict handling

During merge or rebase, don't dump raw conflict markers on the user. For each conflicted file:

1. Read the file and identify each conflict block.
2. Classify each conflict:
   - **Formatting-only** (whitespace, import order, trailing commas): auto-resolve to match the rest of the file's style.
   - **Both-sides-same-intent** (both branches added the same import, both renamed the same thing the same way): auto-resolve to either side.
   - **Genuinely competing logic**: do not auto-resolve. Surface to the user.
3. For competing changes, show a side-by-side summary of what each side does and a recommendation based on the branch context (which side aligns with the current feature's plan).

This keeps the user's attention on decisions that actually need a human, rather than mechanical resolutions.

## Tone

Run silently. Don't narrate the orientation checks. Don't announce "I'm now applying the drift rule." Surface only the actionable output: the worktree command, the handoff prompt, the next-steps bullets, the conflict summary. The user knows the rules are running.

## Skill preferences

- **Brainstorming visual companion: always skip.** Never offer the "Some of what we're working on might be easier to explain if I can show it to you in a web browser..." prompt or any variant of it. Do not mention the companion exists. Do not ask permission to use it. Treat that step in the brainstorming skill as already-declined and move directly to clarifying questions, even when the topic is visual (UI, mockups, layouts, mobile design). Use text, ASCII diagrams, or markdown tables instead.
