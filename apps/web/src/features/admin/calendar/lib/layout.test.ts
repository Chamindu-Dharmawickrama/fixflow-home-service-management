import { describe, expect, it } from "vitest";

import { at, BUSINESS_ZONE } from "../test-fixtures";
import {
  blockPosition,
  DEFAULT_VISIBLE_HOURS,
  hourCount,
  layoutColumns,
  MIN_BLOCK_MINUTES,
  segmentsOf,
  visibleHoursFor,
  visibleLineCount,
} from "./layout";

const seg = (visitId: string, startMin: number, endMin: number) => ({ visitId, startMin, endMin });

function one(start: string, end: string) {
  return segmentsOf({ id: "v", start, end }, BUSINESS_ZONE);
}

describe("segmentsOf: where a visit falls on the business's clocks", () => {
  it("puts a 10:00 to 12:00 visit at minutes 600 to 720 of its day", () => {
    expect(one(at("2026-03-03", "10:00"), at("2026-03-03", "12:00"))).toEqual([
      {
        visitId: "v",
        date: "2026-03-03",
        startMin: 600,
        endMin: 720,
        continuesFromPrevious: false,
        continuesIntoNext: false,
      },
    ]);
  });

  it("reads the instant on the business's clocks, not on this machine's", () => {
    // 15:00Z is 10:00 in New York in winter and 11:00 in summer; the machine running the test is irrelevant.
    expect(one("2026-03-03T15:00:00.000Z", "2026-03-03T17:00:00.000Z")[0]?.startMin).toBe(600);
    expect(one("2026-07-07T15:00:00.000Z", "2026-07-07T17:00:00.000Z")[0]?.startMin).toBe(660);
  });

  it("puts a 21:00 visit on the day it is on the business's clocks, though it is the next day in UTC", () => {
    const [segment] = one("2026-03-04T02:00:00.000Z", "2026-03-04T03:00:00.000Z");
    expect(segment?.date).toBe("2026-03-03");
    expect(segment?.startMin).toBe(21 * 60);
  });

  it("clips a visit that crosses midnight into one block per day", () => {
    const segments = one(at("2026-03-03", "23:00"), at("2026-03-04", "01:30"));
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      date: "2026-03-03",
      startMin: 1380,
      endMin: 1440,
      continuesFromPrevious: false,
      continuesIntoNext: true,
    });
    expect(segments[1]).toMatchObject({
      date: "2026-03-04",
      startMin: 0,
      endMin: 90,
      continuesFromPrevious: true,
      continuesIntoNext: false,
    });
  });

  it("does not make an empty block on the next day for a visit that ends at midnight", () => {
    const segments = one(at("2026-03-03", "22:00"), at("2026-03-04", "00:00"));
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ date: "2026-03-03", startMin: 1320, endMin: 1440 });
    expect(segments[0]?.continuesIntoNext).toBe(false);
  });

  it("draws a very short visit at the shortest block height", () => {
    const [segment] = one(at("2026-03-03", "10:00"), at("2026-03-03", "10:10"));
    expect(segment?.endMin).toBe(600 + MIN_BLOCK_MINUTES);
    const [none] = one(at("2026-03-03", "10:00"), at("2026-03-03", "10:00"));
    expect(none?.endMin).toBe(600 + MIN_BLOCK_MINUTES);
  });

  it("keeps a block inside its day when the shortest height would pass midnight", () => {
    const [segment] = one(at("2026-03-03", "23:50"), at("2026-03-04", "00:00"));
    expect(segment?.endMin).toBe(1440);
  });

  it("draws a visit whose end is before its start as the shortest block", () => {
    const [segment] = one(at("2026-03-03", "10:00"), at("2026-03-03", "09:00"));
    expect(segment).toMatchObject({ date: "2026-03-03", startMin: 600, endMin: 630 });
  });

  describe("in the week the clocks go forward (8 March 2026, 02:00 becomes 03:00)", () => {
    it("reads the wall clock after the change: 08:00Z is 04:00 EDT", () => {
      const [segment] = one("2026-03-08T08:00:00.000Z", "2026-03-08T10:00:00.000Z");
      expect(segment).toMatchObject({ date: "2026-03-08", startMin: 240, endMin: 360 });
    });

    it("reads the wall clock before the change: 06:00Z is 01:00 EST", () => {
      const [segment] = one("2026-03-08T06:00:00.000Z", "2026-03-08T06:30:00.000Z");
      expect(segment).toMatchObject({ startMin: 60, endMin: 90 });
    });

    it("draws a visit across the change by the wall clock its two ends read", () => {
      // 01:30 EST to 04:30 EDT: two real hours, three hours on the grid.
      const [segment] = one("2026-03-08T06:30:00.000Z", "2026-03-08T08:30:00.000Z");
      expect(segment).toMatchObject({ startMin: 90, endMin: 270 });
    });

    it("keeps the same wall hour for a visit at 10:00 before and after the change", () => {
      expect(one(at("2026-03-07", "10:00"), at("2026-03-07", "11:00"))[0]?.startMin).toBe(600);
      expect(one(at("2026-03-09", "10:00"), at("2026-03-09", "11:00"))[0]?.startMin).toBe(600);
      // In UTC the same wall hour is an hour apart: this is what the test is about.
      expect(at("2026-03-07", "10:00")).toBe("2026-03-07T15:00:00.000Z");
      expect(at("2026-03-09", "10:00")).toBe("2026-03-09T14:00:00.000Z");
    });
  });

  describe("in the week the clocks go back (1 November 2026, 02:00 becomes 01:00)", () => {
    it("keeps the same wall hour for a visit at 10:00 before and after the change", () => {
      expect(one(at("2026-10-31", "10:00"), at("2026-10-31", "11:00"))[0]?.startMin).toBe(600);
      expect(one(at("2026-11-02", "10:00"), at("2026-11-02", "11:00"))[0]?.startMin).toBe(600);
      expect(at("2026-10-31", "10:00")).toBe("2026-10-31T14:00:00.000Z");
      expect(at("2026-11-02", "10:00")).toBe("2026-11-02T15:00:00.000Z");
    });

    it("uses the real length of a visit whose end reads earlier than its start", () => {
      // 01:30 EDT (05:30Z) to 01:30 EST (06:30Z): both read 01:30, an hour apart.
      const [segment] = one("2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z");
      expect(segment).toMatchObject({ startMin: 90, endMin: 150 });
    });
  });
});

