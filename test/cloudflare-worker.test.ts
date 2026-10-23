import { describe, expect, it } from "vitest";
import { proxy } from "../infra/cloudflare-worker/src/index.js";

const ORIGIN = "https://hisaab-web-27933145966.asia-south1.run.app";
const HOST = "hisab.sumittripathi.dev";
const env = { ORIGIN, PROXY_SECRET: "s".repeat(64) };

/** Runs the Worker against a fake Cloud Run that records the one request it gets and answers `reply`. */
async function run(request: Request, reply = new Response("ok"), workerEnv: { ORIGIN: string; PROXY_SECRET?: string } = env) {
  const sent: { url: string; init: RequestInit }[] = [];
  const res = await proxy(request, workerEnv, async (url, init = {}) => {
    sent.push({ url: String(url), init });
    return reply;
  });
  return { res, sent };
}

const visit = (path: string, init: RequestInit = {}) => new Request(`https://${HOST}${path}`, init);

describe("Cloudflare Worker proxy", () => {
  it("forwards the path and query to Cloud Run, without following redirects", async () => {
    const { sent } = await run(visit("/join/abc?ref=wa"));
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(`${ORIGIN}/join/abc?ref=wa`);
    expect(sent[0].init.redirect).toBe("manual");
  });

  it("never lets the path pick another upstream host", async () => {
    const { sent } = await run(visit("//evil.example/steal"));
    expect(new URL(sent[0].url).host).toBe(new URL(ORIGIN).host);
  });

  it("replaces client-sent forwarded and secret headers with its own", async () => {
    const { sent } = await run(
      visit("/dashboard", {
        headers: {
          "cf-connecting-ip": "203.0.113.7",
          "x-hisaab-proxy-secret": "guessed",
          "x-forwarded-for": "9.9.9.9",
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "http",
          "x-real-ip": "9.9.9.9",
          cookie: "a=1",
        },
      }),
    );
    const headers = new Headers(sent[0].init.headers);
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(headers.get("x-forwarded-host")).toBe(HOST);
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(headers.get("x-hisaab-proxy-secret")).toBe(env.PROXY_SECRET);
    expect(headers.get("x-real-ip")).toBeNull();
    expect(headers.get("cookie")).toBe("a=1");
  });

  it("sends no X-Forwarded-For at all when Cloudflare gave no client IP", async () => {
    const { sent } = await run(visit("/", { headers: { "x-forwarded-for": "9.9.9.9" } }));
    expect(new Headers(sent[0].init.headers).get("x-forwarded-for")).toBeNull();
  });

  it.each(["GET", "HEAD"])("sends no body with %s", async (method) => {
    const { sent } = await run(visit("/", { method }));
    expect(sent[0].init.method).toBe(method);
    expect(sent[0].init.body ?? null).toBeNull();
  });

  it("streams a POST body through", async () => {
    const { sent } = await run(visit("/api/auth/sign-in/magic-link", { method: "POST", body: '{"email":"a@b.c"}' }));
    expect(sent[0].init.method).toBe("POST");
    expect(sent[0].init.body).toBeInstanceOf(ReadableStream);
    expect(await new Response(sent[0].init.body).text()).toBe('{"email":"a@b.c"}');
  });

  it("points a redirect to Cloud Run's own URL back at the public host", async () => {
    const reply = new Response(null, { status: 302, headers: { location: `${ORIGIN}/sign-in?callbackURL=%2Fdashboard` } });
    const { res } = await run(visit("/dashboard"), reply);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://${HOST}/sign-in?callbackURL=%2Fdashboard`);
  });

  it.each(["/sign-in", "https://accounts.google.com/o/oauth2/v2/auth?x=1"])("leaves any other redirect alone: %s", async (location) => {
    const { res } = await run(visit("/"), new Response(null, { status: 302, headers: { location } }));
    expect(res.headers.get("location")).toBe(location);
  });

  it.each([
    ["a plain response", {}],
    ["a rewritten redirect", { location: `${ORIGIN}/dashboard` }],
  ])("keeps every Set-Cookie header on %s", async (_, extra) => {
    const headers = new Headers(extra);
    headers.append("set-cookie", "better-auth.session_token=abc; Path=/; HttpOnly");
    headers.append("set-cookie", "better-auth.session_data=def; Path=/; HttpOnly");
    const { res } = await run(visit("/api/auth/magic-link/verify"), new Response(null, { status: 302, headers }));
    expect(res.headers.getSetCookie()).toEqual([
      "better-auth.session_token=abc; Path=/; HttpOnly",
      "better-auth.session_data=def; Path=/; HttpOnly",
    ]);
  });

  it("streams the response without waiting for it to end (server-sent events)", async () => {
    // Never closes: a Worker that buffered the body would hang here.
    const events = new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode("data: 1\n\n")) });
    const { res } = await run(visit("/events"), new Response(events, { headers: { "content-type": "text/event-stream" } }));
    const { value } = await res.body!.getReader().read();
    expect(new TextDecoder().decode(value)).toBe("data: 1\n\n");
  });

  it("refuses to forward anything when PROXY_SECRET isn't set", async () => {
    const { res, sent } = await run(visit("/"), undefined, { ORIGIN });
    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/PROXY_SECRET/);
    expect(sent).toHaveLength(0);
  });
});
