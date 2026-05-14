# Migration recipes

Loaded by `url-state-migration` during Phase 2. Each dispatched agent reads this and `nuqs-patterns.md` before editing.

A recipe matches a state pattern in the source file and prescribes the exact transformation. Agents must use these recipes verbatim. If no recipe matches, report DONE_WITH_CONCERNS for that modal and move on.

## Recipe 1 — Boolean useState

**Match:** state declared as `const [<flagVar>, set<FlagVar>] = useState(false)` (or `useState<boolean>(false)`), and `<flagVar>` is the only prop bound to a modal's `open`.

**Before:**

```tsx
const [isCreateOpen, setIsCreateOpen] = useState(false);
// ...
return <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>...</Dialog>;
```

**After:**

```tsx
import { useQueryState, parseAsBoolean } from "nuqs";
// ...
const [isCreateOpen, setIsCreateOpen] = useQueryState(
  "<param-name>",
  parseAsBoolean.withDefault(false).withOptions({ history: "replace" })
);
// ...
return <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>...</Dialog>;
```

Notes:
- Preserve the local variable names (`isCreateOpen`, `setIsCreateOpen`) so other usages in the file keep working.
- Add the import; merge with any existing `from "nuqs"` import.
- Remove `useState` from the React import if it was only used for this hook (check the rest of the file first).
- `<param-name>` = catalog stable name verbatim.

## Recipe 2 — ID-carrying useState (string | null)

**Match:** state declared as `const [<idVar>, set<IdVar>] = useState<string | null>(null)` (or `useState<Id | undefined>(undefined)`), and the modal's `open` prop is bound to a derived expression like `<idVar> !== null` or `!!<idVar>`.

**Before:**

```tsx
const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
// ...
return (
  <Dialog
    open={editingTransactionId !== null}
    onOpenChange={(next) => { if (!next) setEditingTransactionId(null); }}
  >
    {editingTransactionId && <Editor id={editingTransactionId} />}
  </Dialog>
);
```

**After:**

```tsx
import { useQueryState } from "nuqs";
// ...
const [editingTransactionId, setEditingTransactionId] = useQueryState("<param-name>", {
  history: "replace",
});
// ...
return (
  <Dialog
    open={editingTransactionId !== null}
    onOpenChange={(next) => { if (!next) setEditingTransactionId(null); }}
  >
    {editingTransactionId && <Editor id={editingTransactionId} />}
  </Dialog>
);
```

Notes:
- nuqs returns `string | null`; the existing `!== null` check still works.
- Callers that did `setEditingTransactionId("tx_123")` continue to work — nuqs accepts the same call shape.
- Existing `setEditingTransactionId(null)` calls work for closing.
- If the original used `undefined` instead of `null`, normalize all reads/writes to `null` (nuqs convention) — change `=== undefined` checks to `=== null` and `setX(undefined)` to `setX(null)`.

## Recipe 3 — Object-as-carrier useState (open with full row)

**Match:** state declared as `const [<targetVar>, set<TargetVar>] = useState<<Type> | null>(null)` where `<Type>` is an object (e.g. a row record), and the modal's `open` prop is bound to `<targetVar> !== null`.

**Before:**

```tsx
const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
// ...
return (
  <AlertDialog
    open={removeTarget !== null}
    onOpenChange={(next) => { if (!next) setRemoveTarget(null); }}
  >
    {removeTarget && <RemoveBody member={removeTarget} />}
  </AlertDialog>
);
```

**After:**

```tsx
import { useQueryState } from "nuqs";
// ...
const [removeTargetId, setRemoveTargetId] = useQueryState("<param-name>", {
  history: "replace",
});
const removeTarget = removeTargetId
  ? members.find((m) => m.id === removeTargetId) ?? null
  : null;
// ...
return (
  <AlertDialog
    open={removeTargetId !== null}
    onOpenChange={(next) => { if (!next) setRemoveTargetId(null); }}
  >
    {removeTarget && <RemoveBody member={removeTarget} />}
  </AlertDialog>
);
```

Notes:
- The carrier becomes the ID; the object is reconstructed from existing data.
- The agent must verify the object's array (`members` here) is in scope at the use site. If not, this recipe does NOT apply — report DONE_WITH_CONCERNS for the modal.
- All call sites that did `setRemoveTarget(member)` must change to `setRemoveTargetId(member.id)`. The agent searches the file for these and updates them.
- Renames the variable from `removeTarget` to `removeTargetId` for the URL state, and reconstructs the object as `removeTarget` (now derived). This keeps downstream JSX (`<RemoveBody member={removeTarget} />`) working.
- If the data array isn't queryable by ID (e.g. it's not loaded at this level), do NOT apply this recipe — this is the explicit DONE_WITH_CONCERNS case.

## Recipe 4 — Context/Provider state

**Match:** state read from a Context (`const { isOpen, setIsOpen } = useUIContext()`), where the Context is purely a UI-state holder for one or two modals.

**Action:** SKIP. Report DONE_WITH_CONCERNS for the modal with note: "Context-driven state — migration requires changes to the Context provider, which may have other consumers. Manual review needed."

This is deliberately conservative. Migrating Context modals well requires changes outside the modal's file, which violates the file-ownership boundary.

## Recipe 5 — Client store (Zustand/Jotai)

**Match:** state read from a hook matching `/use\w+(Store|State)$/` that's not React's `useState`.

**Action:** SKIP. Report DONE_WITH_CONCERNS for the modal with note: "Client-store-driven state — migration requires changes to the store, which has unknown other consumers. Manual review needed."

## Recipe 6 — useReducer

**Match:** state managed via `useReducer`.

**Action:** SKIP. Report DONE_WITH_CONCERNS with note: "useReducer-driven state — non-trivial migration requiring reducer rework. Manual review needed."

## Cleanup steps (apply after every successful recipe)

1. If `useState` is no longer imported anywhere in the file, remove it from the React import.
2. Sort imports per the project's lint rules (`pnpm lint --fix` handles this; do not hand-sort).
3. Remove any `useEffect` that existed solely to sync the migrated state with a URL or to log it.
4. Do NOT touch unrelated state — only the migrated modal's lines.
