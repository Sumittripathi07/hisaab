import { describe, it, expect } from "vitest";
import { parseEnv } from "@/lib/env";

describe("parseEnv", () => {
  it("names the missing variable", () => {
    expect(() => parseEnv({ NODE_ENV: "test" })).toThrow(/DATABASE_URL/);
  });
  it("accepts a postgres URL", () => {
    const e = parseEnv({ NODE_ENV: "test", DATABASE_URL: "postgresql://u:p@localhost:5432/db" });
    expect(e.DATABASE_URL).toBe("postgresql://u:p@localhost:5432/db");
  });
});
