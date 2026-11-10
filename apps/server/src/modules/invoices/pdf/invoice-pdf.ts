import { formatTaxRate, InvoiceStatus } from "@fixflow/shared";
import pdfmake from "pdfmake";
import type { Content, TableCell } from "pdfmake/interfaces.js";

import { formatEmailDate, formatEmailMoney } from "../../email/email.format.js";
import { loadBundledLogoSvg, loadInvoicePdfFonts } from "./invoice-pdf.assets.js";
import type { InvoicePdfSnapshot } from "./invoice-pdf.types.js";

/**
 * The invoice as a PDF (FR-072, spec §10.3 "Invoice", §15.4, §18.4, D-28), built in-process from a
 * persisted snapshot by `pdfmake`: no headless browser, so it stays within a small server's memory.
 *
 * - **Page.** 8.27 in × 11 in (595 × 792 pt): as wide as A4 and as tall as Letter, so the content of
 *   either paper fits whichever way the PDF is printed, with 40 pt side margins and a 56 pt bottom
 *   margin that holds the page number.
 * - **Plain text.** pdfmake draws every string as text; nothing a customer, a note or a line
 *   description says is read as markup. Control characters are removed and a very long unbroken word
 *   is allowed to break, so it cannot run past the margin.
 * - **No outside requests.** Fonts and logos are bundled files, and the URL and file policies refuse
 *   everything else, so a document can never make the server fetch an address.
 */

// ---- The look (the design tokens of the web app, as literal values) ---------------------------------

const COLOR = {
  ink: "#0f1b22",
  muted: "#4a5a64",
  border: "#c9d1d6",
  brand: "#14505e",
  success: "#1b7646",
  danger: "#b42318",
  surface: "#eef1f0",
} as const;

export const INVOICE_PDF_PAGE = { width: 595, height: 792 } as const;
const MARGIN = { left: 40, right: 40, top: 38, bottom: 52 } as const;
const CONTENT_WIDTH = INVOICE_PDF_PAGE.width - MARGIN.left - MARGIN.right;
const TOTALS_WIDTH = 250;

/** A word longer than this may be broken anywhere, so a 200-character token stays inside its cell. */
const LONGEST_UNBROKEN_RUN = 24;
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const LONG_RUN = new RegExp(`[^\\s${ZERO_WIDTH_SPACE}]{${LONGEST_UNBROKEN_RUN + 1},}`, "g");

/** Tab, line feed and carriage return are text; every other control character is not. */
function isPrintable(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0x20 && code !== 0x7f);
}

/** Text exactly as written, safe to print: no control characters, and long runs able to wrap. */
export function plain(text: string): string {
  return Array.from(text)
    .filter(isPrintable)
    .join("")
    .replace(
      LONG_RUN,
      (run) =>
        run.match(new RegExp(`.{1,${LONGEST_UNBROKEN_RUN}}`, "gu"))?.join(ZERO_WIDTH_SPACE) ?? run,
    );
}

// ---- pdfmake, configured once ------------------------------------------------------------------------

let configured = false;

function configure(): void {
  if (configured) {
    return;
  }
  const fonts = loadInvoicePdfFonts();
  pdfmake.setFonts({
    Inter: {
      normal: fonts.regular,
      bold: fonts.bold,
      italics: fonts.regular,
      bolditalics: fonts.bold,
    },
    InterSemi: {
      normal: fonts.semibold,
      bold: fonts.bold,
      italics: fonts.semibold,
      bolditalics: fonts.bold,
    },
  });
  // Nothing outside the bundled assets is ever read or fetched while a document is built.
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy(() => false);
  configured = true;
}

// ---- Wording and figures -----------------------------------------------------------------------------

function money(amount: string, currencyCode: string): string {
  return formatEmailMoney(amount, currencyCode);
}

function isZero(amount: string): boolean {
  return !/[1-9]/.test(amount);
}

function day(value: string | null): string {
  return value === null ? "" : formatEmailDate(value);
}

