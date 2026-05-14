# Worked example: multi-modal file migration

This is what a typical file migration looks like. The file has three modals: a boolean create dialog, an ID-carrying edit dialog, and an object-as-carrier delete dialog.

## Catalog entries (input)

```
### /work/invoices
- [ ] modal:invoices-record-payment (url: none) — NOT url-controlled
- [ ] modal:invoices-receipt-email-draft (url: none) — NOT url-controlled
- [ ] modal:invoices-preview-sheet (url: none) — NOT url-controlled
```

Source file: `src/features/invoices/invoices-components/invoices-hub-dashboard.tsx`

## Before

```tsx
"use client";
import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { ReceiptEmailDraftDialog } from "./receipt-email-draft-dialog";
import { InvoicePreviewSheet } from "./invoice-preview-sheet";

export function InvoicesHubDashboard({ invoices }: Props) {
  const [recordPaymentInvoiceId, setRecordPaymentInvoiceId] = useState<string | null>(null);
  const [receiptEmailInvoiceId, setReceiptEmailInvoiceId] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  return (
    <div>
      {/* table that calls these setters */}

      <Dialog
        open={recordPaymentInvoiceId !== null}
        onOpenChange={(next) => { if (!next) setRecordPaymentInvoiceId(null); }}
      >
        {recordPaymentInvoiceId && <RecordPaymentDialog invoiceId={recordPaymentInvoiceId} />}
      </Dialog>

      <Dialog
        open={receiptEmailInvoiceId !== null}
        onOpenChange={(next) => { if (!next) setReceiptEmailInvoiceId(null); }}
      >
        {receiptEmailInvoiceId && <ReceiptEmailDraftDialog invoiceId={receiptEmailInvoiceId} />}
      </Dialog>

      <Sheet open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <SheetContent>
          <InvoicePreviewSheet />
        </SheetContent>
      </Sheet>
    </div>
  );
}
```

## After

```tsx
"use client";
import { useQueryState, parseAsBoolean } from "nuqs";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { ReceiptEmailDraftDialog } from "./receipt-email-draft-dialog";
import { InvoicePreviewSheet } from "./invoice-preview-sheet";

export function InvoicesHubDashboard({ invoices }: Props) {
  const [recordPaymentInvoiceId, setRecordPaymentInvoiceId] = useQueryState(
    "invoices-record-payment",
    { history: "replace" }
  );
  const [receiptEmailInvoiceId, setReceiptEmailInvoiceId] = useQueryState(
    "invoices-receipt-email-draft",
    { history: "replace" }
  );
  const [isPreviewOpen, setIsPreviewOpen] = useQueryState(
    "invoices-preview-sheet",
    parseAsBoolean.withDefault(false).withOptions({ history: "replace" })
  );

  return (
    <div>
      {/* table that calls these setters — unchanged */}

      <Dialog
        open={recordPaymentInvoiceId !== null}
        onOpenChange={(next) => { if (!next) setRecordPaymentInvoiceId(null); }}
      >
        {recordPaymentInvoiceId && <RecordPaymentDialog invoiceId={recordPaymentInvoiceId} />}
      </Dialog>

      <Dialog
        open={receiptEmailInvoiceId !== null}
        onOpenChange={(next) => { if (!next) setReceiptEmailInvoiceId(null); }}
      >
        {receiptEmailInvoiceId && <ReceiptEmailDraftDialog invoiceId={receiptEmailInvoiceId} />}
      </Dialog>

      <Sheet open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <SheetContent>
          <InvoicePreviewSheet />
        </SheetContent>
      </Sheet>
    </div>
  );
}
```

## Diff highlights

- `useState` import removed (no remaining uses).
- `useQueryState`, `parseAsBoolean` imported from `nuqs`.
- Three `useState` lines replaced with three `useQueryState` calls — local variable names preserved.
- All JSX unchanged. Setters still called with the same shape (`setX(null)` to close, `setX("id_123")` to open).
- Booleans get `parseAsBoolean.withDefault(false)`; ID-carrying ones get the no-parser default.

## Catalog after migration

```
### /work/invoices
- [x] modal:invoices-record-payment (url: ?invoices-record-payment=<id>) — url-controlled
- [x] modal:invoices-receipt-email-draft (url: ?invoices-receipt-email-draft=<id>) — url-controlled
- [x] modal:invoices-preview-sheet (url: ?invoices-preview-sheet=1) — url-controlled
```

(The skill's Phase 4 makes this catalog edit, not the file-migration agent.)

## Commit message

```
refactor(invoices): URL-control modal state in invoices-hub-dashboard via nuqs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
