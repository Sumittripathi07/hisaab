import { db } from "@/lib/db";
import type { User } from "@/generated/prisma/client";

let counter = 0;

/** A user who has finished onboarding, with a unique email. Better Auth normally supplies the id, so we do. */
export function createUser(overrides: Partial<User> = {}): Promise<User> {
  counter += 1;
  return db.user.create({
    data: {
      id: crypto.randomUUID(),
      name: `User ${counter}`,
      email: `user${counter}-${crypto.randomUUID().slice(0, 8)}@example.test`,
      onboardedAt: new Date(),
      ...overrides,
    },
  });
}