function addressLines(address: {
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
}): string[] {
  const cityLine = [address.city, [address.region, address.postalCode].filter(Boolean).join(" ")]
    .filter((part) => part !== "")
    .join(", ");
  return [address.line1, address.line2 ?? "", cityLine].filter((line) => line !== "").map(plain);
}

function statusColor(status: InvoiceStatus): string {
  switch (status) {
    case InvoiceStatus.PAID:
      return COLOR.success;
    case InvoiceStatus.OVERDUE:
    case InvoiceStatus.VOID:
      return COLOR.danger;
    case InvoiceStatus.DRAFT:
      return COLOR.muted;
    default:
      return COLOR.brand;
  }
}

function overdueSentence(days: number): string {
  return days === 1 ? "Overdue by 1 day" : `Overdue by ${days} days`;
}

/** The title of the file's metadata and the page footer. */
export function invoicePdfLabel(snapshot: Pick<InvoicePdfSnapshot, "invoiceNumber">): string {
  return snapshot.invoiceNumber ?? "Draft invoice";
}

// ---- The blocks of the page --------------------------------------------------------------------------

const rule = (width = CONTENT_WIDTH, y = 0): Content => ({
  canvas: [
    { type: "line", x1: 0, y1: y, x2: width, y2: y, lineWidth: 0.75, lineColor: COLOR.border },
  ],
});

const heading = (text: string): Content => ({
  text: text.toUpperCase(),
  style: "label",
  margin: [0, 0, 0, 3],
});

function header(snapshot: InvoicePdfSnapshot): Content {
  const { business } = snapshot;
  const logo = loadBundledLogoSvg(business.logoKey);
  const contact = [business.phone, business.email].filter((line) => line !== "").map(plain);

  const businessStack: Content[] = [
    { text: plain(business.name), font: "InterSemi", fontSize: 14, margin: [0, 0, 0, 2] },
    ...(business.tagline === null || business.tagline === ""
      ? []
      : [
          {
            text: plain(business.tagline),
            color: COLOR.muted,
            fontSize: 8.5,
            margin: [0, 0, 0, 4],
          } as Content,
        ]),
    {
      text: [...addressLines(business.address), ...contact].join("\n"),
      color: COLOR.muted,
      fontSize: 8.5,
    },
  ];

  const left: Content =
    logo === null
      ? ({ stack: businessStack, width: "*" } as Content)
      : ({
          columns: [
            { svg: logo, width: 34, height: 34 },
            { stack: businessStack, width: "*" },
          ],
          columnGap: 10,
          width: "*",
        } as Content);

  const dates: Content[] = [
    ...(snapshot.issueDate === null
      ? []
      : [{ text: `Issued ${day(snapshot.issueDate)}`, color: COLOR.muted } as Content]),
    ...(snapshot.dueDate === null
      ? []
      : [{ text: `Due ${day(snapshot.dueDate)}`, font: "InterSemi" } as Content]),
  ];

  return {
    columns: [
      left,
      {
        width: 190,
        alignment: "right",
        stack: [
          { text: "INVOICE", style: "label", alignment: "right" },
          {
            text: plain(snapshot.invoiceNumber ?? "Not numbered yet"),
            font: "InterSemi",
            fontSize: 18,
            alignment: "right",
            margin: [0, 1, 0, 2],
          },
          {
            text: snapshot.statusLabel,
            font: "InterSemi",
            color: statusColor(snapshot.status),
            alignment: "right",
            margin: [0, 0, 0, 2],
          },
          ...dates,
          ...(snapshot.status === InvoiceStatus.OVERDUE
            ? [
                {
                  text: overdueSentence(snapshot.daysOverdue),
                  font: "InterSemi",
                  color: COLOR.danger,
                  margin: [0, 2, 0, 0],
                } as Content,
              ]
            : []),
        ],
      },
    ],
    columnGap: 20,
    margin: [0, 0, 0, 10],
  };
}

