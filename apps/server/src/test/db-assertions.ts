import { expect } from "vitest";

/** PostgreSQL SQLSTATE codes the invariant tests care about. */
export const SqlState = {
  /** A NOT NULL column received null. */
  NOT_NULL_VIOLATION: "23502",
  /** A row cannot be removed because other rows still reference it (`ON DELETE RESTRICT`). */
  RESTRICT_VIOLATION: "23001",
  /** A foreign key points at a row that does not exist. */
  FOREIGN_KEY_VIOLATION: "23503",
  /** A unique constraint or unique index was violated. */
  UNIQUE_VIOLATION: "23505",
  /** A CHECK constraint was violated. */
  CHECK_VIOLATION: "23514",
} as const;
export type SqlState = (typeof SqlState)[keyof typeof SqlState];

interface DriverCause {
  originalCode?: string;
  originalMessage?: string;
}

/** Pulls the PostgreSQL error out of the error Prisma's driver adapter throws. */
function driverCause(error: unknown): DriverCause | undefined {
  const meta = (error as { meta?: { driverAdapterError?: { cause?: DriverCause } } }).meta;
  return meta?.driverAdapterError?.cause;
}

/**
 * Runs `action` and asserts that the **database** rejected it with the given SQLSTATE and, when
 * given, the named constraint or index. Naming the constraint matters: it proves the row was
 * refused for the intended reason and not by some other rule (a missing column, a typo in the test).
 * Works for Prisma client calls and raw SQL alike.
 */
export async function expectDbRejection(
  action: () => PromiseLike<unknown>,
  expected: { sqlState: SqlState; constraint: string | readonly string[] },
): Promise<void> {
  // PostgreSQL checks CHECK constraints in alphabetical order, so when one input breaks several
  // rules, the first by name is reported. A test may list every rule that legitimately applies.
  const accepted =
    typeof expected.constraint === "string" ? [expected.constraint] : expected.constraint;

  let thrown: unknown;
  try {
    await action();
  } catch (error) {
    thrown = error;
  }

  expect(
    thrown,
    `the database accepted a row that violates "${accepted.join('" or "')}"`,
  ).toBeDefined();
  const cause = driverCause(thrown);
  expect(
    cause,
    `expected a PostgreSQL error but got: ${String((thrown as Error | undefined)?.message)}`,
  ).toBeDefined();
  expect(cause?.originalCode).toBe(expected.sqlState);
  expect(
    accepted.some((name) => cause?.originalMessage?.includes(`"${name}"`)),
    `expected a violation of "${accepted.join('" or "')}" but got: ${cause?.originalMessage}`,
  ).toBe(true);
}
