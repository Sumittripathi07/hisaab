import { describe, it, expect } from "vitest";
import { parseEnv } from "@/lib/env";

const valid = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  SMTP_URL: "file:///tmp/outbox",
};

describe("parseEnv", () => {
  it("names the missing variable", () => {
    expect(() => parseEnv({ NODE_ENV: "test" })).toThrow(/DATABASE_URL/);
  });
  it("accepts a postgres URL", () => {
    expect(parseEnv(valid).DATABASE_URL).toBe("postgresql://u:p@localhost:5432/db");
  });
  it("requires SMTP_URL", () => {
    expect(() => parseEnv({ ...valid, SMTP_URL: undefined })).toThrow(/SMTP_URL/);
  });
  it("defaults EMAIL_FROM", () => {
    expect(parseEnv(valid).EMAIL_FROM).toBe("Hisaab <no-reply@hisaab.local>");
  });
});
