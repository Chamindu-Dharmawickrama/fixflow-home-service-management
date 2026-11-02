import { describe, expect, it } from "vitest";

import {
  adminTechnicianPath,
  dayTileLines,
  deactivateConsequence,
  deactivatedMessage,
  DEFAULT_ACTIVE_FILTER,
  describeDay,
  firstNameOf,
  formatBookedTime,
  hasActiveSearch,
  inactiveJobsSentence,
  keepMeridiemTogether,
  parseTechniciansQuery,
  TECHNICIANS_PATH,
  techniciansSortHref,
  techniciansTabHref,
  toTechniciansApiQueryString,
} from "./technicians";

describe("paths", () => {
  it("keys a technician's page by id, escaped", () => {
    expect(TECHNICIANS_PATH).toBe("/app/technicians");
    expect(adminTechnicianPath("0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11")).toBe(
      "/app/technicians/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    );
    expect(adminTechnicianPath("a/b?c")).toBe("/app/technicians/a%2Fb%3Fc");
  });
});

describe("parseTechniciansQuery", () => {
  it("starts on the active tab, A to Z, page 1, with no search", () => {
    expect(parseTechniciansQuery({})).toEqual({
      q: undefined,
      active: "true",
      order: "asc",
      page: 1,
    });
    expect(DEFAULT_ACTIVE_FILTER).toBe("true");
  });

  it("reads the tab, order, search and page from the address", () => {
    expect(
      parseTechniciansQuery({ active: "false", order: "desc", q: "heat pumps", page: "3" }),
    ).toEqual({ q: "heat pumps", active: "false", order: "desc", page: 3 });
    expect(parseTechniciansQuery({ active: "all" }).active).toBe("all");
  });

  it("falls back to the defaults for anything it cannot use, instead of failing the page", () => {
    expect(parseTechniciansQuery({ active: "maybe", order: "sideways", page: "-4" })).toMatchObject(
      { active: "true", order: "asc", page: 1 },
    );
    expect(parseTechniciansQuery({ page: "0" }).page).toBe(1);
    expect(parseTechniciansQuery({ page: "2.5" }).page).toBe(1);
    expect(parseTechniciansQuery({ page: "1e3" }).page).toBe(1);
  });

  it("tidies the search: trimmed, one space between words, at most 100 characters, blank is none", () => {
    expect(parseTechniciansQuery({ q: "  jordan    lee " }).q).toBe("jordan lee");
    expect(parseTechniciansQuery({ q: "   " }).q).toBeUndefined();
    expect(parseTechniciansQuery({ q: "x".repeat(150) }).q).toHaveLength(100);
  });

  it("uses the first value when a parameter is repeated", () => {
    expect(parseTechniciansQuery({ active: ["false", "all"], q: ["a", "b"] })).toMatchObject({
      active: "false",
      q: "a",
    });
  });

  it("caps an absurd page number at the most the API allows", () => {
    expect(parseTechniciansQuery({ page: "99999999999" }).page).toBe(100_000);
  });
});

describe("toTechniciansApiQueryString", () => {
  it("always names the tab, the page, the size and the sort, and adds the search when there is one", () => {
    const query = parseTechniciansQuery({});
    expect(toTechniciansApiQueryString(query)).toBe(
      "active=true&page=1&pageSize=20&sort=name&order=asc",
    );
    expect(
      toTechniciansApiQueryString({
        ...query,
        q: "heat & pumps",
        active: "all",
        order: "desc",
        page: 2,
      }),
    ).toBe("active=all&page=2&pageSize=20&sort=name&order=desc&q=heat+%26+pumps");
  });
});

describe("hasActiveSearch", () => {
  it("is true only when there is a search", () => {
    expect(hasActiveSearch(parseTechniciansQuery({}))).toBe(false);
    expect(hasActiveSearch(parseTechniciansQuery({ q: "  " }))).toBe(false);
    expect(hasActiveSearch(parseTechniciansQuery({ q: "jordan" }))).toBe(true);
  });
});

describe("tab and sort links", () => {
  it("gives the default tab a clean address and the others their filter", () => {
    expect(techniciansTabHref({}, "true")).toBe("/app/technicians");
    expect(techniciansTabHref({}, "false")).toBe("/app/technicians?active=false");
    expect(techniciansTabHref({}, "all")).toBe("/app/technicians?active=all");
  });

  it("keeps the search and drops the page when the tab changes", () => {
    expect(techniciansTabHref({ q: "heat", page: "3" }, "false")).toBe(
      "/app/technicians?q=heat&active=false",
    );
    expect(techniciansTabHref({ q: "heat", active: "false", page: "3" }, "true")).toBe(
      "/app/technicians?q=heat",
    );
  });

  it("flips the order when the name header is pressed, keeping the rest", () => {
    expect(techniciansSortHref({}, parseTechniciansQuery({}))).toBe("/app/technicians?order=desc");
    expect(
      techniciansSortHref(
        { order: "desc", q: "a", active: "all", page: "2" },
        parseTechniciansQuery({ order: "desc", q: "a", active: "all", page: "2" }),
      ),
    ).toBe("/app/technicians?q=a&active=all&order=asc");
  });
});

describe("words", () => {
  it("says what happens to an inactive technician's jobs, with the verb agreeing with the count", () => {
    expect(inactiveJobsSentence(0)).toBe("They have no upcoming jobs.");
    expect(inactiveJobsSentence(1)).toBe("1 upcoming job stays assigned until you reassign it.");
    expect(inactiveJobsSentence(3)).toBe("3 upcoming jobs stay assigned until you reassign them.");
  });

  it("takes the first word of a name", () => {
    expect(firstNameOf("Jordan Lee")).toBe("Jordan");
    expect(firstNameOf("  Sam   Okafor ")).toBe("Sam");
    expect(firstNameOf("Cher")).toBe("Cher");
  });

  describe("deactivateConsequence (FR-060)", () => {
    it("says what the prompt says for several jobs, word for word", () => {
      expect(deactivateConsequence("Jordan Lee", 3)).toBe(
        "Jordan Lee has 3 upcoming jobs. They stay assigned; you can reassign them from each job. Jordan won't be available for new assignments.",
      );
    });

    it("uses the singular for one job", () => {
      expect(deactivateConsequence("Jordan Lee", 1)).toBe(
        "Jordan Lee has 1 upcoming job. It stays assigned; you can reassign it from the job. Jordan won't be available for new assignments.",
      );
    });

    it("has nothing to say about jobs when there are none", () => {
      expect(deactivateConsequence("Jordan Lee", 0)).toBe(
        "Jordan Lee has no upcoming jobs. Jordan won't be available for new assignments.",
      );
    });
  });

  describe("deactivatedMessage", () => {
    it("reports the jobs that stayed, as the server counted them", () => {
      expect(deactivatedMessage("Jordan Lee", 0)).toBe("Jordan won't be offered for new jobs.");
      expect(deactivatedMessage("Jordan Lee", 1)).toBe(
        "1 upcoming job stays assigned. Reassign it from the job when you are ready.",
      );
      expect(deactivatedMessage("Jordan Lee", 4)).toBe(
        "4 upcoming jobs stay assigned. Reassign them from each job when you are ready.",
      );
    });
  });
});

describe("formatBookedTime", () => {
  it.each([
    [0, "Free"],
    [-5, "Free"],
    [1, "1 min"],
    [45, "45 min"],
    [60, "1 h"],
    [120, "2 h"],
    [150, "2 h 30 min"],
    [1380, "23 h"],
    [1500, "25 h"],
  ])("shows %i minutes as %j", (minutes, text) => {
    expect(formatBookedTime(minutes)).toBe(text);
  });
});

describe("describeDay and dayTileLines", () => {
  it("names the weekday and the date of a day on the business's calendar, as written", () => {
    expect(describeDay("2026-03-02")).toEqual({ weekday: "Mon", date: "Mar 2" });
    expect(describeDay("2026-03-08")).toEqual({ weekday: "Sun", date: "Mar 8" });
    expect(describeDay("2026-12-31")).toEqual({ weekday: "Thu", date: "Dec 31" });
    expect(describeDay("2028-02-29")).toEqual({ weekday: "Tue", date: "Feb 29" });
  });

  it("names the first tile Today and dates it, and gives every other the weekday then the date", () => {
    expect(dayTileLines({ date: "2026-03-02", scheduledMinutes: 0 }, 0)).toEqual({
      heading: "Today",
      date: "Mon Mar 2",
    });
    expect(dayTileLines({ date: "2026-03-03", scheduledMinutes: 0 }, 1)).toEqual({
      heading: "Tue",
      date: "Mar 3",
    });
  });
});

describe("keepMeridiemTogether", () => {
  const nbsp = String.fromCharCode(0xa0);

  it("joins each time to its AM or PM with a space that never breaks, and leaves the dash alone", () => {
    expect(keepMeridiemTogether("10:00 AM – 12:00 PM")).toBe(`10:00${nbsp}AM – 12:00${nbsp}PM`);
    expect(keepMeridiemTogether("8:03 – 10:03 AM")).toBe(`8:03 – 10:03${nbsp}AM`);
  });

  it("reads the same to a person, and leaves text without a time as it was", () => {
    expect(keepMeridiemTogether("10:00 AM").replace(nbsp, " ")).toBe("10:00 AM");
    expect(keepMeridiemTogether("Nov 3, 10:00 PM – Nov 4, 2:00 AM")).toBe(
      `Nov 3, 10:00${nbsp}PM – Nov 4, 2:00${nbsp}AM`,
    );
    expect(keepMeridiemTogether("Free")).toBe("Free");
  });
});
