// Calendar dates travel as "YYYY-MM-DD" strings and live in Postgres `date` columns (UTC midnight in a JS Date).

/** Today's calendar date in `timeZone` ("Asia/Kolkata"), so it matches the user's wall clock, not the server's. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** "23 Oct", or "23 Oct 2025" when it isn't this year. */
export function formatDay(date: string): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const monthName = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(Date.UTC(year, month - 1, day));
  const text = `${day} ${monthName}`;
  return year === new Date().getUTCFullYear() ? text : `${text} ${year}`;
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/**
 * "just now", "5 minutes ago", "yesterday", "3 days ago"; from a week back, the day itself ("15 Oct"). Pages work this out on
 * the server and pass the text down, so the server's and the browser's clocks never disagree about it.
 */
export function formatAgo(date: Date, now = new Date()): string {
  // A clock a little ahead of ours reads as "just now", not "in 30 seconds".
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return relative.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86_400) return relative.format(-Math.floor(seconds / 3_600), "hour");
  if (seconds < 7 * 86_400) return relative.format(-Math.floor(seconds / 86_400), "day");
  return formatDay(fromDbDate(date)); // ponytail: the UTC day, which near midnight can be a day off for the reader
}

/** "October 2026". */
export function monthLabel(date: string): string {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(toDbDate(date));
}

export function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function fromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
