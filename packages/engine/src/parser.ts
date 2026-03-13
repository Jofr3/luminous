import type {
  CardAbility,
  CardAttack,
  CardData,
  DamageMod,
  EffectAction,
  EnergyType,
  SpecialCondition,
  Stage,
  TrainerType,
  TypeModifier,
} from "./types";

// ---------------------------------------------------------------------------
// Raw DB row → CardData parser
// ---------------------------------------------------------------------------

interface RawCardRow {
  id: string;
  name: string;
  category: string;
  hp?: number | null;
  types?: string | null;
  stage?: string | null;
  suffix?: string | null;
  evolve_from?: string | null;
  retreat?: number | null;
  attacks?: string | null;
  abilities?: string | null;
  weaknesses?: string | null;
  resistances?: string | null;
  effect?: string | null;
  trainer_type?: string | null;
  energy_type?: string | null;
  image?: string | null;
  set_id?: string;
  [key: string]: unknown;
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function parseDamage(raw: string | number | null | undefined): { base: number; mod: DamageMod; raw: string } {
  if (raw == null || raw === "") return { base: 0, mod: null, raw: "" };
  const str = String(raw).trim();

  // "40+" → base 40, mod "+"
  const plusMatch = str.match(/^(\d+)\+$/);
  if (plusMatch) return { base: parseInt(plusMatch[1], 10), mod: "+", raw: str };

  // "30x" → base 30, mod "x"
  const multMatch = str.match(/^(\d+)[x×]$/);
  if (multMatch) return { base: parseInt(multMatch[1], 10), mod: "x", raw: str };

  // "20-" → base 20, mod "-"
  const minusMatch = str.match(/^(\d+)-$/);
  if (minusMatch) return { base: parseInt(minusMatch[1], 10), mod: "-", raw: str };

  // Plain number
  const num = parseInt(str, 10);
  if (!isNaN(num)) return { base: num, mod: null, raw: str };

  return { base: 0, mod: null, raw: str };
}

interface RawAttack {
  name?: string;
  cost?: string[];
  damage?: string | number;
  effect?: string;
}

function parseRawAttack(raw: RawAttack): CardAttack {
  const dmg = parseDamage(raw.damage);
  return {
    name: raw.name ?? "Unknown",
    cost: (raw.cost ?? []) as EnergyType[],
    damageBase: dmg.base,
    damageMod: dmg.mod,
    damageRaw: dmg.raw,
    effect: raw.effect ?? null,
  };
}

interface RawAbility {
  type?: string;
  name?: string;
  effect?: string;
}

function parseRawAbility(raw: RawAbility): CardAbility {
  return {
    type: raw.type ?? "Ability",
    name: raw.name ?? "Unknown",
    effect: raw.effect ?? "",
  };
}

interface RawTypeModifier {
  type?: string;
  value?: string;
}

function parseRawTypeModifier(raw: RawTypeModifier): TypeModifier {
  return {
    type: (raw.type ?? "Colorless") as EnergyType,
    value: raw.value ?? "×2",
  };
}

export function parseCardRow(row: RawCardRow): CardData {
  const rawAttacks = safeJsonParse<RawAttack[]>(row.attacks, []);
  const rawAbilities = safeJsonParse<RawAbility[]>(row.abilities, []);
  const rawWeaknesses = safeJsonParse<RawTypeModifier[]>(row.weaknesses, []);
  const rawResistances = safeJsonParse<RawTypeModifier[]>(row.resistances, []);
  const types = safeJsonParse<string[]>(row.types, []);

  return {
    id: row.id,
    name: row.name,
    category: row.category as CardData["category"],
    hp: row.hp ?? null,
    types: types as EnergyType[],
    stage: (row.stage as Stage) ?? null,
    suffix: row.suffix ?? null,
    evolveFrom: row.evolve_from ?? null,
    retreat: row.retreat ?? null,
    attacks: rawAttacks.map(parseRawAttack),
    abilities: rawAbilities.map(parseRawAbility),
    weaknesses: rawWeaknesses.map(parseRawTypeModifier),
    resistances: rawResistances.map(parseRawTypeModifier),
    effect: row.effect ?? null,
    trainerType: (row.trainer_type as TrainerType) ?? null,
    energyType: row.energy_type ?? null,
    image: row.image ?? null,
    setId: row.set_id ?? "",
  };
}

// ---------------------------------------------------------------------------
// Effect text → EffectAction[] pattern matcher
// ---------------------------------------------------------------------------

export function parseEffectText(text: string | null): EffectAction[] {
  if (!text) return [];
  const actions: EffectAction[] = [];
  const lower = text.toLowerCase();

  // Coin flip with damage prevention
  if (/flip a coin.*if heads.*prevent all damage/i.test(text)) {
    actions.push({
      type: "coin_flip",
      onHeads: [{ type: "prevent_damage", turns: 1 }],
      onTails: [],
    });
    return actions;
  }

  // Coin flip: "If tails, this attack does nothing"
  if (/flip a coin.*if tails.*does nothing/i.test(text)) {
    actions.push({
      type: "coin_flip",
      onHeads: [],
      onTails: [{ type: "custom", description: "This attack does nothing." }],
    });
    return actions;
  }

  // Coin flip with extra damage: "If heads, this attack does X more damage"
  const coinExtraDmgMatch = text.match(/flip a coin.*if heads.*does (\d+) more damage/i);
  if (coinExtraDmgMatch) {
    actions.push({
      type: "coin_flip",
      onHeads: [{ type: "damage", target: "defender", amount: parseInt(coinExtraDmgMatch[1], 10) }],
      onTails: [],
    });
    return actions;
  }

  // Coin flip with special condition
  const coinCondMatch = text.match(/flip a coin.*if heads.*(?:the defending|your opponent's active) pok[eé]mon is now (Asleep|Burned|Confused|Paralyzed|Poisoned)/i);
  if (coinCondMatch) {
    const condition = coinCondMatch[1] as SpecialCondition;
    actions.push({
      type: "coin_flip",
      onHeads: [{ type: "special_condition", target: "defender", condition }],
      onTails: [],
    });
    return actions;
  }

  // Direct special condition: "The Defending Pokemon is now X" / "Your opponent's Active Pokemon is now X"
  const directCondMatch = text.match(/(?:the defending|your opponent's active) pok[eé]mon is now (Asleep|Burned|Confused|Paralyzed|Poisoned)/i);
  if (directCondMatch && !lower.includes("flip")) {
    actions.push({
      type: "special_condition",
      target: "defender",
      condition: directCondMatch[1] as SpecialCondition,
    });
  }

  // Self-damage: "does X damage to itself" / "also does X damage to itself"
  const selfDmgMatch = text.match(/does (\d+) damage to itself/i);
  if (selfDmgMatch) {
    actions.push({ type: "damage", target: "self", amount: parseInt(selfDmgMatch[1], 10) });
  }

  // Discard energy: "Discard N Energy/energy cards"
  const discardEnergyMatch = text.match(/discard (\d+|an?) (?:(\w+) )?energy/i);
  if (discardEnergyMatch) {
    const countStr = discardEnergyMatch[1];
    const count = countStr === "a" || countStr === "an" ? 1 : parseInt(countStr, 10);
    const energyTypeWord = discardEnergyMatch[2];
    const energyType: EnergyType | "any" = energyTypeWord && isEnergyTypeName(energyTypeWord) ? energyTypeWord as EnergyType : "any";
    actions.push({ type: "discard_energy", target: "self", count, energyType });
  }

  // Discard hand and draw: "Discard your hand and draw N cards"
  const discardHandDrawMatch = text.match(/discard your hand and draw (\d+) cards?/i);
  if (discardHandDrawMatch) {
    actions.push({ type: "shuffle_hand_draw", player: "self", drawCount: parseInt(discardHandDrawMatch[1], 10) });
    return actions;
  }

  // Draw cards: "Draw N cards" or "Draw a card"
  const drawMatch = text.match(/draw (\d+|a) cards?/i);
  if (drawMatch && !lower.includes("shuffle your hand")) {
    const countStr = drawMatch[1];
    const count = countStr === "a" ? 1 : parseInt(countStr, 10);
    actions.push({ type: "draw", player: "self", count });
  }

  // Heal: "Heal N damage"
  const healMatch = text.match(/heal (\d+) damage/i);
  if (healMatch) {
    actions.push({ type: "heal", target: "self", amount: parseInt(healMatch[1], 10) });
  }

  // Bench damage: "does X damage to N of your opponent's Benched Pokemon"
  const benchDmgMatch = text.match(/does? (\d+) damage to (?:\d+ of )?your opponent'?s? benched pok[eé]mon/i);
  if (benchDmgMatch) {
    actions.push({ type: "damage", target: "bench", amount: parseInt(benchDmgMatch[1], 10) });
  }

  // Self-switch: "Switch this Pokemon with 1 of your Benched Pokemon"
  if (/switch (?:this|your active) pok[eé]mon with (?:1|one) of your benched/i.test(text)) {
    actions.push({ type: "switch_pokemon", player: "self" });
  }
  // Opponent switch: "Switch your opponent's Active Pokemon"
  else if (/switch.*opponent'?s? active/i.test(text)) {
    actions.push({ type: "switch_pokemon", player: "opponent" });
  }

  // Shuffle and draw: "Shuffle your hand into your deck. Then, draw N cards"
  const shuffleDrawMatch = text.match(/shuffle your hand into your deck.*draw (\d+) cards?/i);
  if (shuffleDrawMatch) {
    actions.push({ type: "shuffle_hand_draw", player: "self", drawCount: parseInt(shuffleDrawMatch[1], 10) });
    // Remove the earlier draw action if we matched shuffle+draw
    const drawIdx = actions.findIndex((a) => a.type === "draw");
    if (drawIdx !== -1) actions.splice(drawIdx, 1);
  }

  // Search deck
  const searchMatch = text.match(/search your deck for (?:up to )?(\d+|a|an) /i);
  if (searchMatch) {
    const countStr = searchMatch[1];
    const count = countStr === "a" || countStr === "an" ? 1 : parseInt(countStr, 10);
    actions.push({ type: "search_deck", player: "self", count });
  }

  // Energy acceleration from discard
  if (/attach.*energy.*from your discard/i.test(text)) {
    const accMatch = text.match(/attach (?:up to )?(\d+|a|an) /i);
    const count = accMatch ? (accMatch[1] === "a" || accMatch[1] === "an" ? 1 : parseInt(accMatch[1], 10)) : 1;
    actions.push({ type: "energy_accelerate", source: "discard", count });
  }

  // Energy acceleration from hand: "attach ... Energy card from your hand"
  if (/attach.*energy.*from your hand/i.test(text) && !lower.includes("discard")) {
    const accMatch = text.match(/attach (?:up to )?(\d+|a|an) /i);
    const count = accMatch ? (accMatch[1] === "a" || accMatch[1] === "an" ? 1 : parseInt(accMatch[1], 10)) : 1;
    actions.push({ type: "energy_accelerate", source: "hand", count });
  }

  // Bounce to hand
  if (/return.*defending.*to.*hand/i.test(text) || /put.*defending.*into.*hand/i.test(text)) {
    actions.push({ type: "bounce", target: "defender", destination: "hand" });
  }
  // Bounce to deck
  else if (/shuffle.*defending.*into.*deck/i.test(text) || /put.*defending.*into.*deck/i.test(text)) {
    actions.push({ type: "bounce", target: "defender", destination: "deck" });
  }

  // Discard cards from hand: "discard N cards from your hand"
  const discardCardMatch = text.match(/discard (\d+|a|an) (?:other )?cards? from your hand/i);
  if (discardCardMatch) {
    const countStr = discardCardMatch[1];
    const count = countStr === "a" || countStr === "an" ? 1 : parseInt(countStr, 10);
    actions.push({ type: "discard_card", source: "hand", count });
  }

  // Multi-coin flip damage: "Flip N coins. This attack does X damage times the number of heads."
  const multiCoinMatch = text.match(/flip (\d+) coins?.*does (\d+) damage (?:times|for each|×|x) (?:the number of )?heads/i);
  if (multiCoinMatch) {
    actions.push({
      type: "multi_coin_flip",
      coins: parseInt(multiCoinMatch[1], 10),
      perHeads: [{ type: "damage", target: "defender", amount: parseInt(multiCoinMatch[2], 10) }],
    });
  }

  // Can't attack next turn: "During your next turn, this Pokemon can't attack"
  if (/during your next turn.*can'?t attack/i.test(text)) {
    actions.push({ type: "cant_attack", turns: 1 });
  }

  // Can't retreat: "The Defending Pokemon can't retreat during your opponent's next turn"
  if (/can'?t retreat/i.test(text)) {
    actions.push({ type: "cant_retreat", turns: 1 });
  }

  // Ignore resistance
  if (/(?:isn'?t|not) affected by resistance/i.test(text) || /don'?t apply resistance/i.test(text)) {
    actions.push({ type: "ignore_resistance" });
  }

  // If no patterns matched, create a custom action with the full text
  if (actions.length === 0 && text.trim().length > 0) {
    actions.push({ type: "custom", description: text });
  }

  return actions;
}

const ENERGY_TYPE_NAMES = new Set([
  "grass", "fire", "water", "lightning", "psychic",
  "fighting", "darkness", "metal", "fairy", "dragon", "colorless",
]);

function isEnergyTypeName(word: string): boolean {
  return ENERGY_TYPE_NAMES.has(word.toLowerCase());
}
