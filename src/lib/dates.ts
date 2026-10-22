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
