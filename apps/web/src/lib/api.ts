import type {
  CardDetail,
  CardListResponse,
  DeckSummary,
  FilterOptions,
  SimulatorRulesResponse,
  SetListResponse,
} from "./types";
import type { SimulatorAction, SimulatorStore } from "@luminous/simulator-core";

export const API_URL =
  import.meta.env.VITE_API_URL ??
  import.meta.env.PUBLIC_API_URL ??
  "";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCardListResponse(value: unknown): value is CardListResponse {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.data) &&
    typeof value.total === "number" &&
    typeof value.hasMore === "boolean"
  );
}

function isCardDetail(value: unknown): value is CardDetail {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.local_id === "string" &&
    typeof value.name === "string" &&
    typeof value.category === "string" &&
    typeof value.set_id === "string"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function isFilterOptions(value: unknown): value is FilterOptions {
  if (!isRecord(value) || !isRecord(value.hp)) return false;

  return (
    isStringArray(value.categories) &&
    isStringArray(value.rarities) &&
    isStringArray(value.stages) &&
    isStringArray(value.trainer_types) &&
    isStringArray(value.energy_types) &&
    isStringArray(value.types) &&
    isStringArray(value.weaknesses) &&
    isStringArray(value.resistances) &&
    isNumberArray(value.retreats) &&
    typeof value.hp.min === "number" &&
    typeof value.hp.max === "number" &&
    isStringArray(value.regulation_marks)
  );
}

function hasDataEnvelope<T>(
  value: unknown,
  guard: (input: unknown) => input is T,
): value is { data: T } {
  return isRecord(value) && guard(value.data);
}

function parseJson<T>(
  value: unknown,
  guard: (input: unknown) => input is T,
  message: string,
): T {
  if (!guard(value)) {
    throw new Error(message);
  }

  return value;
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
  const data = parseJson(
    await res.json(),
    isCardListResponse,
    "Invalid cards payload",
  );
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
  const data = parseJson(
    await res.json(),
    isFilterOptions,
    "Invalid filters payload",
  );
  filtersCache.data = data;
  filtersCache.ts = performance.now();
  return data;
}

export async function fetchSets(): Promise<SetListResponse> {
  const res = await fetch(`${API_URL}/api/sets`);
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  const payload = parseJson(
    await res.json(),
    (value): value is { data: SetListResponse["data"] } => hasDataEnvelope(value, Array.isArray),
    "Invalid sets payload",
  );

  return { data: payload.data };
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

  const payload = await res.json();
  if (!hasDataEnvelope(payload, isCardDetail)) {
    throw new Error("Invalid card detail payload");
  }

  cardDetailCache.set(key, { data: payload.data, ts: performance.now() });
  evictOldest(cardDetailCache);
  return payload.data;
}

function isDeckListResponse(
  value: unknown,
): value is { data: DeckSummary[] } {
  return hasDataEnvelope(value, Array.isArray);
}

function isRuleStatus(value: unknown): value is { allowed: boolean; reason: string | null } {
  return (
    isRecord(value) &&
    typeof value.allowed === "boolean" &&
    (typeof value.reason === "string" || value.reason === null)
  );
}

function isAttackRule(value: unknown): value is SimulatorRulesResponse["attacks"][number] {
  return (
    isRecord(value) &&
    typeof value.index === "number" &&
    typeof value.name === "string" &&
    isRuleStatus(value)
  );
}

function isAbilityRule(value: unknown): value is SimulatorRulesResponse["abilities"][number] {
  return (
    isRecord(value) &&
    typeof value.pokemonUid === "string" &&
    typeof value.abilityIdx === "number" &&
    typeof value.name === "string" &&
    isRuleStatus(value)
  );
}

function isRuleStatusMap(value: unknown): value is Record<string, { allowed: boolean; reason: string | null }> {
  return isRecord(value) && Object.values(value).every(isRuleStatus);
}

function isHandCardRules(value: unknown): value is SimulatorRulesResponse["hand"][string] {
  return (
    isRecord(value) &&
    isRuleStatus(value.active) &&
    isRuleStatus(value.bench) &&
    isRuleStatus(value.stadium) &&
    isRuleStatus(value.trainerUse) &&
    isRuleStatusMap(value.benchPokemon)
  );
}

function isSimulatorRulesResponse(value: unknown): value is SimulatorRulesResponse {
  return (
    isRecord(value) &&
    (value.currentPlayer === 0 || value.currentPlayer === 1) &&
    typeof value.locked === "boolean" &&
    isRuleStatus(value.endTurn) &&
    isRuleStatus(value.stadiumAbility) &&
    Array.isArray(value.attacks) &&
    value.attacks.every(isAttackRule) &&
    Array.isArray(value.abilities) &&
    value.abilities.every(isAbilityRule) &&
    isRuleStatusMap(value.retreatTargets) &&
    isRecord(value.hand) &&
    Object.values(value.hand).every(isHandCardRules)
  );
}

function isUnknownValue(_value: unknown): _value is unknown {
  return true;
}

export async function fetchDecks(): Promise<DeckSummary[]> {
  const res = await fetch(`${API_URL}/api/decks`);
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  const payload = parseJson(
    await res.json(),
    isDeckListResponse,
    "Invalid decks payload",
  );
  return payload.data;
}

export async function fetchSimulatorRules(store: unknown): Promise<SimulatorRulesResponse> {
  const res = await fetch(`${API_URL}/api/simulator/rules`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ store }),
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  const payload = parseJson(
    await res.json(),
    (value): value is { data: SimulatorRulesResponse } => hasDataEnvelope(value, isSimulatorRulesResponse),
    "Invalid simulator rules payload",
  );

  return payload.data;
}

export async function applySimulatorAction(store: unknown, action: SimulatorAction): Promise<unknown> {
  const res = await fetch(`${API_URL}/api/simulator/apply-action`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ store, action }),
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  const payload = parseJson(
    await res.json(),
    (value): value is { data: unknown } => hasDataEnvelope(value, isUnknownValue),
    "Invalid simulator action payload",
  );

  return payload.data;
}

export async function createSimulatorGame(deck1: string, deck2: string): Promise<SimulatorStore> {
  const res = await fetch(`${API_URL}/api/simulator/new-game`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ deck1, deck2 }),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => null) as { error?: string; details?: string[] } | null;
    throw new Error(payload?.details?.[0] ?? payload?.error ?? `API error: ${res.status}`);
  }

  const payload = parseJson(
    await res.json(),
    (value): value is { data: SimulatorStore } => hasDataEnvelope(value, isUnknownValue),
    "Invalid simulator game payload",
  );

  return payload.data;
}
