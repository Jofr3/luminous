import type { CardDetail, CardListResponse, FilterOptions } from "./types";

export const API_URL =
  import.meta.env.VITE_API_URL ??
  import.meta.env.PUBLIC_API_URL ??
  "http://localhost:8787";

export function imageUrl(key: string | null): string | null {
  if (!key) return null;
  return `${API_URL}/images/${key}`;
}

const MAX_CACHE_SIZE = 200;
const cache = new Map<string, { data: CardListResponse; ts: number }>();
const cardDetailCache = new Map<string, { data: CardDetail; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function evictOldest(map: Map<string, { ts: number }>) {
  if (map.size <= MAX_CACHE_SIZE) return;
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [key, entry] of map) {
    if (entry.ts < oldestTs) {
      oldestTs = entry.ts;
      oldestKey = key;
    }
  }
  if (oldestKey) map.delete(oldestKey);
}

export async function fetchCards(params: {
  q?: string;
  category?: string;
  set?: string;
  limit?: number;
  offset?: number;
  rarity?: string;
  stage?: string;
  trainer_type?: string;
  energy_type?: string;
  retreat?: string;
  hp_min?: string;
  hp_max?: string;
  types?: string;
  weakness?: string;
  resistance?: string;
  legal_standard?: string;
  legal_expanded?: string;
}): Promise<CardListResponse> {
  const url = new URL("/api/cards", API_URL);

  if (params.q) url.searchParams.set("q", params.q);
  if (params.category) url.searchParams.set("category", params.category);
  if (params.set) url.searchParams.set("set", params.set);
  if (params.limit != null) url.searchParams.set("limit", String(params.limit));
  if (params.offset != null) url.searchParams.set("offset", String(params.offset));
  if (params.rarity) url.searchParams.set("rarity", params.rarity);
  if (params.stage) url.searchParams.set("stage", params.stage);
  if (params.trainer_type) url.searchParams.set("trainer_type", params.trainer_type);
  if (params.energy_type) url.searchParams.set("energy_type", params.energy_type);
  if (params.retreat) url.searchParams.set("retreat", params.retreat);
  if (params.hp_min) url.searchParams.set("hp_min", params.hp_min);
  if (params.hp_max) url.searchParams.set("hp_max", params.hp_max);
  if (params.types) url.searchParams.set("types", params.types);
  if (params.weakness) url.searchParams.set("weakness", params.weakness);
  if (params.resistance) url.searchParams.set("resistance", params.resistance);
  if (params.legal_standard) url.searchParams.set("legal_standard", params.legal_standard);
  if (params.legal_expanded) url.searchParams.set("legal_expanded", params.legal_expanded);

  const key = url.toString();
  const cached = cache.get(key);
  if (cached && performance.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  const res = await fetch(key);
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  const data: CardListResponse = await res.json();
  cache.set(key, { data, ts: performance.now() });
  evictOldest(cache);
  return data;
}

const filtersCache: { data: FilterOptions | null; ts: number } = { data: null, ts: 0 };

export async function fetchFilters(): Promise<FilterOptions> {
  if (filtersCache.data && performance.now() - filtersCache.ts < CACHE_TTL) {
    return filtersCache.data;
  }

  const res = await fetch(`${API_URL}/api/cards/filters`);
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  const data: FilterOptions = await res.json();
  filtersCache.data = data;
  filtersCache.ts = performance.now();
  return data;
}

export async function fetchCardById(id: string): Promise<CardDetail> {
  const key = id.trim();
  if (!key) throw new Error("Card id is required");

  const cached = cardDetailCache.get(key);
  if (cached && performance.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  const res = await fetch(`${API_URL}/api/cards/${encodeURIComponent(key)}`);
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  const payload = await res.json() as { data: CardDetail };
  cardDetailCache.set(key, { data: payload.data, ts: performance.now() });
  evictOldest(cardDetailCache);
  return payload.data;
}
