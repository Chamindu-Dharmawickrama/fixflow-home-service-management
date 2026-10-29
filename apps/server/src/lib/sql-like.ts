/**
 * Escapes the characters that mean something in a SQL `LIKE` pattern (`%`, `_` and the escape
 * character `\`), so text typed into a search box matches itself. Prisma's `contains` passes the
 * text to `LIKE`/`ILIKE` as it is, so without this a search for `%` would match every row and `_`
 * any single character. The value is always sent as a bound parameter; this is about meaning, not
 * injection.
 */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}
