// BASE_URL arrives from humans as often as from CI, and humans type bare
// hostnames ("atlas.redline.support"). fetch() refuses a scheme-less URL with
// an opaque "Failed to parse URL", so normalize once here — both
// playwright.config.ts and global-setup.ts consume this — instead of letting
// every downstream request fail the same way.

const LOOPBACK_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)(:\d+)?$/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Trim, strip trailing slashes, and default a missing scheme (https, or http
 * for loopback hosts). Returns undefined for unset/blank input; throws with a
 * usable message for input that cannot become a valid http(s) URL.
 */
export function normalizeBaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let candidate = raw.trim().replace(/\/+$/, "");
  if (!candidate) return undefined;
  if (!HAS_SCHEME.test(candidate)) {
    const scheme = LOOPBACK_HOST.test(candidate) ? "http" : "https";
    candidate = `${scheme}://${candidate}`;
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(
      `BASE_URL ${JSON.stringify(raw)} is not a valid URL (tried ${JSON.stringify(candidate)})`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`BASE_URL ${JSON.stringify(raw)} must use http or https, got ${url.protocol}`);
  }
  return candidate;
}
