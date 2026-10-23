/** "Show more" lists grow by this many rows, up to `MAX_LIMIT`. */
export const PAGE_SIZE = 50;
const MAX_LIMIT = 500;

/** The `?limit=` of a list page: a hand-edited value is kept within what the list allows. */
export function parseLimit(raw: string | string[] | undefined): number {
  return Math.min(MAX_LIMIT, Math.max(PAGE_SIZE, Math.trunc(Number([raw].flat()[0])) || PAGE_SIZE));
}
