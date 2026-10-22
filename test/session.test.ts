import { beforeEach, expect, it } from "vitest";
import { db } from "@/lib/db";
import { listActiveSessions } from "@/server/session";
import { resetDb } from "./db";
import { createUser } from "./factories";

beforeEach(resetDb);

const session = (userId: string, id: string, expiresInMs: number, updatedAt: string) =>
  db.session.create({
    data: { id, userId, token: `token-${id}`, expiresAt: new Date(Date.now() + expiresInMs), updatedAt: new Date(updatedAt) },
  });

it("lists the person's unexpired sessions, most recently active first, however old they are", async () => {
  const [me, other] = [await createUser(), await createUser()];
  await session(me.id, "old-phone", 60_000, "2026-01-01T00:00:00Z");
  await session(me.id, "laptop", 60_000, "2026-03-01T00:00:00Z");
  await session(me.id, "expired", -60_000, "2026-04-01T00:00:00Z");
  await session(other.id, "someone-else", 60_000, "2026-04-01T00:00:00Z");

  expect((await listActiveSessions(me.id)).map((s) => s.id)).toEqual(["laptop", "old-phone"]);
});
