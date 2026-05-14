# /invoices/[id] findings — Fix brand colors across app

## State: base

- file: src/app/invoices/[id]/page.tsx, lines 12-18
  issue: heading uses hardcoded `#2563eb` instead of brand-blue token
  proposed: replace inline style with className `text-brand-blue`
  RESOLVED: edited 2026-05-01 by main-agent (shared file fix)

- file: src/features/invoices/InvoiceHeader.tsx, lines 44-50
  issue: status pill uses hardcoded `#10b981`
  proposed: replace with className `bg-brand-green text-brand-green-foreground`
  RESOLVED: edited 2026-05-01 by main-agent (shared file fix)

## State: modal:line-item-editor

- file: src/features/invoices/LineItemEditorDialog.tsx, lines 22-28
  issue: save button uses hardcoded `#2563eb`
  proposed: replace with className `bg-brand-blue text-brand-blue-foreground`
  RESOLVED: edited 2026-05-01 by leaf-wave-agent-3

## State: modal:send-confirmation

- file: src/features/invoices/SendConfirmationDialog.tsx, lines 31-35
  issue: cancel link uses hardcoded `#6b7280` (gray-500)
  proposed: replace with className `text-muted-foreground`
  RESOLVED: edited 2026-05-01 by leaf-wave-agent-3

## Failures

(none)
