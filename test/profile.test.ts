import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { completeOnboarding, updateProfile } from "@/server/profile";
import { resetDb } from "./db";
import { createUser } from "./factories";

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

  it("createUser makes unique, onboarded users", async () => {
    const [a, b] = [await createUser(), await createUser()];
    expect(a.email).not.toBe(b.email);
    expect(a.onboardedAt).toBeInstanceOf(Date);
  });
});
