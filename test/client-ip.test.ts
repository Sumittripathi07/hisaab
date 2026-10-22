import { getIP } from "better-auth/api";
import { describe, expect, it } from "vitest";
import { auth } from "@/lib/auth";

const ipFor = (xff: string) => getIP(new Headers({ "x-forwarded-for": xff }), auth.options);

describe("client IP behind Cloud Run", () => {
  it("takes the right-most entry, the one Google's front end appended", () => {
    expect(ipFor("1.2.3.4, 5.6.7.8")).toBe("5.6.7.8");
  });

  it("ignores spoofed entries on the left", () => {
    expect(ipFor("9.9.9.9, 8.8.8.8, 5.6.7.8")).toBe("5.6.7.8");
  });

  it("skips a Google load balancer hop on the right", () => {
    expect(ipFor("1.2.3.4, 5.6.7.8, 35.191.0.1")).toBe("5.6.7.8");
  });

  it("still reads a single-value header", () => {
    expect(ipFor("5.6.7.8")).toBe("5.6.7.8");
  });
});
