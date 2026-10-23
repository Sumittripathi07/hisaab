import { describe, expect, it } from "vitest";
import { commentViews } from "./comment-view";

const item = (id: string, memberId: string, displayName: string) => ({
  id,
  body: "Who has the receipt?",
  createdAt: new Date("2026-10-23T09:00:00Z"),
  author: { memberId, displayName, image: null },
  canDelete: memberId === "asha",
});

describe("commentViews", () => {
  it("names the viewer 'You' and turns the time into words, so the client never reads a clock", () => {
    const views = commentViews([item("c1", "asha", "Asha"), item("c2", "ravi", "Ravi")], "asha", new Date("2026-10-23T09:05:00Z"));
    expect(views).toEqual([
      { id: "c1", body: "Who has the receipt?", when: "5 minutes ago", name: "You", avatarName: "Asha", image: null, canDelete: true },
      { id: "c2", body: "Who has the receipt?", when: "5 minutes ago", name: "Ravi", avatarName: "Ravi", image: null, canDelete: false },
    ]);
  });
});
