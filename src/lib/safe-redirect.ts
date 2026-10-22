// Only ever used as a throwaway base to resolve a relative URL; nothing is fetched from it.
const BASE = "http://hisaab.invalid";

/**
 * Returns `url` only if it is a same-site path ("/join/abc?x=1"); anything else (another origin,
 * "//host", "/\host", missing) gives `fallback`. Use it on every `callbackURL` that comes from a request.
 */
export function safeCallback(url: string | null | undefined, fallback = "/dashboard"): string {
  if (!url?.startsWith("/") || url.startsWith("//") || url.startsWith("/\\")) return fallback;
  // Browsers drop tabs and newlines inside a URL, so "/\t/evil.com" is really "//evil.com". Resolving it catches that.
  return new URL(url, BASE).origin === BASE ? url : fallback;
}

/**
 * The proxy sets this request header to the path being visited (pathname + search), so server code can send people
 * back there after sign-in. A client can send it too on routes the proxy doesn't cover: run it through safeCallback.
 */
export const RETURN_TO_HEADER = "x-hisaab-path";
