/**
 * Source of the current time. Business logic that depends on "now" (expiry, overdue,
 * scheduling, rate-limit windows) takes a `Clock` so tests can control time.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** A clock that only moves when told to; for tests. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date | string | number = "2026-01-01T00:00:00.000Z") {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(time: Date | string | number): void {
    this.current = new Date(time);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }

  advanceSeconds(seconds: number): void {
    this.advance(seconds * 1000);
  }
}
