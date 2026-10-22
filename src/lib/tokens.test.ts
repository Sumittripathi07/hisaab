import { expect, it } from "vitest";
import { newClaimToken, newInviteCode } from "./tokens";
import { inviteCodeFrom } from "./invite-code";

it("makes URL-safe invite codes of 11 characters that inviteCodeFrom accepts", () => {
  const code = newInviteCode();
  expect(code).toMatch(/^[A-Za-z0-9_-]{11}$/);
  expect(inviteCodeFrom(`https://hisaab.app/join/${code}`)).toBe(code);
});

it("makes URL-safe claim tokens of 32 characters", () => {
  expect(newClaimToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
});

it("does not repeat", () => {
  expect(new Set(Array.from({ length: 100 }, newInviteCode)).size).toBe(100);
  expect(new Set(Array.from({ length: 100 }, newClaimToken)).size).toBe(100);
});
