"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { type Control, useFieldArray, useFormState } from "react-hook-form";

import { FieldGroup } from "@/components/forms/field";
import { getFieldId } from "@/components/forms/field-id";
import { FormField } from "@/components/forms/form-field";
import {
  EMPTY_LINE,
  type LineItemFormValue,
  MAX_LINES,
  MIN_LINES,
  NO_LINE_TOTAL,
} from "@/components/forms/line-items";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { MoneyText } from "@/components/ui/money-text";
import { cn } from "@/lib/utils";

/**
 * The three layouts of a row, chosen by the width of the editor itself and not of the screen (a
 * container query): the editor sits beside a sidebar and a totals column on a desktop, so the
 * screen's width says little about the room a row has.
 *
 * - under `@lg` (32 rem): a card, one field per line, labels above the fields;
 * - `@lg` up to `@linetable` (46 rem): a card of two rows: the description across the top, and below it the
 *   quantity, price, taxable box, total and buttons;
 * - `@linetable` up: one table row under a header, labels hidden (the header names the columns).
 */
const ROW_GRID_TWO_ROWS =
  "@lg:grid @lg:grid-cols-[6rem_8rem_5rem_minmax(0,1fr)_auto] @lg:items-end @lg:gap-x-3";
const ROW_GRID_TABLE =
  "@linetable:grid-cols-[minmax(12rem,1fr)_4.5rem_6.5rem_4rem_6.5rem_7.25rem] @linetable:items-start";

/** A form that holds line items under `lines`. The editor takes its `control`. */
export interface LineItemsFormShape {
  lines: LineItemFormValue[];
}

export interface LineItemsEditorProps<TForm extends LineItemsFormShape> {
  control: Control<TForm>;
  /** ISO 4217, from the document: it labels the unit price and formats the line totals. */
  currencyCode: string;
  /** Each row's own total from the shared calculation, or `undefined` while its numbers are unusable. */
  lineTotals: readonly (string | undefined)[];
  disabled?: boolean | undefined;
  /** Heading of the group. */
  legend?: ReactNode;
  description?: string | undefined;
}

/**
 * The rows of a quotation or an invoice (FR-041, UX-QB-QUO): description, quantity, unit price, a
 * taxable box and the row's total, with add, remove and move up or down. Wide enough, the rows line
 * up as a table; narrower, each row is a card with its own labelled fields, so nothing scrolls
 * sideways. Every control is a real field, reachable by keyboard; the buttons name the line they act
 * on ("Move line 2 up"). Errors appear beside the field they belong to (`lines.2.quantity`), and the
 * total of each row is the shared calculation's, never arithmetic done here.
 *
 * It reads and writes `lines` of the form it is given; the form's other fields are not its business.
 */
