// Truncate a long hex/base58 identifier (address, hash) for display:
// "0x1234…cdef". head/tail are the kept character counts on each side.
export function shortAddr(value: string, head = 6, tail = 4): string {
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

// Shorten a URL for display as "host/path/0x1234…": drops the protocol,
// keeps the path, and truncates a long final path segment (the address/hash
// an explorer link points at) rather than the whole URL. Falls back to the
// input unchanged if it isn't a parseable absolute URL.
export function shortLink(url: string, head = 8): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    if (last.length > head) {
      segments[segments.length - 1] = `${last.slice(0, head)}...`;
    }
  }
  const path = segments.length > 0 ? `/${segments.join("/")}` : "";
  return `${host}${path}`;
}
