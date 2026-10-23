import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatAgo, formatDay, fromDbDate, monthLabel, toDbDate, todayIn } from "./dates";

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

  it("says how long ago, and gives the day itself after a week", () => {
    const ago = (seconds: number) => formatAgo(new Date(Date.now() - seconds * 1000));
    expect(ago(5)).toBe("just now");
    expect(ago(-30)).toBe("just now"); // a clock a little ahead is not "in 30 seconds"
    expect(ago(60)).toBe("1 minute ago");
    expect(ago(59 * 60)).toBe("59 minutes ago");
    expect(ago(3 * 3600)).toBe("3 hours ago");
    expect(ago(86400)).toBe("yesterday");
    expect(ago(3 * 86400)).toBe("3 days ago");
    expect(ago(7 * 86400)).toBe("15 Oct");
    expect(formatAgo(new Date("2025-03-02T10:00:00Z"))).toBe("2 Mar 2025");
  });

  it("labels a month", () => expect(monthLabel("2026-10-23")).toBe("October 2026"));

  it("round-trips a calendar date through the db Date", () => {
    expect(toDbDate("2026-02-28").toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(fromDbDate(toDbDate("2026-02-28"))).toBe("2026-02-28");
  });
});
