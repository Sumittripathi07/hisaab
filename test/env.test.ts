import { describe, it, expect } from "vitest";
import { parseEnv } from "@/lib/env";

const valid = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  SMTP_URL: "file:///tmp/outbox",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
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
  it("rejects a BETTER_AUTH_SECRET shorter than 32 characters", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: "a".repeat(31) })).toThrow(/BETTER_AUTH_SECRET/);
  });
  it("requires BETTER_AUTH_URL to be a URL", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_URL: "localhost:3000" })).toThrow(/BETTER_AUTH_URL/);
  });
  it("requires the Google credentials", () => {
    expect(() => parseEnv({ ...valid, GOOGLE_CLIENT_ID: undefined })).toThrow(/GOOGLE_CLIENT_ID/);
    expect(() => parseEnv({ ...valid, GOOGLE_CLIENT_SECRET: undefined })).toThrow(/GOOGLE_CLIENT_SECRET/);
  });
  it("leaves the proxy gate off unless PROXY_SECRET is set", () => {
    expect(parseEnv(valid).PROXY_SECRET).toBeUndefined();
    expect(parseEnv({ ...valid, PROXY_SECRET: "" }).PROXY_SECRET).toBe("");
    expect(parseEnv({ ...valid, PROXY_SECRET: "f".repeat(64) }).PROXY_SECRET).toBe("f".repeat(64));
  });
  it("rejects a PROXY_SECRET shorter than 32 characters", () => {
    expect(() => parseEnv({ ...valid, PROXY_SECRET: "short" })).toThrow(/PROXY_SECRET/);
  });
  it("defaults EMAIL_FROM", () => {
    expect(parseEnv(valid).EMAIL_FROM).toBe("Hisaab <no-reply@hisaab.local>");
  });
});
