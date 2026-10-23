import { expect, it } from "vitest";
import { CATEGORIES, CATEGORY_KEYS, suggestCategory } from "@/lib/categories";

it.each([["Dinner at Thalassa", "food"], ["Uber to airport", "transport"], ["Petrol", "fuel"], ["Xyz", "other"]])(
  "suggests %s → %s",
  (d, c) => expect(suggestCategory(d, [])).toBe(c),
);

it("past entries beat keywords", () => expect(suggestCategory(" dinner ", [{ description: "Dinner", category: "gifts" }])).toBe("gifts"));

it("takes the most recent matching past entry, comparing whole normalised descriptions", () => {
  const past = [
    { description: "Goa  Villa", category: "stay" },
    { description: "goa villa", category: "rent" },
    { description: "Villa", category: "gifts" },
  ];
  expect(suggestCategory("goa villa", past)).toBe("stay");
});

it("lists the categories in order, with lowercase single-word keywords for all but other", () => {
  expect(CATEGORY_KEYS).toEqual(
    ["food", "groceries", "transport", "fuel", "stay", "travel", "rent", "utilities", "shopping", "entertainment", "health", "gifts", "other"],
  );
  for (const key of CATEGORY_KEYS.filter((k) => k !== "other")) {
    expect(CATEGORIES[key].keywords.length).toBeGreaterThanOrEqual(6);
    for (const word of CATEGORIES[key].keywords) expect(word).toMatch(/^[a-z0-9]+$/);
  }
  expect(CATEGORIES.other.keywords).toEqual([]);
});
