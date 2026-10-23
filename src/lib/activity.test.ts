import { describe, expect, it } from "vitest";
import { describeActivity, linkTarget, type ActivityView } from "./activity";

const names = { p: "Priya", a: "Asha", r: "Ravi" };
const base = { currency: "INR", names };

const added = (viewer: string) =>
  describeActivity({
    kind: "expense.created",
    actorMemberId: "p",
    viewerMemberId: viewer,
    ...base,
    payload: { description: "Dinner at Thalassa", amount: "222000", currency: "INR", net: { p: "148000", a: "-74000", r: "-74000" } },
  });

describe("describeActivity", () => {
  it("tells the viewer what they owe", () =>
    expect(added("a")).toEqual({ title: "Priya added “Dinner at Thalassa”", detail: null, money: { text: "you owe ₹740", tone: "owe" } }));

  it("speaks to the actor", () =>
    expect(added("p")).toMatchObject({ title: "You added “Dinner at Thalassa”", money: { text: "you get back ₹1,480", tone: "owed" } }));

  it("leaves out money for people not in it", () => expect(added("x").money).toBeNull());

  it("describes an edit", () => {
    const edited = describeActivity({
      kind: "expense.updated",
      actorMemberId: "r",
      viewerMemberId: "a",
      ...base,
      payload: {
        description: "Lunch",
        amount: "120000",
        currency: "INR",
        net: { a: "-40000" },
        changes: [
          { field: "amount", before: "₹1,000", after: "₹1,200" },
          { field: "description", before: "Lunc", after: "Lunch" },
          { field: "payers", before: null, after: null },
          { field: "split", before: null, after: null },
        ],
      },
    });
    expect(edited).toEqual({
      title: "Ravi edited “Lunch”",
      detail: "amount ₹1,000 → ₹1,200 · renamed from “Lunc” · who paid · the split",
      money: { text: "you owe ₹400", tone: "owe" },
    });
  });

  it("words deletes and restores, with money only for restores", () => {
    const payload = { description: "Taxi", amount: "30000", currency: "INR", net: { a: "-10000" } };
    const view = (kind: "expense.deleted" | "expense.restored"): ActivityView => ({ kind, actorMemberId: "a", viewerMemberId: "a", ...base, payload });
    expect(describeActivity(view("expense.deleted"))).toEqual({ title: "You deleted “Taxi”", detail: null, money: null });
    expect(describeActivity(view("expense.restored"))).toMatchObject({ title: "You restored “Taxi”", money: { text: "you owe ₹100", tone: "owe" } });
  });

  describe("payments", () => {
    const payment = { fromMemberId: "r", toMemberId: "a", amount: "85000", currency: "INR", method: "UPI" as const };
    const view = (actor: string, viewer: string, kind: Extract<ActivityView["kind"], `settlement.${string}`> = "settlement.created"): ActivityView => ({
      kind,
      actorMemberId: actor,
      viewerMemberId: viewer,
      ...base,
      payload: payment,
    });

    it("says who paid whom", () => {
      expect(describeActivity(view("r", "a"))).toEqual({ title: "Ravi paid you ₹850", detail: null, money: null });
      expect(describeActivity(view("r", "r")).title).toBe("You paid Asha ₹850");
      expect(describeActivity(view("r", "p")).title).toBe("Ravi paid Asha ₹850");
    });

    it("says who recorded it when that is not the payer", () => {
      expect(describeActivity(view("a", "a"))).toMatchObject({ title: "Ravi paid you ₹850", detail: "Recorded by you" });
      expect(describeActivity(view("a", "r"))).toMatchObject({ title: "You paid Asha ₹850", detail: "Recorded by Asha" });
    });

    it("words a dispute from the payee's side", () => {
      expect(describeActivity(view("a", "r", "settlement.disputed")).title).toBe("Asha didn't receive ₹850 from you");
      expect(describeActivity(view("a", "a", "settlement.disputed")).title).toBe("You didn't receive ₹850 from Ravi");
    });

    it("words edits, deletes and restores", () => {
      expect(describeActivity(view("a", "r", "settlement.updated")).title).toBe("Asha edited a payment from you to Asha");
      expect(describeActivity(view("r", "a", "settlement.deleted")).title).toBe("Ravi deleted a payment from Ravi to you");
      expect(describeActivity(view("a", "a", "settlement.restored")).title).toBe("You restored a payment from Ravi to you");
    });
  });

  it("describes comments and members", () => {
    const comment = describeActivity({
      kind: "comment.created",
      actorMemberId: "r",
      viewerMemberId: "a",
      ...base,
      payload: { targetKind: "expense", targetId: "e1", targetLabel: "Dinner at Thalassa", excerpt: "Did we include the tip?" },
    });
    expect(comment).toEqual({ title: "Ravi commented on “Dinner at Thalassa”", detail: "Did we include the tip?", money: null });

    const member = (kind: "member.joined" | "member.added" | "member.left" | "member.removed", viewer = "p") =>
      describeActivity({ kind, actorMemberId: "a", viewerMemberId: viewer, ...base, payload: { memberId: "x", displayName: "Rahul" } });
    expect(member("member.added")).toEqual({ title: "Asha added Rahul", detail: null, money: null });
    expect(member("member.joined").title).toBe("Asha joined the group");
    expect(member("member.left", "a").title).toBe("You left the group");
    expect(member("member.removed").title).toBe("Asha removed Rahul");
  });

  it("doesn't print undefined for a member the group list lacks", () =>
    expect(
      describeActivity({ kind: "member.left", actorMemberId: "gone", viewerMemberId: "a", ...base, payload: { memberId: "gone", displayName: "Zed" } }).title,
    ).toBe("Someone left the group"));
});

describe("linkTarget", () => {
  const row = (kind: ActivityView["kind"], payload: object, entityId = "x") =>
    linkTarget({ kind, payload, entityId, actorMemberId: "a", viewerMemberId: "a", ...base } as ActivityView & { entityId: string });

  it("points expense and payment rows at their own entity", () => {
    expect(row("expense.created", {}, "e1")).toEqual({ kind: "expense", id: "e1" });
    expect(row("settlement.disputed", {}, "s1")).toEqual({ kind: "settlement", id: "s1" });
  });

  it("points a comment at its target, not at the comment", () => {
    expect(row("comment.created", { targetKind: "settlement", targetId: "s9" }, "c1")).toEqual({ kind: "settlement", id: "s9" });
  });

  it("has nothing for member rows", () => expect(row("member.joined", {})).toBeNull());
});