describe("visibleHoursFor", () => {
  it("shows 07:00 to 20:00 when everything falls inside", () => {
    expect(visibleHoursFor([])).toEqual({ startHour: 7, endHour: 20 });
    expect(visibleHoursFor([seg("a", 600, 720)])).toEqual(DEFAULT_VISIBLE_HOURS);
    expect(visibleHoursFor([seg("a", 7 * 60, 20 * 60)])).toEqual({ startHour: 7, endHour: 20 });
  });

  it("starts earlier for an early visit, to the whole hour", () => {
    expect(visibleHoursFor([seg("a", 5 * 60 + 30, 7 * 60)])).toEqual({ startHour: 5, endHour: 20 });
    expect(visibleHoursFor([seg("a", 0, 60)])).toEqual({ startHour: 0, endHour: 20 });
  });

  it("ends later for a late visit, rounding the end up to the next hour", () => {
    expect(visibleHoursFor([seg("a", 19 * 60, 20 * 60 + 1)])).toEqual({
      startHour: 7,
      endHour: 21,
    });
    expect(visibleHoursFor([seg("a", 21 * 60, 1440)])).toEqual({ startHour: 7, endHour: 24 });
  });

  it("widens for several visits at once and never past the day", () => {
    expect(
      visibleHoursFor([seg("a", 6 * 60 + 15, 8 * 60), seg("b", 20 * 60, 22 * 60 + 30)]),
    ).toEqual({ startHour: 6, endHour: 23 });
    const widest = visibleHoursFor([seg("a", 0, 1440)]);
    expect(widest).toEqual({ startHour: 0, endHour: 24 });
    expect(hourCount(widest)).toBe(24);
  });

  it("is a pure function: the defaults can be replaced", () => {
    expect(visibleHoursFor([], { startHour: 8, endHour: 18 })).toEqual({
      startHour: 8,
      endHour: 18,
    });
  });
});

describe("blockPosition", () => {
  const hours = { startHour: 7, endHour: 20 }; // 13 hours = 780 minutes

  it("measures from the first visible hour, as a percentage of the column", () => {
    const { topPercent, heightPercent } = blockPosition(seg("a", 600, 720), hours);
    expect(topPercent).toBeCloseTo((180 / 780) * 100, 6);
    expect(heightPercent).toBeCloseTo((120 / 780) * 100, 6);
  });

  it("puts a visit at the first visible hour at the very top", () => {
    expect(blockPosition(seg("a", 420, 480), hours).topPercent).toBe(0);
  });

  it("ends a visit at the last visible hour at the very bottom", () => {
    const { topPercent, heightPercent } = blockPosition(seg("a", 19 * 60, 20 * 60), hours);
    expect(topPercent + heightPercent).toBeCloseTo(100, 6);
  });

  it("puts the 10:00 row at the same height wherever the grid starts, relative to its own hours", () => {
    const early = { startHour: 5, endHour: 20 };
    expect(blockPosition(seg("a", 600, 660), early).topPercent).toBeCloseTo((300 / 900) * 100, 6);
  });

  it("clips a block to the visible hours instead of drawing outside the column", () => {
    const { topPercent, heightPercent } = blockPosition(seg("a", 6 * 60, 8 * 60), hours);
    expect(topPercent).toBe(0);
    expect(heightPercent).toBeCloseTo((60 / 780) * 100, 6);
  });
});

