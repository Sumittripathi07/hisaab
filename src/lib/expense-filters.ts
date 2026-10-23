import { CATEGORY_KEYS, type Category } from "@/lib/categories";
import { isoDateSchema } from "@/lib/validation";
import type { ExpenseFilters } from "@/server/expenses";

type Query = Record<string, string | string[] | undefined>;

const MAX_SEARCH = 100;
const first = (value: string | string[] | undefined) => [value].flat()[0];
const date = (value: string | undefined) => (value && isoDateSchema.safeParse(value).success ? value : undefined);

/** The expense list's filters from a page's search params. Whatever a hand-edited address gets wrong is simply left out. */
export function parseFilters(query: Query): ExpenseFilters {
  const q = first(query.q)?.trim().slice(0, MAX_SEARCH);
  const category = first(query.category);
  const filters: ExpenseFilters = {
    q: q || undefined,
    memberId: first(query.member) || undefined,
    category: CATEGORY_KEYS.includes(category as Category) ? (category as Category) : undefined,
    from: date(first(query.from)),
    to: date(first(query.to)),
  };
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined));
}

/** The search params for `filters`, after `extra` (the tab, a limit). Shared so the server and the filter controls agree. */
export function toQuery(filters: ExpenseFilters, extra: Record<string, string> = {}): string {
  const { q, memberId, category, from, to } = filters;
  const params = new URLSearchParams(extra);
  for (const [key, value] of Object.entries({ q, member: memberId, category, from, to })) if (value) params.set(key, value);
  return params.toString();
}

/** How many of the filters in the Filters sheet are set (the search box shows its own text). */
export const activeFilters = ({ memberId, category, from, to }: ExpenseFilters): number =>
  [memberId, category, from, to].filter(Boolean).length;
