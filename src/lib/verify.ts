export async function fetchJsonVerified<T = unknown>(url: string, name: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchTextVerified(url: string, name: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.text();
}
