# Modal detection rules

This reference is loaded by `app-coverage-swarm` during Phase 2 (modal discovery). It defines what counts as a modal, how to find them, and how to classify URL-control.

## What counts as a modal

A modal is any UI surface that overlays the page and represents a distinct user state. We classify modals into two pattern families:

### Family A — Radix/shadcn/vaul primitives

The JSX element name matches one of these **top-level wrappers** (NOT their sub-parts like `Content`, `Header`, `Trigger`, `Title`, `Description`, `Footer`, `Close`, `Cancel`, `Action`, `Overlay`, `Portal`):

- `Dialog`
- `Sheet`
- `Drawer`, `DrawerPrimitive.Root` (vaul)
- `AlertDialog`
- `CommandDialog` (the dialog form of Command — bare `Command` inline is a popover-class element)
- `Popover` — only if its `PopoverContent` contains a form input (`input`, `textarea`, `select`, or any `Form*` component). Tooltip-class popovers (text + button) are excluded.

Detection: ripgrep with sub-element exclusion. Use a regex like `<(Dialog|Sheet|Drawer|AlertDialog|CommandDialog|DrawerPrimitive\.Root)\b(?!Content|Header|Title|Description|Footer|Trigger|Close|Cancel|Action|Overlay|Portal)` or grep first then filter sub-element matches in post-processing. Each modal counts ONCE per render site, regardless of how many `*Content`/`*Header`/etc. children it has.

`Collapsible`, `Accordion`, `Tabs`, and `DropdownMenu` are NOT modals — they're in-page panels or menus. Skip them.

### Family B — Convention-named components

A component identifier matching `/.*(Modal|Dialog|Sheet|Drawer)$/` that is **rendered as JSX**, not just imported. Detection: ripgrep for `<\w+(Modal|Dialog|Sheet|Drawer)\b`, then exclude matches that are actually sub-elements (e.g. `<MyFooDialogContent>`, `<MyFooDialogTrigger>`) — only the top-level component identifier counts.

A component imported but never rendered does not count.

## Reachable files for a route

Starting from a route's `page.tsx` (and `layout.tsx` if present in the same directory), follow imports up to 3 levels deep into any file under `src/`. A file is scanned at most once per reconciliation regardless of how many routes reach it. Track visited files in a Set during the walk.

External imports (`node_modules`, absolute imports of design-system packages) are not followed.

Layouts higher in the route tree (e.g. `app/layout.tsx`, `app/(group)/layout.tsx`) are scanned once and their detected modals are attributed to every descendant route.

## URL-control classification

For each detected modal, find the JSX element that controls its `open` state. The control source is one of:

- A prop bound to a value (`<Dialog open={isOpen}>`)
- A boolean expression involving `searchParams`, `useSearchParams`, `useParams`, `usePathname`, or a route-segment match
- A boolean expression involving `useState`, `useReducer`, `useRef`, React Context, or a client store hook (matching `/use\w+(Store|State)$/`)

Classification:

- **url-controlled** — the open expression depends transitively on `useSearchParams()`, a `searchParams` prop, `useParams()`, `usePathname()`, or a route-segment branch. Examples:

  ```tsx
  const params = useSearchParams();
  const open = params.get("modal") === "invite";
  return <Dialog open={open}>...</Dialog>;
  ```

  ```tsx
  // Server component
  export default function Page({ searchParams }: { searchParams: { edit?: string } }) {
    return <Dialog open={!!searchParams.edit}>...</Dialog>;
  }
  ```

- **NOT url-controlled** — the open expression is owned by `useState`, Context, or a client store. Examples:

  ```tsx
  const [open, setOpen] = useState(false);
  return <Dialog open={open}>...</Dialog>;
  ```

  ```tsx
  const { isOpen } = useUIStore();
  return <Sheet open={isOpen}>...</Sheet>;
  ```

When ambiguous (mixed sources, dynamic routing through a hook with unclear lineage), classify as **NOT url-controlled**. The gate is conservative: a false negative breaks coverage silently; a false positive only costs the user one manual override.

## Stable name derivation

Pick the most specific source available, in this order:

1. **Rendered child component** — if the modal's JSX is a Family B component (`<InviteUserDialog>`, `<FiltersSheet>`), use that identifier kebab-cased with the suffix stripped: `InviteUserDialog` → `invite-user`, `FiltersSheet` → `filters`.
2. **Owning state variable** — if the modal is a bare `<Dialog>` controlled inline by a `useState`, use the state variable kebab-cased: `editingTransaction` → `transaction-edit`, `pendingDeleteReportId` → `delete-report`. Drop noise prefixes like `is`, `has`, `pending`, and trailing `Open`/`Id`.
3. **Surrounding feature/component** — if neither above is available, use the parent component's identifier kebab-cased and suffix-stripped.

For features that own multiple modals in one file (e.g. a transactions page with edit/attach/associate dialogs), the state-variable rule produces meaningful names by design.

If two different modals on the same route would still derive to the same name after these rules, append a counter: `filters`, `filters-2`.

## URL contract notation

The catalog records each modal's URL contract:

- Search-param contract: `?modal=invite-user` or `?edit=<lineItemId>`
- Path-segment contract: `/settings/profile`
- No contract: `none` (only valid when classification is NOT url-controlled)

When inferring the contract for url-controlled modals, look at what the open expression compares against. If the expression is `params.get("modal") === "invite"`, the contract is `?modal=invite`.

## Manual overrides

Users may edit the catalog to append `— url-controlled (manual override)` to any modal line. Subsequent runs of the skill must respect this and skip re-classifying that modal. Detect overrides by parsing for the literal string `(manual override)` on the modal's line.

## Edge cases

- **Conditional render gate**: `{open && <Dialog ... />}` — the open expression is the gate. Apply the same classification rules.
- **Compound primitives**: `<Sheet><SheetContent>...</SheetContent></Sheet>` — count once. The outer element holds the open prop.
- **Always-rendered with hidden state**: a modal that's always in the DOM but visually hidden via `data-state="closed"` still has an open source — find it.
- **Modals defined in a hook**: e.g. `const { open, dialog } = useConfirmDialog()`. Classify by the hook's internal state source if visible; otherwise treat as NOT url-controlled.
- **Modals in shared layouts** (e.g. a global `CommandPalette` in `app/layout.tsx`): record ONCE in a dedicated `## Global modals` section in the catalog, NOT per-route. The gate counts each global modal once total. See SKILL.md Phase 2 for the catalog format.
- **Same component rendered at multiple sites with different open sources**: a component like `<AddEventSourceDialog>` may be controlled by URL on one route and by `useState` on another. Classify per render site. The stable name is shared across sites; the URL-control classification can differ between (route, state) entries in the catalog.
- **Route handlers (`route.ts`) without `page.{tsx,ts,jsx,js}`**: not pages — exclude from the route enumeration entirely.

## Walk direction

The reachable-file rule is logical, not procedural. You can implement it top-down (start from each `page.tsx`, follow imports) or bottom-up (find all modal-bearing files, attribute each to the routes whose import chain reaches them). Both produce the same result; pick whichever is faster for the codebase. The "scan a file at most once" rule still applies.
