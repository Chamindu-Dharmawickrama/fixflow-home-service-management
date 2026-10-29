"use client";

import { ChevronDown, Copy, Info, Pencil, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmDialogProps } from "@/components/ui/confirm-dialog";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { LinkTabs } from "@/components/ui/link-tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/sonner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { Section, Specimen } from "../_lib/section";

type ConfirmKind = "send" | "void" | "failing";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const CONFIRMS: Record<ConfirmKind, Omit<ConfirmDialogProps, "open" | "onOpenChange">> = {
  send: {
    title: "Send quotation to Morgan Reyes?",
    consequence: (
      <p>
        QT-2026-00042 for $360.18 will appear in Morgan&apos;s portal and be emailed to them. A sent
        quotation can&apos;t be edited; if something changes you can replace it with a new one.
      </p>
    ),
    confirmLabel: "Send quotation",
    onConfirm: () => wait(700),
  },
  void: {
    title: "Void invoice INV-2026-00007?",
    consequence: (
      <p>
        The invoice stays in the history marked <strong>Void</strong> with your reason, and the
        customer is told it was withdrawn. It can&apos;t be reopened; issue a new invoice if one is
        still due.
      </p>
    ),
    confirmLabel: "Void invoice",
    destructive: true,
    reason: {
      label: "Reason for voiding",
      minLength: 10,
      description: "Shown in the history. The customer sees it too.",
      placeholder: "For example: issued to the wrong address",
    },
    onConfirm: () => wait(700),
  },
  failing: {
    title: "Cancel this job?",
    consequence: (
      <p>
        The appointment is released and the customer is notified. This example always fails, to show
        the error state.
      </p>
    ),
    confirmLabel: "Cancel job",
    cancelLabel: "Keep job",
    destructive: true,
    onConfirm: async () => {
      await wait(700);
      throw new Error(
        "The job was changed by someone else. Reload the page to see its current status, then try again.",
      );
    },
  },
};

function DialogExample() {
  const noteId = useId();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Open dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an internal note</DialogTitle>
          <DialogDescription>
            Only the business sees internal notes. Customers never do.
          </DialogDescription>
        </DialogHeader>
        <Field id={noteId} label="Note" required>
          {(control) => (
            <Textarea
              maxLength={500}
              showCount
              placeholder="What should the next person know?"
              {...control}
            />
          )}
        </Field>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button>Add note</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OverlaysSection() {
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>("send");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const openConfirm = (kind: ConfirmKind) => {
    setConfirmKind(kind);
    setConfirmOpen(true);
  };

  return (
    <Section
      id="overlays"
      title="Dialogs, drawers, menus and toasts"
      description="Focus moves into an overlay when it opens, stays inside while it is open, and returns to the control that opened it. Escape closes every overlay except a confirmation that is waiting for the server."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen title="Dialog and drawer">
          <div className="flex flex-wrap items-center gap-3">
            <DialogExample />
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Open detail drawer</Button>
              </SheetTrigger>
              <SheetContent side="right" showCloseButton aria-describedby="drawer-description">
                <SheetHeader className="p-5 pr-14">
                  <SheetTitle>JOB-2026-00031</SheetTitle>
                  <SheetDescription id="drawer-description">
                    AC Routine Maintenance · Morgan Reyes
                  </SheetDescription>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto px-5">
                  <DescriptionList>
                    <DescriptionItem term="Status">
                      <StatusBadge kind="workOrder" status="SCHEDULED" />
                    </DescriptionItem>
                    <DescriptionItem term="When">Wed, Oct 29 · 9:00 – 11:00 AM</DescriptionItem>
                    <DescriptionItem term="Technician">Jordan Lee</DescriptionItem>
                    <DescriptionItem term="Address">48 Maple Court, Harbor City</DescriptionItem>
                  </DescriptionList>
                </div>
                <div className="border-t border-border p-5">
                  <SheetClose asChild>
                    <Button variant="outline" className="w-full">
                      Close
                    </Button>
                  </SheetClose>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </Specimen>

        <Specimen title="Confirmation dialogs">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => openConfirm("send")}>Confirm an action</Button>
            <Button variant="destructive" onClick={() => openConfirm("void")}>
              Destructive, with a reason
            </Button>
            <Button variant="outline" onClick={() => openConfirm("failing")}>
              Action that fails
            </Button>
          </div>
          <ConfirmDialog
            {...CONFIRMS[confirmKind]}
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
          />
        </Specimen>

        <Specimen title="Menu, popover and tooltip">
          <div className="flex flex-wrap items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  Actions
                  <ChevronDown aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Quotation QT-2026-00042</DropdownMenuLabel>
                <DropdownMenuItem>
                  <Pencil aria-hidden="true" />
                  Edit draft
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Copy aria-hidden="true" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive>
                  <Trash2 aria-hidden="true" />
                  Void quotation
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">
                  <Info aria-hidden="true" />
                  How is tax calculated?
                </Button>
              </PopoverTrigger>
              <PopoverContent>
                <p className="font-medium text-ink">Tax is added per line</p>
                <p className="mt-1 text-ink-secondary">
                  The business rate is applied to each line after any discount, then rounded to the
                  cent.
                </p>
              </PopoverContent>
            </Popover>
            <IconButton label="Copy reference" icon={Copy} variant="outline" />
          </div>
        </Specimen>

        <Specimen title="Toasts (examples; a real toast appears only after the server confirms)">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() =>
                toast.success("Example: quotation sent", {
                  description: "Say what happened and what happens next.",
                })
              }
            >
              Success
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast.error("Example: couldn't record the payment", {
                  description: "The balance changed. Reload the invoice and try again.",
                })
              }
            >
              Error
            </Button>
            <Button
              variant="outline"
              onClick={() => toast.info("Example: 2 requests are waiting for review")}
            >
              Info
            </Button>
          </div>
        </Specimen>
      </div>

      <Specimen title="Tabs (the strip scrolls sideways on narrow screens)">
        <Tabs defaultValue="requests">
          <TabsList aria-label="Customer history">
            <TabsTrigger value="requests">Requests</TabsTrigger>
            <TabsTrigger value="quotations">Quotations</TabsTrigger>
            <TabsTrigger value="jobs">Jobs</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
          </TabsList>
          <TabsContent value="requests">
            <p className="text-sm text-ink-secondary">
              3 requests, the latest FF-2026-00125 (Under review).
            </p>
          </TabsContent>
          <TabsContent value="quotations">
            <p className="text-sm text-ink-secondary">
              1 quotation, QT-2026-00042 (Sent), valid until Nov 11, 2026.
            </p>
          </TabsContent>
          <TabsContent value="jobs">
            <p className="text-sm text-ink-secondary">
              No jobs yet. A job is created when a quotation is accepted.
            </p>
          </TabsContent>
          <TabsContent value="invoices">
            <p className="text-sm text-ink-secondary">No invoices yet.</p>
          </TabsContent>
        </Tabs>
      </Specimen>

      <Specimen title="Link tabs (filters that live in the URL; the current one has aria-current)">
        <LinkTabs
          label="Filter services by status"
          items={[
            { label: "All", href: "#link-tabs-all", count: 5, current: false },
            { label: "Published", href: "#link-tabs-published", count: 4, current: true },
            { label: "Unpublished", href: "#link-tabs-unpublished", count: 1, current: false },
            { label: "Archived", href: "#link-tabs-archived", count: 0, current: false },
          ]}
        />
      </Specimen>
    </Section>
  );
}
