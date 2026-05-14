# nuqs patterns

Loaded by `url-state-migration` during Phase 2 (pre-flight) so dispatched agents have the canonical patterns to apply.

This file documents the only nuqs shapes the migration produces. Agents that encounter a pattern not described here must report DONE_WITH_CONCERNS and skip the modal — they do not improvise.

## Boolean modal (open/closed only)

```tsx
import { useQueryState, parseAsBoolean } from "nuqs";

const [open, setOpen] = useQueryState(
  "<param-name>",
  parseAsBoolean.withDefault(false).withOptions({ history: "replace" })
);

return <Dialog open={open} onOpenChange={setOpen}>...</Dialog>;
```

URL contract: `?<param-name>=1` (open) or no param (closed).

`<param-name>` is the catalog's stable name verbatim, kebab-case. Example: catalog entry `modal:invite-user` → param `invite-user`.

## ID-carrying modal (open + which entity)

```tsx
import { useQueryState } from "nuqs";

const [<idVar>, set<IdVar>] = useQueryState("<param-name>", {
  history: "replace",
});
const open = <idVar> !== null;
const onOpenChange = (next: boolean) => set<IdVar>(next ? <idVar> : null);

return <Dialog open={open} onOpenChange={onOpenChange}>...</Dialog>;
```

URL contract: `?<param-name>=<id>` (open with that ID) or no param (closed).

The local variable name (`<idVar>`) is whatever the file already used (`editingTransactionId`, `removeTargetId`, etc.) — preserve it so callers downstream don't break. The `null` check converts presence into an open boolean.

If the existing code uses an object as the carrier (e.g. `useState<Transaction | null>`), migrate to storing the ID only and look up the object from existing data fetching where it's used. The agent must verify this is feasible by checking that the data is queryable by ID in the same render scope; if not, report DONE_WITH_CONCERNS.

## Imports

Two import shapes are valid:

```tsx
import { useQueryState, parseAsBoolean } from "nuqs";
```

If the file already imports from nuqs, extend the existing import. Do not create duplicate imports.

## history: "replace" is mandatory

Every migrated modal uses `history: "replace"`. Opening or closing a modal should not push back-button history entries. The agent never selects `push`; user can switch manually post-migration if they want a navigable modal.

## Default value

Boolean: `parseAsBoolean.withDefault(false)`. Always.

ID: no default — null means closed. Do not use `withDefault("")`.

## Provider

`nuqs` requires `<NuqsAdapter>` higher in the React tree. The migration agent must NOT add or modify the adapter. If `nuqs` calls fail at runtime due to a missing adapter, that's a project-wide setup issue surfaced during typecheck/lint. The skill assumes the adapter is already present (the project already uses `useQueryState` patterns in `/work/calendar`, so the adapter is in place).

## Server vs client components

`useQueryState` is client-only (it's a hook). The migration applies to client components — files with `"use client"` at the top, or files imported only from a client boundary.

If a Family A primitive lives in a server component and reads `searchParams` from props, that's already URL-controlled — the catalog should mark it so. If somehow such a modal is in the catalog as `NOT url-controlled`, the agent reports DONE_WITH_CONCERNS and skips it; this is a catalog error.

## Forbidden shapes

Do NOT produce any of these:

- `useQueryState` with `parseAsString` and `withDefault("")` — empty string is not the same as null and breaks the open check.
- Storing both an ID *and* an open boolean in two separate URL params for the same modal — derive open from ID presence.
- Bag-style `?modal=<name>` shared across modals — each modal gets its own param.
- `parseAsJson` / `parseAsArrayOf` — out of scope for v1.
- `history: "push"` — see above; mandatory replace.
