"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Opens the browser's print dialog for the page. The page decides what prints: the application's
 * frame and the controls carry `print:hidden`, so a quotation or an invoice comes out as the document
 * alone (see the print rules in `globals.css`).
 */
export function PrintButton({
  children = "Print",
  className,
}: {
  children?: string;
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      className={cn("print:hidden", className)}
      onClick={() => {
        window.print();
      }}
    >
      <Printer aria-hidden="true" />
      {children}
    </Button>
  );
}
