import { ADMIN_CUSTOMER_SORT_FIELDS } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { searchCondition, sortClause } from "./customers.admin.service.js";

/**
 * The SQL fragments the directory is built from. Their behaviour is covered against a real
 * database in `customers.admin.int.test.ts`; these pin the two properties a database cannot show
 * reliably: that every sort ends with the id (PostgreSQL happens to return ties in a stable order,
 * so a missing tie-break passes a black-box test), and that what was typed is a bound parameter.
 */

describe("sortClause", () => {
  it.each(ADMIN_CUSTOMER_SORT_FIELDS)(
    "ends the %s sort with the id, in either direction",
    (sort) => {
      for (const order of ["asc", "desc"] as const) {
        expect(sortClause(sort, order).sql.trim(), `${sort} ${order}`).toMatch(/, cp\.id ASC$/);
      }
    },
  );

  it("sorts names without regard to case", () => {
    expect(sortClause("name", "asc").sql).toContain("LOWER(u.name) ASC");
    expect(sortClause("name", "desc").sql).toContain("LOWER(u.name) DESC");
  });

  it("takes the direction from two literals, never from the caller's text", () => {
    const clause = sortClause("createdAt", "desc");
    expect(clause.values).toEqual([]);
    expect(clause.sql).toContain("cp.created_at DESC");
  });
});

describe("searchCondition", () => {
  it("matches everything when there is no search, with nothing bound", () => {
    const condition = searchCondition(undefined);
    expect(condition.sql.trim()).toBe("TRUE");
    expect(condition.values).toEqual([]);
  });

  it("binds a name search as a parameter and never writes it into the SQL", () => {
    const text = "x'); DROP TABLE users; --";
    const condition = searchCondition(text);

    expect(condition.sql).not.toContain("DROP");
    expect(condition.sql).not.toContain(text);
    expect(condition.values).toEqual([`%${text}%`, `%${text}%`]);
    expect(condition.sql).toContain("u.name ILIKE");
    expect(condition.sql).toContain("u.email ILIKE");
    expect(condition.sql).not.toContain("regexp_replace");
  });

  it("escapes the pattern characters of the text it binds", () => {
    expect(searchCondition("100%_").values[0]).toBe("%100\\%\\_%");
  });

  it("adds the phone comparison, on the digits alone, only to a search that looks like a phone number", () => {
    const phone = searchCondition("(212) 555");
    expect(phone.sql).toContain("regexp_replace(COALESCE(cp.phone, ''), '[^0-9]', '', 'g') LIKE");
    expect(phone.values).toEqual(["%(212) 555%", "%(212) 555%", "%212555%"]);

    expect(searchCondition("alex").sql).not.toContain("cp.phone");
    expect(searchCondition("21").sql).not.toContain("cp.phone");
  });
});
