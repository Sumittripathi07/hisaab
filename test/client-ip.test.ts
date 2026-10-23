import { getIP } from "better-auth/api";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let options: Parameters<typeof getIP>[1];
const ipFor = (xff: string) => getIP(new Headers({ "x-forwarded-for": xff }), options);

/** auth.ts as it loads with PROXY_SECRET set to `secret` or unset (env.ts reads it at import). */
async function loadAuth(secret?: string) {
  vi.resetModules();
  if (secret) process.env.PROXY_SECRET = secret;
  else delete process.env.PROXY_SECRET;
  options = (await import("@/lib/auth")).auth.options;
}

afterAll(() => {
  delete process.env.PROXY_SECRET;
  vi.resetModules();
});

describe("client IP behind Cloud Run, proxy gate off", () => {
  beforeAll(() => loadAuth());

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

  // Anyone can call run.app from a Worker of their own: the made-up left entry must not become the client.
  it.each(["104.16.0.1", "2a06:98c0:3600::103"])("does not trust a Cloudflare hop (%s), so a forged left entry is ignored", (egress) => {
    expect(ipFor(`7.7.7.7, ${egress}`)).toBe(egress.includes(":") ? "2a06:98c0:3600:0000:0000:0000:0000:0000" : egress);
  });
});

// The Worker sets X-Forwarded-For to CF-Connecting-IP; Cloud Run's front end appends the Worker's Cloudflare egress
// address. With the gate on, only the Worker gets in, so the entry left of Cloudflare is the client.
describe("client IP behind the Cloudflare Worker, proxy gate on", () => {
  beforeAll(() => loadAuth("f".repeat(64)));

  it.each(["104.16.0.1", "172.64.1.2", "162.158.10.20", "131.0.72.1", "2a06:98c0:3600::103", "2606:4700:10::6816:1"])(
    "skips the Cloudflare egress hop %s",
    (egress) => {
      expect(ipFor(`5.6.7.8, ${egress}`)).toBe("5.6.7.8");
    },
  );

  it("still skips a Google load balancer hop", () => {
    expect(ipFor("5.6.7.8, 104.16.0.1, 35.191.0.1")).toBe("5.6.7.8");
  });

  it("reads an IPv6 client (keyed by its /64)", () => {
    expect(ipFor("2001:db8:1:2:3:4:5:6, 104.16.0.1")).toBe("2001:0db8:0001:0002:0000:0000:0000:0000");
  });

  it("does not trust an address just outside Cloudflare's ranges", () => {
    // 104.24.0.0/14 ends at 104.27.255.255; 172.64.0.0/13 ends at 172.71.255.255.
    expect(ipFor("5.6.7.8, 104.28.0.1")).toBe("104.28.0.1");
    expect(ipFor("5.6.7.8, 172.72.0.1")).toBe("172.72.0.1");
  });
});
