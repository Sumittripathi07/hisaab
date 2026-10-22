import { it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

it("reports ok when the database answers", async () => {
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});
