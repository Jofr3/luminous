import type { CardListResponse } from "./types";

const API_URL = import.meta.env.PUBLIC_API_URL ?? "http://localhost:8787";

const cache = new Map<string, { data: CardListResponse; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function fetchCards(params: {
  q?: string;
  category?: string;
  set?: string;
  limit?: number;
  offset?: number;
}): Promise<CardListResponse> {
  const url = new URL("/api/cards", API_URL);

  if (params.q) url.searchParams.set("q", params.q);
  if (params.category) url.searchParams.set("category", params.category);
  if (params.set) url.searchParams.set("set", params.set);
  if (params.limit != null) url.searchParams.set("limit", String(params.limit));
  if (params.offset != null) url.searchParams.set("offset", String(params.offset));

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
  return data;
}
