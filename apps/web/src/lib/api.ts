import type { CardListResponse } from "./types";

const API_URL = import.meta.env.PUBLIC_API_URL ?? "http://localhost:8787";

export async function fetchCards(params: {
  page?: number;
  limit?: number;
  q?: string;
  category?: string;
  set?: string;
}): Promise<CardListResponse> {
  const url = new URL("/api/cards", API_URL);

  if (params.page) url.searchParams.set("page", String(params.page));
  if (params.limit) url.searchParams.set("limit", String(params.limit));
  if (params.q) url.searchParams.set("q", params.q);
  if (params.category) url.searchParams.set("category", params.category);
  if (params.set) url.searchParams.set("set", params.set);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json();
}
