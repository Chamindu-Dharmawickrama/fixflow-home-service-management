import { escapeHtml } from "./email.domain.js";

/**
 * A fragment of HTML that is already safe to place in a document. Only this module and `raw()`
 * create one, so a plain `string` can never end up in a template unescaped by accident.
 */
export class SafeHtml {
  constructor(readonly value: string) {}

  toString(): string {
    return this.value;
  }
}

/** Marks markup you wrote yourself (never text from a person or the database) as safe. */
export function raw(markup: string): SafeHtml {
  return new SafeHtml(markup);
}

function render(value: unknown): string {
  if (value instanceof SafeHtml) {
    return value.value;
  }
  if (value === undefined || value === null || value === false) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map(render).join("");
  }
  if (typeof value === "string" || typeof value === "number") {
    return escapeHtml(String(value));
  }
  // Anything else would print "[object Object]" into an email; fail loudly in development instead.
  throw new TypeError(`Cannot place a ${typeof value} in an email template.`);
}

/**
 * Tagged template for email HTML. **Every interpolated value is HTML-escaped** unless it is a
 * `SafeHtml` fragment (nested output of this same tag, or `raw()`), so `markup\`<p>${name}</p>\``
 * is safe whatever `name` contains, in element content and in quoted attribute values alike.
 * `undefined`, `null` and `false` render as nothing (for `${cond && markup\`…\`}`); arrays are
 * joined. Link targets also go through `httpUrl()`, because escaping does not stop a
 * `javascript:` URL.
 *
 * The tag is deliberately not called `html`: Prettier re-indents and re-wraps the contents of a
 * template tagged `html`, which would make the generated markup depend on the formatter.
 */
export function markup(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let output = strings[0] ?? "";
  values.forEach((value, index) => {
    output += render(value) + (strings[index + 1] ?? "");
  });
  return new SafeHtml(output);
}

// Whitespace and control characters never belong in a link; a browser would strip some of them.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const URL_UNSAFE = /[\x00-\x20\x7f-\x9f]/;

/**
 * Returns the link unchanged if it is an absolute `http(s)` URL, and throws otherwise. Use it on
 * every `href`: HTML escaping keeps a value inside its attribute but does not stop `javascript:`.
 */
export function httpUrl(value: string): string {
  if (!/^https?:\/\//i.test(value) || URL_UNSAFE.test(value) || !URL.canParse(value)) {
    throw new TypeError("An email link must be an absolute http(s) URL without spaces.");
  }
  return value;
}
