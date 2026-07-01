// Truncate a long hex/base58 identifier (address, hash) for display:
// "0x1234…cdef". head/tail are the kept character counts on each side.
export function shortAddr(value: string, head = 6, tail = 4): string {
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
