import { expect, it } from "vitest";
import { inviteCodeFrom } from "./invite-code";

it("finds the code in a link, a message, or on its own", () => {
  expect(inviteCodeFrom("https://hisaab.app/join/Ab-12_xYz9Q")).toBe("Ab-12_xYz9Q");
  expect(inviteCodeFrom("  https://hisaab.app/join/Ab-12_xYz9Q?ref=wa#top ")).toBe("Ab-12_xYz9Q");
  expect(inviteCodeFrom("Join Goa Trip on Hisaab: https://hisaab.app/join/Ab-12_xYz9Q")).toBe("Ab-12_xYz9Q");
  expect(inviteCodeFrom("/join/Ab-12_xYz9Q")).toBe("Ab-12_xYz9Q");
  expect(inviteCodeFrom("Ab-12_xYz9Q")).toBe("Ab-12_xYz9Q");
});

it("rejects input without a plausible code", () => {
  expect(inviteCodeFrom("")).toBeNull();
  expect(inviteCodeFrom("https://hisaab.app/groups/abc123")).toBeNull();
  expect(inviteCodeFrom("not a code")).toBeNull();
  expect(inviteCodeFrom("../../admin")).toBeNull();
});
