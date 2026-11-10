import { readFileSync } from "node:fs";

import { isBundledLogoKey } from "@fixflow/shared";

/**
 * The fonts and logos the invoice PDF uses (D-28). Every one is a file shipped with the API
 * (`./assets`, copied to `dist` by the build): nothing is fetched from a remote address, so a
 * business that sets a logo web address cannot make the server request it (SSRF), and the document
 * looks the same offline. Inter is the web app's typeface (SIL Open Font License, `OFL-Inter.txt`).
 */

const ASSETS = new URL("./assets/", import.meta.url);

function read(path: string): Buffer {
  return readFileSync(new URL(path, ASSETS));
}

/** The Inter weights the document uses, read once and kept. */
export interface InvoicePdfFonts {
  regular: Buffer;
  semibold: Buffer;
  bold: Buffer;
}

let fonts: InvoicePdfFonts | undefined;

export function loadInvoicePdfFonts(): InvoicePdfFonts {
  fonts ??= {
    regular: read("fonts/Inter_400Regular.ttf"),
    semibold: read("fonts/Inter_600SemiBold.ttf"),
    bold: read("fonts/Inter_700Bold.ttf"),
  };
  return fonts;
}

const logos = new Map<string, string>();

/**
 * The SVG of a bundled logo, or `null` when the business has none: no key, a key this build does not
 * know, or a web address (which is deliberately ignored here). The key is checked against the shared
 * allowlist before it is used in a path, so it can never name another file.
 */
export function loadBundledLogoSvg(logoKey: string | null): string | null {
  if (!isBundledLogoKey(logoKey)) {
    return null;
  }
  let svg = logos.get(logoKey);
  if (svg === undefined) {
    svg = read(`logos/${logoKey}.svg`).toString("utf8");
    logos.set(logoKey, svg);
  }
  return svg;
}
