import { PDFParse } from "pdf-parse";
import type { Response, Test } from "supertest";

/**
 * Reading a PDF back in a test (a dev-only dependency, `pdf-parse`): the text a reader would extract,
 * and the page count. Nothing in the application imports this.
 */

export interface PdfContent {
  /** The text of every page, as extracted. Whitespace is the reader's; compare with {@link flat}. */
  text: string;
  pages: number;
}

export async function readPdf(buffer: Buffer): Promise<PdfContent> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return { text: result.text, pages: result.pages.length };
  } finally {
    await parser.destroy();
  }
}

/** Collapses whitespace so an assertion does not depend on how the reader breaks lines. */
export const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The text of a PDF with its whitespace collapsed. */
export async function printedText(buffer: Buffer): Promise<string> {
  return flat((await readPdf(buffer)).text);
}

/**
 * Asks Supertest to give the body of a PDF response as a `Buffer` (`response.body`). Any other
 * response, an error for instance, is read as JSON as usual, so `expectApiError` still works.
 */
export function asBinary(test: Test): Test {
  return test.buffer(true).parse((response, callback) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.on("end", () => {
      const body = Buffer.concat(chunks);
      const type = String(response.headers["content-type"] ?? "");
      if (/pdf/.test(type)) {
        callback(null, body);
        return;
      }
      try {
        callback(null, body.length === 0 ? {} : (JSON.parse(body.toString("utf8")) as unknown));
      } catch {
        callback(null, body.toString("utf8"));
      }
    });
  });
}

/** The bytes of a binary response read with {@link asBinary}. */
export function bytesOf(response: Response): Buffer {
  return response.body as Buffer;
}

export interface RenderedPage {
  /** PNG bytes of the page. */
  png: Buffer;
  /** The page's size in points (1/72 in), as the PDF declares it. */
  widthPoints: number;
  heightPoints: number;
}

/**
 * Draws each page of a PDF as a picture, for a person to look at and for pixel checks (where the ink
 * is). `scale` 2 gives 144 dpi. A dev-only helper, like the rest of this file.
 */
export async function renderPdfPages(buffer: Buffer, scale = 2): Promise<RenderedPage[]> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getScreenshot({ scale });
    return result.pages.map((page) => ({
      png: Buffer.from(page.data),
      widthPoints: page.width / scale,
      heightPoints: page.height / scale,
    }));
  } finally {
    await parser.destroy();
  }
}
