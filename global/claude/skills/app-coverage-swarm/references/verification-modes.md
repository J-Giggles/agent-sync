# Verification modes

Loaded by `app-coverage-swarm` during Phase 5 (mode selection) and Phase 6 (audit dispatch).

## Modes

### static

Subagents read code only. No browser, no dev server.

- Fast: typical audit pass takes ~1 minute per route slice
- Catches: hardcoded colors, missing tokens, import patterns, copy issues, prop usage, code-shape concerns
- Misses: anything that only manifests at render time — overflow, layout collapse, viewport-dependent behavior, focus management, color contrast under real backgrounds, animation jank

Subagent prompt for static mode includes: route URL, list of files reachable from the route (3-level import walk), the task description.

### playwright

Subagents read code AND visit the URL with Playwright tools.

- Slow: ~5-10 seconds per state for navigate + screenshot, plus code reading
- Catches everything static catches, plus rendered-state issues
- Required for: responsive/overflow tasks, a11y audits, contrast checks, focus management, anything visual

Each subagent uses these MCP tools:
- `mcp__plugin_playwright_playwright__browser_navigate`
- `mcp__plugin_playwright_playwright__browser_resize` (for breakpoint tasks)
- `mcp__plugin_playwright_playwright__browser_take_screenshot`
- `mcp__plugin_playwright_playwright__browser_snapshot` (DOM dump for analysis)
- `mcp__plugin_playwright_playwright__browser_console_messages` (catch runtime errors)

### Auto-pick

Heuristic on the task description string, lowercased:

| Keyword present | Mode |
|---|---|
| `branding`, `brand`, `color`, `palette`, `copy`, `wording`, `import`, `unused`, `dependency`, `lint`, `token` | static |
| `responsive`, `overflow`, `mobile`, `breakpoint`, `layout`, `spacing`, `a11y`, `accessibility`, `contrast`, `keyboard`, `focus`, `screen-reader`, `aria`, `tab-order` | playwright |
| no match | ask the user explicitly |

Multiple matches across categories: pick playwright (more thorough wins).

## Dev server handling (playwright mode only)

Before dispatching the audit pass:

1. Read the project's dev script from `package.json` (`scripts.dev`).
2. Detect the configured port from `next.config.ts`/`next.config.js`/`.env*` (default 3000).
3. Probe the port: `curl -sf http://localhost:<port> > /dev/null`.
   - If 200/3xx response → reuse the running server. Note this in the run summary.
   - If connection refused → start `pnpm dev` (or `npm run dev`) as a background process via `Bash` with `run_in_background: true`. Wait for the port to respond (poll up to 30s, 1s interval).
   - If the start fails → abort the run, surface the error, do not partially dispatch.
4. After the swarm completes (or fails): if the skill started the server, leave it running. The user may have wanted it. Note the PID in the summary so the user can kill it manually.

The skill never kills a dev server it didn't start, and never kills one it did start without explicit user instruction.

## Subagent prompt template (playwright mode)

```
You are auditing a slice of routes for the task: "<task description>".

The dev server is running at <base-url>.

Your assigned slice (from the catalog):
<slice-yaml-or-list>

For each (route, state) entry:
1. Navigate to <base-url><route><state-query-or-path>.
2. Take a screenshot at viewport 1280x800 and 375x812 (mobile).
3. Read DOM snapshot and console messages.
4. Read the route's page.tsx and layouts that apply.
5. Identify findings against the task. Each finding: file path, line range, issue, proposed change.

Output: write findings to docs/superpowers/swarm-findings/<task-slug>/<route-slug>.md using the format in ~/.claude/skills/app-coverage-swarm/examples/findings.md. Do not edit any code.

Stop when your slice is complete. Report file path of findings written and a one-line summary per route.
```

## Subagent prompt template (static mode)

```
You are auditing a slice of routes for the task: "<task description>".

Your assigned slice (from the catalog):
<slice-yaml-or-list>

For each (route, state) entry:
1. Read the route's page.tsx and layouts that apply.
2. Read components reachable from the page via imports up to 2 levels deep.
3. Identify findings against the task. Each finding: file path, line range, issue, proposed change.

Output: write findings to docs/superpowers/swarm-findings/<task-slug>/<route-slug>.md using the format in ~/.claude/skills/app-coverage-swarm/examples/findings.md. Do not edit any code.

Stop when your slice is complete. Report file path of findings written and a one-line summary per route.
```
