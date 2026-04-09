import type { AddressInfo } from "../types";

let cached: Promise<Record<string, AddressInfo>> | null = null;

export function loadAddresses(): Promise<Record<string, AddressInfo>> {
  if (!cached) {
    cached = fetch(`${import.meta.env.BASE_URL}addresses.json`).then((r) => r.json());
  }
  return cached;
}
