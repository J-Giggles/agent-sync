# App coverage

_Last reconciled: 2026-05-01 by app-coverage-swarm_

## Global modals

_Modals from `app/layout.tsx` and any layout above the route tree. Counted once total, not per-route._

- [x] modal:command-palette (url: ?cmd=open) — url-controlled
- [ ] modal:workspace-create (url: none) — NOT url-controlled

## Routes

### /
- [x] base

### /dashboard
- [x] base
- [x] modal:invite-user (url: ?modal=invite-user) — url-controlled
- [ ] modal:filters (url: none) — NOT url-controlled

### /invoices
- [x] base
- [x] modal:bulk-actions (url: ?action=bulk) — url-controlled

### /invoices/[id]
- [x] base
- [x] modal:line-item-editor (url: ?edit=<lineItemId>) — url-controlled
- [x] modal:send-confirmation (url: ?confirm=send) — url-controlled

### /settings
- [x] base
- [x] tab:profile (url: /settings/profile) — url-controlled (route segment)
- [x] tab:billing (url: /settings/billing) — url-controlled (route segment)
- [x] tab:team (url: /settings/team) — url-controlled (route segment)

## Task: Fix brand colors across app — 2026-05-01

Mode: static. Findings: docs/superpowers/swarm-findings/2026-05-01-fix-brand-colors-across-app/

- [x] (global) — modal:command-palette
- [ ] (global) — modal:workspace-create _(skipped: not url-controlled — see gate)_
- [x] / — base
- [x] /dashboard — base
- [x] /dashboard — modal:invite-user
- [ ] /dashboard — modal:filters _(skipped: not url-controlled — see gate)_
- [x] /invoices — base
- [x] /invoices — modal:bulk-actions
- [x] /invoices/[id] — base
- [x] /invoices/[id] — modal:line-item-editor
- [x] /invoices/[id] — modal:send-confirmation
- [x] /settings — tab:profile
- [x] /settings — tab:billing
- [x] /settings — tab:team

## Task: Audit mobile overflow — 2026-04-22

Mode: playwright. Findings: docs/superpowers/swarm-findings/2026-04-22-audit-mobile-overflow/

- [x] (global) — modal:command-palette
- [ ] (global) — modal:workspace-create _(skipped: not url-controlled — see gate)_
- [x] / — base
- [x] /dashboard — base
- [ ] /dashboard — modal:invite-user _(failed: see findings)_
- [x] /invoices — base
- [x] /invoices — modal:bulk-actions
- [x] /invoices/[id] — base
- [x] /invoices/[id] — modal:line-item-editor
- [x] /invoices/[id] — modal:send-confirmation
- [x] /settings — tab:profile
- [x] /settings — tab:billing
- [x] /settings — tab:team