function parties(snapshot: InvoicePdfSnapshot): Content {
  const { customer } = snapshot;
  return {
    stack: [
      rule(),
      {
        columns: [
          {
            width: "*",
            stack: [
              heading("Billed to"),
              { text: plain(customer.name), font: "InterSemi", fontSize: 10.5 },
              {
                text: [...addressLines(customer.address), plain(customer.email)].join("\n"),
                color: COLOR.muted,
                fontSize: 8.5,
              },
            ],
          },
          {
            width: "*",
            stack: [
              heading("Service"),
              { text: plain(snapshot.serviceName), font: "InterSemi", fontSize: 10.5 },
              {
                text: `For job ${plain(snapshot.jobReference)}\nRequest ${plain(snapshot.requestReference)}`,
                color: COLOR.muted,
                fontSize: 8.5,
              },
            ],
          },
        ],
        columnGap: 20,
        margin: [0, 8, 0, 8],
      },
      rule(),
    ],
    margin: [0, 0, 0, 10],
  };
}

function linesTable(snapshot: InvoicePdfSnapshot): Content {
  const { currencyCode } = snapshot;
  const showTax =
    snapshot.lines.some((line) => !line.taxable) && snapshot.lines.some((line) => line.taxable);
  const head = (text: string, right = false): TableCell => ({
    text,
    style: "label",
    alignment: right ? "right" : "left",
  });
  const body: TableCell[][] = [
    [
      head("Description"),
      head("Qty", true),
      head("Unit price", true),
      ...(showTax ? [head("Tax")] : []),
      head("Amount", true),
    ],
    ...snapshot.lines.map((line): TableCell[] => [
      { text: plain(line.description) },
      { text: line.quantity, alignment: "right", fontFeatures: ["tnum"] },
      { text: money(line.unitPrice, currencyCode), alignment: "right", fontFeatures: ["tnum"] },
      ...(showTax
        ? [
            {
              text: line.taxable ? "Taxed" : "No tax",
              color: COLOR.muted,
              fontSize: 8,
            } as TableCell,
          ]
        : []),
      {
        text: money(line.lineTotal, currencyCode),
        alignment: "right",
        fontFeatures: ["tnum"],
        font: "InterSemi",
      },
    ]),
  ];
  const widths: (number | string)[] = ["*", 40, 74, ...(showTax ? [42] : []), 78];

  return {
    table: { headerRows: 1, dontBreakRows: true, keepWithHeaderRows: 1, widths, body },
    layout: {
      hLineWidth: (index, node) =>
        index === 0 || index === node.table.body.length ? 0.75 : index === 1 ? 0.75 : 0.4,
      vLineWidth: () => 0,
      hLineColor: () => COLOR.border,
      paddingLeft: (index) => (index === 0 ? 0 : 6),
      paddingRight: (index, node) => (index === (node.table.widths?.length ?? 1) - 1 ? 0 : 6),
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
    margin: [0, 0, 0, 8],
  };
}

function totalsBlock(snapshot: InvoicePdfSnapshot): Content {
  const { currencyCode } = snapshot;
  const row = (label: string, amount: string, options: { strong?: boolean } = {}): TableCell[] => [
    {
      text: label,
      font: options.strong ? "InterSemi" : "Inter",
      color: options.strong ? COLOR.ink : COLOR.muted,
    },
    {
      text: money(amount, currencyCode),
      alignment: "right",
      fontFeatures: ["tnum"],
      font: options.strong ? "InterSemi" : "Inter",
    },
  ];

  const body: TableCell[][] = [row("Subtotal", snapshot.subtotal)];
  if (!isZero(snapshot.discountAmount)) {
    body.push(row("Discount", `-${snapshot.discountAmount}`));
  }
  body.push(
    row(`Tax (${formatTaxRate(snapshot.taxRate)}%)`, snapshot.taxAmount),
    row("Total", snapshot.totalAmount, { strong: true }),
    row(
      "Amount paid",
      isZero(snapshot.amountPaid) ? snapshot.amountPaid : `-${snapshot.amountPaid}`,
    ),
  );
  const balanceIndex = body.length;
  body.push([
    { text: "Balance due", font: "InterSemi", fontSize: 11, color: COLOR.ink },
    {
      text: money(snapshot.balanceDue, currencyCode),
      alignment: "right",
      font: "InterSemi",
      fontSize: 11,
      fontFeatures: ["tnum"],
    },
  ]);

  return {
    columns: [
      { text: "", width: "*" },
      {
        width: TOTALS_WIDTH,
        unbreakable: true,
        table: { widths: ["*", 100], body },
        layout: {
          hLineWidth: (index) => (index === balanceIndex ? 0.75 : 0),
          vLineWidth: () => 0,
          hLineColor: () => COLOR.ink,
          fillColor: (index) => (index === balanceIndex ? COLOR.surface : null),
          paddingLeft: (index) => (index === 0 ? 8 : 4),
          paddingRight: (index) => (index === 0 ? 4 : 8),
          paddingTop: (index) => (index === balanceIndex ? 6 : 2.5),
          paddingBottom: (index) => (index === balanceIndex ? 6 : 2.5),
        },
      },
    ],
    margin: [0, 0, 0, 10],
  };
}

function paymentsBlock(snapshot: InvoicePdfSnapshot): Content[] {
  if (snapshot.status === InvoiceStatus.DRAFT) {
    return [];
  }
  const { currencyCode } = snapshot;
  const title = heading("Payments received");
  if (snapshot.payments.length === 0) {
    return [
      {
        stack: [title, { text: "No payments have been recorded yet.", color: COLOR.muted }],
        margin: [0, 0, 0, 10],
        unbreakable: true,
      },
    ];
  }
  const head = (text: string, right = false): TableCell => ({
    text,
    style: "label",
    alignment: right ? "right" : "left",
  });
  return [
    {
      unbreakable: true,
      margin: [0, 0, 0, 10],
      stack: [
        title,
        {
          table: {
            headerRows: 1,
            widths: [90, "*", 90],
            body: [
              [head("Date"), head("Method"), head("Amount", true)],
              ...snapshot.payments.map((payment): TableCell[] => [
                { text: day(payment.paymentDate) },
                { text: payment.methodLabel },
                {
                  text: money(payment.amount, currencyCode),
                  alignment: "right",
                  fontFeatures: ["tnum"],
                },
              ]),
            ],
          },
          layout: {
            hLineWidth: (index) => (index === 1 ? 0.75 : 0.4),
            vLineWidth: () => 0,
            hLineColor: () => COLOR.border,
            paddingLeft: (index) => (index === 0 ? 0 : 6),
            paddingRight: (index) => (index === 2 ? 0 : 6),
            paddingTop: () => 3,
            paddingBottom: () => 3,
          },
        },
        ...(snapshot.status === InvoiceStatus.PAID && snapshot.paidOn !== null
          ? [
              {
                text: `Paid in full on ${day(snapshot.paidOn)}`,
                font: "InterSemi",
                color: COLOR.success,
                margin: [0, 6, 0, 0],
              } as Content,
            ]
          : []),
      ],
    },
  ];
}

function notesBlock(snapshot: InvoicePdfSnapshot): Content[] {
  const blocks: Content[] = [];
  if (snapshot.customerNote !== null && snapshot.customerNote !== "") {
    blocks.push({
      unbreakable: true,
      margin: [0, 0, 0, 10],
      stack: [
        { text: `Note from ${plain(snapshot.business.name)}`, font: "InterSemi" },
        { text: plain(snapshot.customerNote), color: COLOR.muted, margin: [0, 2, 0, 0] },
      ],
    });
  }
  // How to pay and the footer are one unit: when they do not fit under the totals they move to the next
  // page together, so a page never ends with a footer line on its own.
  const closing: Content[] = [];
  const canPay = snapshot.status !== InvoiceStatus.VOID;
  if (snapshot.paymentInstructions !== null && snapshot.paymentInstructions !== "" && canPay) {
    closing.push({
      margin: [0, 0, 0, 8],
      table: {
        widths: ["*"],
        body: [
          [
            {
              stack: [
                { text: "How to pay", font: "InterSemi", margin: [0, 0, 0, 2] },
                { text: plain(snapshot.paymentInstructions), color: COLOR.muted },
                ...(snapshot.invoiceNumber === null
                  ? []
                  : [
                      {
                        text: `Please quote ${plain(snapshot.invoiceNumber)} with your payment.`,
                        font: "InterSemi",
                        margin: [0, 4, 0, 0],
                      } as Content,
                    ]),
                {
                  text: `Payments are made directly to ${plain(snapshot.business.name)}; FixFlow doesn't process payments.`,
                  color: COLOR.muted,
                  fontSize: 8,
                  margin: [0, 4, 0, 0],
                },
              ],
            },
          ],
        ],
      },
      layout: {
        hLineWidth: () => 0.75,
        vLineWidth: () => 0.75,
        hLineColor: () => COLOR.border,
        vLineColor: () => COLOR.border,
        paddingLeft: () => 10,
        paddingRight: () => 10,
        paddingTop: () => 8,
        paddingBottom: () => 8,
      },
    });
  }
  if (snapshot.footer !== null && snapshot.footer !== "") {
    closing.push({
      stack: [
        rule(),
        {
          text: plain(snapshot.footer),
          alignment: "center",
          color: COLOR.muted,
          fontSize: 8,
          margin: [0, 6, 0, 0],
        },
      ],
    });
  }
  if (closing.length > 0) {
    blocks.push({ unbreakable: true, stack: closing });
  }
  return blocks;
}

function watermarkOf(status: InvoiceStatus) {
  if (status === InvoiceStatus.VOID) {
    return { text: "VOID", color: COLOR.danger, opacity: 0.14, bold: true, fontSize: 140 };
  }
  if (status === InvoiceStatus.DRAFT) {
    return { text: "DRAFT", color: COLOR.muted, opacity: 0.14, bold: true, fontSize: 120 };
  }
  return undefined;
}

// ---- The builder ---------------------------------------------------------------------------------------

/**
 * Builds the invoice PDF for a snapshot. Rejects only if the library itself fails; the caller turns
 * that into a safe `500`. A voided invoice carries a VOID watermark and a draft (an admin's preview) a
 * DRAFT one.
 */
export async function buildInvoicePdf(snapshot: InvoicePdfSnapshot): Promise<Buffer> {
  configure();
  const label = invoicePdfLabel(snapshot);
  const watermark = watermarkOf(snapshot.status);

  const pdf = pdfmake.createPdf({
    info: {
      title: `Invoice ${label}`,
      author: plain(snapshot.business.name),
      subject: `Invoice for ${plain(snapshot.serviceName)}`,
      creator: "FixFlow",
      producer: "FixFlow",
    },
    pageSize: INVOICE_PDF_PAGE,
    pageMargins: [MARGIN.left, MARGIN.top, MARGIN.right, MARGIN.bottom],
    defaultStyle: { font: "Inter", fontSize: 9.5, color: COLOR.ink, lineHeight: 1.2 },
    styles: {
      label: { fontSize: 7.5, bold: true, color: COLOR.muted, characterSpacing: 0.6 },
    },
    ...(watermark === undefined ? {} : { watermark }),
    footer: (currentPage: number, pageCount: number): Content => ({
      columns: [
        {
          text: `${plain(snapshot.business.name)} · ${plain(label)}`,
          color: COLOR.muted,
          fontSize: 8,
          width: "*",
        },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          color: COLOR.muted,
          fontSize: 8,
          alignment: "right",
          width: "auto",
        },
      ],
      margin: [MARGIN.left, 20, MARGIN.right, 0],
    }),
    content: [
      header(snapshot),
      parties(snapshot),
      linesTable(snapshot),
      totalsBlock(snapshot),
      ...paymentsBlock(snapshot),
      ...notesBlock(snapshot),
    ],
  });
  return pdf.getBuffer();
}
