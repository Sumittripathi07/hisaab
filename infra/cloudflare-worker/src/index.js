// Reverse proxy from hisab.sumittripathi.dev to the hisaab-web Cloud Run service (asia-south1 has no Cloud Run domain
// mapping). Every request gets the shared secret the app's proxy gate checks (src/proxy.ts), so the run.app URL alone
// is refused once the gate is on. See README.md next to this folder.

// Client-sent copies are dropped: only this Worker may set them.
const STRIPPED = ["x-hisaab-proxy-secret", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "host"];

/**
 * @param {Request} request
 * @param {{ ORIGIN: string, PROXY_SECRET?: string }} env
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<Response>}
 */
export async function proxy(request, env, fetchImpl = fetch) {
  // Forwarding without the secret would only get 403s, or worse, work against a gate that's off by mistake.
  if (!env.PROXY_SECRET) return new Response("Proxy misconfigured: PROXY_SECRET is not set.", { status: 500 });

  const incoming = new URL(request.url);
  const origin = new URL(env.ORIGIN);
  // Concatenated, not new URL(path, origin): a path like "//evil.example" would otherwise switch hosts.
  const upstream = new URL(origin.origin + incoming.pathname + incoming.search);

  const headers = new Headers(request.headers);
  for (const name of STRIPPED) headers.delete(name);
  const clientIp = request.headers.get("cf-connecting-ip"); // set by Cloudflare, never by the client
  if (clientIp) headers.set("x-forwarded-for", clientIp);
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", "https");
  headers.set("x-hisaab-proxy-secret", env.PROXY_SECRET);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const response = await fetchImpl(upstream, {
    method: request.method,
    headers,
    body: hasBody ? request.body : null,
    redirect: "manual",
  });

  const location = response.headers.get("location");
  if (!location || !URL.canParse(location) || new URL(location).origin !== origin.origin) return response;
  // Copying the response keeps its body as a stream and every Set-Cookie header; only Location changes.
  const rewritten = new Response(response.body, response);
  const target = new URL(location);
  target.host = incoming.host;
  rewritten.headers.set("location", target.href);
  return rewritten;
}

const worker = { fetch: (request, env) => proxy(request, env) };
export default worker;
