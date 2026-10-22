import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDay, fromDbDate, monthLabel, toDbDate, todayIn } from "./dates";

describe("dates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T20:00:00Z")); // already the 23rd in Kolkata (UTC+5:30)
  });
  afterEach(() => vi.useRealTimers());

  it("computes today in a time zone", () => {
    expect(todayIn("Asia/Kolkata")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayIn("Asia/Kolkata")).toBe("2026-10-23");
    expect(todayIn("UTC")).toBe("2026-10-22");
  });

  it("formats a day, with the year only when it isn't this year", () => {
    expect(formatDay("2026-10-23")).toBe("23 Oct");
    expect(formatDay("2026-09-05")).toBe("5 Sep");
    expect(formatDay("2025-10-23")).toBe("23 Oct 2025");
  });

  it("labels a month", () => expect(monthLabel("2026-10-23")).toBe("October 2026"));

  it("round-trips a calendar date through the db Date", () => {
    expect(toDbDate("2026-02-28").toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(fromDbDate(toDbDate("2026-02-28"))).toBe("2026-02-28");
  });
});
