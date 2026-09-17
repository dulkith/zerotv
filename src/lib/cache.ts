const store = new Map<string, { data: unknown; exp: number }>();

export function cacheGet<T>(key: string): T | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) { store.delete(key); return null; }
  return e.data as T;
}

export function cacheSet(key: string, data: unknown, ttlMs: number) {
  if (store.size > 200) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
  store.set(key, { data, exp: Date.now() + ttlMs });
}

export async function cachedFetch<T>(url: string, ttlMs: number, init?: RequestInit): Promise<T> {
  const cached = cacheGet<T>(url);
  if (cached !== null) return cached;
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status}`);
  const data = (await res.json()) as T;
  cacheSet(url, data, ttlMs);
  return data;
}