export function LineItemsEditor<TForm extends LineItemsFormShape>({
  control: formControl,
  currencyCode,
  lineTotals,
  disabled,
  legend = "Line items",
  description = "What the customer is paying for, one line each. Tick Taxable for the lines tax applies to.",
}: LineItemsEditorProps<TForm>) {
  // `TForm` only has to contain `lines`; the field array and its paths are typed for exactly that.
  const control = formControl as unknown as Control<LineItemsFormShape>;
  const { fields, append, remove, move } = useFieldArray({ control, name: "lines" });
  const { errors } = useFormState({ control, name: "lines" });
  const addButton = useRef<HTMLButtonElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const listError = errors.lines?.root?.message ?? errors.lines?.message;

  const announce = (text: string) => {
    setAnnouncement(text);
  };

  return (
    <FieldGroup
      id={getFieldId("lines")}
      legend={legend}
      description={description}
      error={listError}
    >
      {() => (
        <div className="@container flex flex-col gap-3">
          {/* Column headings: only where the rows are a table. Each control still has its own label. */}
          <div
            aria-hidden="true"
            className={cn(
              "hidden text-xs font-semibold text-ink-secondary",
              "@linetable:grid @linetable:gap-x-3 @linetable:border-b @linetable:border-border-strong @linetable:pb-2",
              ROW_GRID_TABLE,
            )}
          >
            <span>Description</span>
            <span className="text-right">Quantity</span>
            <span className="text-right">Unit price ({currencyCode})</span>
            <span>Taxable</span>
            <span className="text-right">Line total</span>
            <span />
          </div>

          <ul className="flex flex-col gap-3">
            {fields.map((row, index) => {
              const number = index + 1;
              const total = lineTotals[index];
              return (
                <li key={row.id}>
                  <div
                    role="group"
                    aria-label={`Line ${number}`}
                    className={cn(
                      "flex flex-col gap-3 rounded-xl border border-border bg-surface p-3",
                      ROW_GRID_TWO_ROWS,
                      "@linetable:gap-x-3 @linetable:rounded-none @linetable:border-0 @linetable:bg-transparent @linetable:p-0",
                      ROW_GRID_TABLE,
                    )}
                  >
                    <FormField
                      control={control}
                      name={`lines.${index}.description`}
                      label={<span className="@linetable:sr-only">Description</span>}
                      className="min-w-0 @lg:col-span-5 @linetable:col-span-1 @linetable:gap-0"
                    >
                      {(field) => (
                        <Input
                          {...field}
                          autoComplete="off"
                          maxLength={200}
                          disabled={disabled}
                          placeholder="For example: Replace capacitor"
                        />
                      )}
                    </FormField>

                    <div className="grid grid-cols-2 gap-3 @lg:contents">
                      <FormField
                        control={control}
                        name={`lines.${index}.quantity`}
                        label={<span className="@linetable:sr-only">Quantity</span>}
                        className="@linetable:gap-0"
                      >
                        {(field) => (
                          <Input
                            {...field}
                            inputMode="decimal"
                            autoComplete="off"
                            disabled={disabled}
                            className="text-right tabular-nums"
                          />
                        )}
                      </FormField>
                      <FormField
                        control={control}
                        name={`lines.${index}.unitPrice`}
                        label={
                          <span className="@linetable:sr-only">Unit price ({currencyCode})</span>
                        }
                        className="@linetable:gap-0"
                      >
                        {(field) => (
                          <Input
                            {...field}
                            inputMode="decimal"
                            autoComplete="off"
                            disabled={disabled}
                            placeholder="0.00"
                            className="text-right tabular-nums"
                          />
                        )}
                      </FormField>
                    </div>

                    <div className="flex items-center justify-between gap-3 @lg:contents">
                      <FormField
                        control={control}
                        name={`lines.${index}.taxable`}
                        label={<span className="@linetable:sr-only">Taxable</span>}
                        className="@linetable:gap-0"
                      >
                        {(field) => (
                          <div className="flex h-10 items-center">
                            <Checkbox
                              id={field.id}
                              name={field.name}
                              ref={field.ref}
                              checked={field.value}
                              onCheckedChange={(checked) => {
                                field.onChange(checked === true);
                              }}
                              onBlur={field.onBlur}
                              disabled={disabled}
                              aria-invalid={field["aria-invalid"]}
                              aria-describedby={field["aria-describedby"]}
                            />
                          </div>
                        )}
                      </FormField>

                      <p className="flex items-baseline gap-2 @lg:flex-col @lg:items-end @lg:gap-1.5 @linetable:h-10 @linetable:justify-center">
                        <span className="text-sm font-medium text-ink @linetable:sr-only">
                          Line total
                        </span>
                        <span className="@lg:flex @lg:h-10 @lg:items-center @linetable:h-auto">
                          {total === undefined ? (
                            <span
                              className="text-base font-medium text-ink-muted"
                              aria-label="Line total not available yet"
                            >
                              {NO_LINE_TOTAL}
                            </span>
                          ) : (
                            <MoneyText
                              amount={total}
                              currencyCode={currencyCode}
                              className="text-base font-semibold text-ink"
                            />
                          )}
                        </span>
                      </p>
                    </div>

                    <div className="flex items-center justify-end gap-1 border-t border-border pt-2 @lg:h-10 @lg:border-0 @lg:pt-0">
                      <IconButton
                        label={`Move line ${number} up`}
                        icon={ArrowUp}
                        size="sm"
                        disabled={disabled || index === 0}
                        onClick={() => {
                          move(index, index - 1);
                          announce(`Line ${number} moved up to position ${number - 1}.`);
                        }}
                      />
                      <IconButton
                        label={`Move line ${number} down`}
                        icon={ArrowDown}
                        size="sm"
                        disabled={disabled || index === fields.length - 1}
                        onClick={() => {
                          move(index, index + 1);
                          announce(`Line ${number} moved down to position ${number + 1}.`);
                        }}
                      />
                      <IconButton
                        label={`Remove line ${number}`}
                        icon={X}
                        size="sm"
                        disabled={disabled || fields.length <= MIN_LINES}
                        onClick={() => {
                          remove(index);
                          announce(`Line ${number} removed.`);
                          // The removed row's button is gone; keep keyboard focus somewhere stable.
                          addButton.current?.focus();
                        }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              ref={addButton}
              variant="outline"
              size="sm"
              disabled={disabled || fields.length >= MAX_LINES}
              onClick={() => {
                append({ ...EMPTY_LINE }, { shouldFocus: true });
                announce(`Line ${fields.length + 1} added.`);
              }}
            >
              <Plus aria-hidden="true" />
              Add line
            </Button>
            <span className="text-sm text-ink-secondary">
              {fields.length} of {MAX_LINES} lines
            </span>
          </div>

          <p role="status" className="sr-only">
            {announcement}
          </p>
        </div>
      )}
    </FieldGroup>
  );
}
