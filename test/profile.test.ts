import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { completeOnboarding, updateProfile } from "@/server/profile";
import { resetDb } from "./db";
import { addMember, createGroup, createUser } from "./factories";

beforeEach(resetDb);

const input = { name: "Asha", defaultCurrency: "INR", upiId: "asha@okicici", timezone: "Asia/Kolkata" };

describe("profile service", () => {
  it("saves the profile and marks the user onboarded", async () => {
    const u = await createUser({ onboardedAt: null });
    await completeOnboarding(u.id, input);
    const saved = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(saved).toMatchObject({ name: "Asha", defaultCurrency: "INR", upiId: "asha@okicici", timezone: "Asia/Kolkata" });
    expect(saved.onboardedAt).toBeInstanceOf(Date);
  });

  it("updates the profile without touching onboardedAt", async () => {
    const onboardedAt = new Date("2026-01-01T00:00:00Z");
    const u = await createUser({ onboardedAt, upiId: "old@okaxis" });
    await updateProfile(u.id, { ...input, name: "Asha K", defaultCurrency: "USD", upiId: null });
    const saved = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(saved).toMatchObject({ name: "Asha K", defaultCurrency: "USD", upiId: null });
    expect(saved.onboardedAt).toEqual(onboardedAt);
  });

  // The account page promises "Friends see this name in groups and on every split".
  it.each([
    ["updateProfile", updateProfile],
    ["completeOnboarding", completeOnboarding],
  ])("%s renames the person in every group they're in, and nobody else", async (_, save) => {
    const [u, other] = [await createUser({ name: "Asha" }), await createUser({ name: "Ravi" })];
    const own = await createGroup(u.id);
    const theirs = await createGroup(other.id);
    await addMember(theirs.id, { userId: u.id });
    await addMember(theirs.id, { userId: (await createUser()).id, leftAt: new Date() });
    const placeholder = await addMember(theirs.id, { displayName: "Asha" });

    await save(u.id, { ...input, name: "Asha K" });

    const names = await db.groupMember.findMany({ where: { userId: u.id }, select: { groupId: true, displayName: true } });
    expect(names.sort((a, b) => a.groupId.localeCompare(b.groupId))).toEqual(
      [own.id, theirs.id].sort().map((groupId) => ({ groupId, displayName: "Asha K" })),
    );
    expect(await db.groupMember.findUniqueOrThrow({ where: { id: placeholder.id } })).toMatchObject({ displayName: "Asha" });
    expect(await db.groupMember.count({ where: { displayName: "Ravi" } })).toBe(1);
  });

  it("createUser makes unique, onboarded users", async () => {
    const [a, b] = [await createUser(), await createUser()];
    expect(a.email).not.toBe(b.email);
    expect(a.onboardedAt).toBeInstanceOf(Date);
  });
});
