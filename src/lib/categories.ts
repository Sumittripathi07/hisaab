// Expense categories, in the order the picker shows them. Keywords are single lowercase words matched against the
// words of a description; earlier categories win, so "uber to airport" is transport, not travel.
export const CATEGORIES = {
  food: {
    label: "Food & drink",
    emoji: "🍽️",
    keywords: ["breakfast", "lunch", "dinner", "snacks", "chai", "coffee", "cafe", "restaurant", "zomato", "swiggy", "pizza", "biryani", "dosa", "drinks", "beer"],
  },
  groceries: {
    label: "Groceries",
    emoji: "🛒",
    keywords: ["groceries", "grocery", "vegetables", "sabzi", "fruits", "milk", "kirana", "bigbasket", "blinkit", "zepto", "instamart", "dmart"],
  },
  transport: {
    label: "Transport",
    emoji: "🚕",
    keywords: ["uber", "ola", "rapido", "cab", "taxi", "auto", "rickshaw", "metro", "bus", "parking", "toll"],
  },
  fuel: { label: "Fuel", emoji: "⛽", keywords: ["petrol", "diesel", "fuel", "cng", "refuel", "pump"] },
  stay: { label: "Stay", emoji: "🏨", keywords: ["hotel", "hostel", "airbnb", "oyo", "resort", "homestay", "stay", "lodge", "villa"] },
  travel: {
    label: "Travel",
    emoji: "✈️",
    keywords: ["flight", "flights", "train", "irctc", "indigo", "airport", "visa", "makemytrip", "goibibo", "trip"],
  },
  rent: { label: "Rent", emoji: "🏠", keywords: ["rent", "deposit", "maintenance", "brokerage", "lease", "society"] },
  utilities: {
    label: "Utilities",
    emoji: "💡",
    keywords: ["electricity", "wifi", "internet", "broadband", "water", "gas", "cylinder", "recharge", "airtel", "jio", "dth"],
  },
  shopping: {
    label: "Shopping",
    emoji: "🛍️",
    keywords: ["shopping", "amazon", "flipkart", "myntra", "ajio", "meesho", "clothes", "shoes", "mall"],
  },
  entertainment: {
    label: "Entertainment",
    emoji: "🎬",
    keywords: ["movie", "movies", "netflix", "hotstar", "spotify", "bookmyshow", "concert", "party", "games", "bowling", "club"],
  },
  health: {
    label: "Health",
    emoji: "💊",
    keywords: ["medicine", "medicines", "pharmacy", "chemist", "doctor", "hospital", "clinic", "dentist", "apollo", "pharmeasy", "gym"],
  },
  gifts: { label: "Gifts", emoji: "🎁", keywords: ["gift", "gifts", "birthday", "wedding", "anniversary", "present", "shagun"] },
  other: { label: "Other", emoji: "🧾", keywords: [] },
} satisfies Record<string, { label: string; emoji: string; keywords: string[] }>;

export type Category = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as [Category, ...Category[]];

/** Lowercase, trimmed, runs of spaces collapsed: what makes two descriptions "the same". */
export const normalise = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * A category for `description`: what the group last used for the same description (`past` newest first), else the first
 * category with a keyword among its words, else "other".
 */
export function suggestCategory(description: string, past: { description: string; category: string }[]): Category {
  const text = normalise(description);
  const same = past.find((entry) => normalise(entry.description) === text);
  if (same && Object.hasOwn(CATEGORIES, same.category)) return same.category as Category;
  const words = new Set(text.split(/[^\p{L}\p{N}]+/u));
  return CATEGORY_KEYS.find((key) => CATEGORIES[key].keywords.some((word) => words.has(word))) ?? "other";
}