describe("layoutColumns: overlapping blocks side by side", () => {
  const layout = (...segments: Array<ReturnType<typeof seg>>) => layoutColumns(segments);

  it("gives a block that overlaps nothing the whole width", () => {
    expect(layout(seg("a", 600, 660)).get("a")).toEqual({ column: 0, columns: 1 });
  });

  it("puts two overlapping blocks in two columns", () => {
    const result = layout(seg("a", 600, 720), seg("b", 630, 690));
    expect(result.get("a")).toEqual({ column: 0, columns: 2 });
    expect(result.get("b")).toEqual({ column: 1, columns: 2 });
  });

  it("lets blocks that only touch share a column, each the whole width", () => {
    const result = layout(seg("a", 600, 660), seg("b", 660, 720));
    expect(result.get("a")).toEqual({ column: 0, columns: 1 });
    expect(result.get("b")).toEqual({ column: 0, columns: 1 });
  });

  it("starts the same time: the longer block goes first, ties by id", () => {
    const result = layout(seg("b", 600, 660), seg("a", 600, 720), seg("c", 600, 660));
    expect(result.get("a")).toEqual({ column: 0, columns: 3 });
    expect(result.get("b")).toEqual({ column: 1, columns: 3 });
    expect(result.get("c")).toEqual({ column: 2, columns: 3 });
  });

  it("reuses a freed column inside a cluster instead of opening a new one", () => {
    // a 10-12, b 10-11, c 11-12: c fits under b, so two columns are enough.
    const result = layout(seg("a", 600, 720), seg("b", 600, 660), seg("c", 660, 720));
    expect(result.get("a")).toEqual({ column: 0, columns: 2 });
    expect(result.get("b")).toEqual({ column: 1, columns: 2 });
    expect(result.get("c")).toEqual({ column: 1, columns: 2 });
  });

  it("treats a chain of overlaps as one cluster sized by its busiest moment", () => {
    // a 10-11, b 10:30-12, c 11:30-12:30: a and c never meet, but both meet b.
    const result = layout(seg("a", 600, 660), seg("b", 630, 720), seg("c", 690, 750));
    expect(result.get("a")).toEqual({ column: 0, columns: 2 });
    expect(result.get("b")).toEqual({ column: 1, columns: 2 });
    expect(result.get("c")).toEqual({ column: 0, columns: 2 });
  });

  it("keeps separate clusters separate: a lone block later in the day is not narrowed", () => {
    const result = layout(seg("a", 600, 720), seg("b", 630, 690), seg("late", 900, 960));
    expect(result.get("late")).toEqual({ column: 0, columns: 1 });
    expect(result.get("a")?.columns).toBe(2);
  });

  it("never gives two overlapping blocks the same column", () => {
    const segments = [
      seg("a", 420, 600),
      seg("b", 480, 540),
      seg("c", 540, 660),
      seg("d", 500, 700),
      seg("e", 650, 720),
      seg("f", 800, 830),
    ];
    const result = layoutColumns(segments);
    for (const x of segments) {
      for (const y of segments) {
        if (x.visitId < y.visitId && x.startMin < y.endMin && y.startMin < x.endMin) {
          expect(result.get(x.visitId)?.column).not.toBe(result.get(y.visitId)?.column);
        }
      }
      const placed = result.get(x.visitId);
      expect(placed?.column).toBeLessThan(placed?.columns ?? 0);
    }
  });

  it("gives the same layout whatever order the blocks arrive in", () => {
    const segments = [
      seg("a", 600, 720),
      seg("b", 630, 690),
      seg("c", 660, 700),
      seg("d", 900, 960),
    ];
    const forward = layoutColumns(segments);
    const backward = layoutColumns([...segments].reverse());
    expect([...backward.entries()].sort()).toEqual([...forward.entries()].sort());
  });

  it("is empty for no blocks", () => {
    expect(layoutColumns([]).size).toBe(0);
  });
});

describe("visibleLineCount: the lines that fit a block", () => {
  it.each([
    [15, 1],
    [30, 1],
    [45, 2],
    [60, 3],
    [75, 3],
    [90, 4],
    [120, 4],
    [720, 4],
  ])("a %i minute block has room for %i line(s)", (minutes, lines) => {
    expect(visibleLineCount(minutes)).toBe(lines);
  });

  it("never shows less than the time", () => {
    expect(visibleLineCount(0)).toBe(1);
  });
});

describe("layoutColumns: a block that only touches another is not narrowed by what overlaps the other", () => {
  it("keeps a block full width when the next one starts as it ends and a third overlaps only that one", () => {
    // a 10-11 touches b 11-12; e 11-11:30 overlaps b only. a is alone in its cluster.
    const result = layoutColumns([
      { visitId: "a", startMin: 600, endMin: 660 },
      { visitId: "b", startMin: 660, endMin: 720 },
      { visitId: "e", startMin: 660, endMin: 690 },
    ]);
    expect(result.get("a")).toEqual({ column: 0, columns: 1 });
    expect(result.get("b")?.columns).toBe(2);
    expect(result.get("e")?.columns).toBe(2);
  });
});
