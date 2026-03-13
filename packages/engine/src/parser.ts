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

  // Play condition: "You can use this card only if your opponent has exactly N Prize card(s) remaining"
  const prizeCondMatch = text.match(/you can use this card only if your opponent has exactly (\d+) prize cards? remaining/i);
  if (prizeCondMatch) {
    actions.push({ type: "play_condition", condition: "opponent_prizes", count: parseInt(prizeCondMatch[1], 10), exact: true });
  }

  const buddyBuddyPoffinMatch = text.match(
    /search your deck for up to (\d+) Basic Pok[eé]mon with (\d+) HP or less and put them onto your Bench/i,
  );
  if (buddyBuddyPoffinMatch) {
    actions.push({
      type: "search_deck",
      player: "self",
      count: parseInt(buddyBuddyPoffinMatch[1], 10),
      minCount: 0,
      destination: "bench",
      category: "Pokemon",
      stage: "Basic",
      maxHp: parseInt(buddyBuddyPoffinMatch[2], 10),
      filter: `Basic Pokemon with ${buddyBuddyPoffinMatch[2]} HP or less`,
    });
    return actions;
  }

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
    const condition = coinCondMatch[2] as SpecialCondition;
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

  // Boss's Orders style: "Switch in 1 of your opponent's Benched Pokemon to the Active Spot"
  if (/switch in.*opponent'?s? benched.*active spot/i.test(text)) {
    actions.push({ type: "switch_pokemon", player: "opponent" });
  }
  // Opponent switch: "Switch your opponent's Active Pokemon"
  else if (/switch.*opponent'?s? active/i.test(text)) {
    actions.push({ type: "switch_pokemon", player: "opponent" });
  }
  // Self-switch: "Switch this/your Active Pokemon with 1 of your Benched Pokemon"
  if (/switch (?:this|your active) pok[eé]mon with (?:1|one) of your benched/i.test(text)) {
    actions.push({ type: "switch_pokemon", player: "self" });
  }

  // Rare Candy: "Stage 2 card ... skipping the Stage 1"
  if (/stage 2.*skipping the stage 1/i.test(text)) {
    actions.push({ type: "rare_candy" });
  }

  // ---------------------------------------------------------------------------
  // Evolve-from-deck trainer cards
  // ---------------------------------------------------------------------------

  // Boost Shake: "Search your deck for a card that evolves from 1 of your Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck. You can use this card during your first turn or on a Pokémon that was put into play this turn. Your turn ends."
  if (/search your deck for a card that evolves from.*your pok[eé]mon.*evolve it.*you can use this card during your first turn.*your turn ends/is.test(text)) {
    actions.push({ type: "evolve_from_deck", count: 1, bypassFirstTurn: true, bypassSameTurn: true, endsTurn: true });
  }
  // Wally: "Search your deck for a card that evolves from 1 of your Pokémon (excluding Pokémon-EX)...You can use this card during your first turn or on a Pokémon that was put into play this turn."
  else if (/search your deck for a card that evolves from.*excluding pok[eé]mon.?EX.*you can use this card during your first turn/is.test(text)) {
    actions.push({ type: "evolve_from_deck", count: 1, bypassFirstTurn: true, bypassSameTurn: true, endsTurn: false, excludeSuffix: "EX" });
  }
  // Dusk Stone: "Search your deck for a Mismagius, Honchkrow, Chandelure, or Aegislash, including Pokémon-GX...You can use this card during your first turn"
  else if (/search your deck for a (Mismagius|Honchkrow|Chandelure|Aegislash).*evolves from.*you can use this card during your first turn/is.test(text)) {
    actions.push({ type: "evolve_from_deck", count: 1, bypassFirstTurn: true, bypassSameTurn: true, endsTurn: false, allowedNames: ["Mismagius", "Honchkrow", "Chandelure", "Aegislash"] });
  }
  // Salvatore: "Search your deck for a card that has no Abilities and evolves from 1 of your Pokémon...You can use this card on a Pokémon you put down when you were setting up to play or on a Pokémon that was put into play this turn."
  else if (/search your deck for a card that has no Abilities and evolves from/i.test(text)) {
    actions.push({ type: "evolve_from_deck", count: 1, bypassFirstTurn: false, bypassSameTurn: true, endsTurn: false, requireNoAbilities: true });
  }
  // Red & Blue: "Search your deck for a Pokémon-GX that evolves from 1 of your Pokémon...You can't use this card during your first turn"
  else if (/search your deck for a pok[eé]mon.?GX that evolves from/i.test(text)) {
    actions.push({ type: "evolve_from_deck", count: 1, bypassFirstTurn: false, bypassSameTurn: false, endsTurn: false, requireSuffix: "GX" });
  }
  // Pokémon Breeder's Nurturing: "Choose up to 2 of your Pokémon in play. For each of those Pokémon, search your deck for a card that evolves from that Pokémon...You can't use this card during your first turn"
  else if (/choose up to 2.*search your deck for a card that evolves from that pok[eé]mon/is.test(text)) {
    actions.push({ type: "evolve_from_deck", count: 2, bypassFirstTurn: false, bypassSameTurn: false, endsTurn: false });
  }
  // Evosoda (generic): "Search your deck for a card that evolves from 1 of your Pokémon and put it onto that Pokémon...You can't use this card during your first turn"
  else if (/search your deck for a card that evolves from.*your pok[eé]mon.*evolve.*you can't use this card during your first turn/is.test(text)) {
    actions.push({ type: "evolve_from_deck", count: 1, bypassFirstTurn: false, bypassSameTurn: false, endsTurn: false });
  }

  // ---------------------------------------------------------------------------
  // Stadium evolution effects
  // ---------------------------------------------------------------------------

  // Forest of Vitality: "Each player's {G} Pokémon can evolve into {G} Pokémon during the turn they play those Pokémon, except during their first turn."
  if (/pok[eé]mon can evolve.*during the turn they play those pok[eé]mon.*except during their first turn/is.test(text)) {
    actions.push({ type: "stadium_evolve_timing", bypassSameTurn: true, bypassFirstTurn: false, typeFilter: "Grass" });
  }

  // Grand Tree: "search their deck for a Stage 1 Pokémon that evolves from 1 of their Basic Pokémon...Stage 2 Pokémon that evolves from that Pokémon"
  if (/search their deck for a Stage 1.*evolves from.*basic.*Stage 2.*evolves from that/is.test(text)) {
    actions.push({ type: "stadium_chained_evolution" });
  }

  // Pokémon Research Lab: "search their deck for up to 2 Pokémon that evolve from Unidentified Fossil"
  if (/search their deck for up to (\d+) pok[eé]mon that evolve from Unidentified Fossil/i.test(text)) {
    actions.push({ type: "stadium_fossil_evolution", count: 2, endsTurn: true });
  }

  // Shuffle and draw: "Shuffle your hand into your deck. Then, draw N cards"
  const shuffleDrawMatch = text.match(/shuffle your hand into your deck.*draw (\d+) cards?/i);
  if (shuffleDrawMatch) {
    actions.push({ type: "shuffle_hand_draw", player: "self", drawCount: parseInt(shuffleDrawMatch[1], 10) });
    // Remove the earlier draw action if we matched shuffle+draw
    const drawIdx = actions.findIndex((a) => a.type === "draw");
    if (drawIdx !== -1) actions.splice(drawIdx, 1);
  }

  // ---------------------------------------------------------------------------
  // Trainer-specific effect patterns
  // ---------------------------------------------------------------------------

  // Judge: "Each player shuffles their hand into their deck and draws N cards"
  const shuffleAllDrawMatch = text.match(/each player shuffles their hand into their deck and draws? (\d+) cards?/i);
  if (shuffleAllDrawMatch) {
    const count = parseInt(shuffleAllDrawMatch[1], 10);
    actions.push({ type: "shuffle_all_draw", selfDraw: count, opponentDraw: count });
    // Remove earlier draw/shuffle_hand_draw if present
    for (let i = actions.length - 2; i >= 0; i--) {
      if (actions[i].type === "draw" || actions[i].type === "shuffle_hand_draw") actions.splice(i, 1);
    }
  }

  // Conditional shuffle-and-draw replacement:
  // "Shuffle your hand into your deck. Then, draw N cards. If [condition], draw M cards instead."
  const conditionalShuffleDrawMatch = text.match(
    /shuffle your hand into your deck.*draw (\d+) cards?\.\s*(?:if|when) (.+?)(?:,|\.)\s*draw (\d+) cards? instead/i,
  );
  if (conditionalShuffleDrawMatch) {
    actions.push({
      type: "conditional_shuffle_draw",
      defaultDraw: parseInt(conditionalShuffleDrawMatch[1], 10),
      conditionalDraw: parseInt(conditionalShuffleDrawMatch[3], 10),
      condition: conditionalShuffleDrawMatch[2].trim(),
    });
    for (let i = actions.length - 2; i >= 0; i--) {
      if (actions[i].type === "draw" || actions[i].type === "shuffle_hand_draw" || actions[i].type === "conditional_draw") {
        actions.splice(i, 1);
      }
    }
  }

  // Iono: "Each player shuffles their hand and puts it on the bottom of their deck"
  if (/each player shuffles their hand and puts it on the bottom of their deck/i.test(text) && /draws? .* cards? for each of their remaining prize cards?/i.test(text)) {
    actions.push({ type: "iono_effect" });
    // Remove earlier draw if present
    for (let i = actions.length - 2; i >= 0; i--) {
      if (actions[i].type === "draw") actions.splice(i, 1);
    }
  }

  // Draw until: "Draw cards until you have N cards in your hand"
  const drawUntilMatch = text.match(/draw cards? until you have (\d+) cards? in your hand/i);
  if (drawUntilMatch) {
    actions.push({ type: "draw_until", player: "self", count: parseInt(drawUntilMatch[1], 10) });
    // Remove earlier draw if present
    for (let i = actions.length - 2; i >= 0; i--) {
      if (actions[i].type === "draw") actions.splice(i, 1);
    }
  }

  // Conditional draw: "Draw N cards. If [condition], draw N more cards"
  const conditionalDrawMatch = text.match(/draw (\d+) cards?\..*(?:if|when) (.+?)(?:,|\.)\s*(?:you may )?draw (\d+) (?:more |additional )?cards?/i);
  if (conditionalDrawMatch && !/draw \d+ cards? instead/i.test(text)) {
    actions.push({
      type: "conditional_draw",
      baseDraw: parseInt(conditionalDrawMatch[1], 10),
      bonusDraw: parseInt(conditionalDrawMatch[3], 10),
      condition: conditionalDrawMatch[2].trim(),
    });
    // Remove earlier draw if present
    for (let i = actions.length - 2; i >= 0; i--) {
      if (actions[i].type === "draw") actions.splice(i, 1);
    }
  }

  // Move energy: "Move up to N Energy from ... to ..."
  const moveEnergyMatch = text.match(/move (?:up to )?(\d+) energy/i);
  if (moveEnergyMatch && !/from your opponent/i.test(text)) {
    const from: "any" | "bench" | "active" = /from.*bench/i.test(text) ? "bench" : "any";
    const to: "any" | "active" = /to.*active/i.test(text) ? "active" : "any";
    actions.push({ type: "move_energy", count: parseInt(moveEnergyMatch[1], 10), from, to });
  }

  // Scoop up (return Pokemon + attached to hand):
  // Penny: "Put 1 of your Basic Pokémon ... and all attached cards into your hand"
  // Scoop Up Cyclone: "Put 1 of your Pokémon ... and all attached cards into your hand"
  if (/put (?:1|one) of your.*pok[eé]mon.*(?:and )?all attached cards into your hand/i.test(text)) {
    const target: "basic" | "any" = /basic pok[eé]mon/i.test(text) ? "basic" : "any";
    actions.push({ type: "scoop_up", target, keepAttached: true });
  }
  // Professor Turo style: "Put 1 of your Pokémon ... into your hand" + discard attached
  else if (/put (?:1|one) of your.*pok[eé]mon.*into your hand.*discard all (?:cards )?attached/i.test(text)) {
    actions.push({ type: "scoop_up", target: "any", keepAttached: false });
  }

  // Recover from discard to hand: "Put up to N ... from your discard pile into your hand"
  const recoverHandMatch = text.match(/put (?:up to )?(\d+|a|an) (.+?) from your discard pile into your hand/i);
  if (recoverHandMatch) {
    const countStr = recoverHandMatch[1];
    const count = countStr === "a" || countStr === "an" ? 1 : parseInt(countStr, 10);
    const description = recoverHandMatch[2].toLowerCase();
    let category: string | undefined;
    let filter: string | undefined;
    if (/basic energy/i.test(description)) { category = "Energy"; filter = "Basic Energy"; }
    else if (/energy/i.test(description)) { category = "Energy"; }
    else if (/pok[eé]mon/i.test(description)) { category = "Pokemon"; }
    else if (/supporter/i.test(description)) { category = "Trainer"; filter = "Supporter"; }
    else if (/item/i.test(description)) { category = "Trainer"; filter = "Item"; }
    else { filter = description; }
    actions.push({ type: "recover_from_discard", count, destination: "hand", category, filter });
  }

  // Shuffle from discard into deck: "Shuffle up to N ... from your discard pile into your deck"
  const recoverDeckMatch = text.match(/shuffle (?:up to )?(\d+|a|an) (.+?) from your discard pile into your deck/i);
  if (recoverDeckMatch) {
    const countStr = recoverDeckMatch[1];
    const count = countStr === "a" || countStr === "an" ? 1 : parseInt(countStr, 10);
    const description = recoverDeckMatch[2].toLowerCase();
    let category: string | undefined;
    let filter: string | undefined;
    if (/basic energy/i.test(description)) { category = "Energy"; filter = "Basic Energy"; }
    else if (/energy/i.test(description)) { category = "Energy"; }
    else if (/pok[eé]mon/i.test(description)) { category = "Pokemon"; }
    else { filter = description; }
    actions.push({ type: "recover_from_discard", count, destination: "deck", category, filter });
  }

  // Look at top N cards: "Look at the top N cards of your deck"
  const lookAtTopMatch = text.match(/look at the top (\d+) cards? of your deck/i);
  if (lookAtTopMatch) {
    const count = parseInt(lookAtTopMatch[1], 10);
    // Determine how many to take and the filter
    const takeCountMatch = text.match(/(?:reveal|put|take) (?:up to )?(\d+|a|an) /i);
    const takeCount = takeCountMatch ? (takeCountMatch[1] === "a" || takeCountMatch[1] === "an" ? 1 : parseInt(takeCountMatch[1], 10)) : 1;
    let filter: string | undefined;
    if (/pok[eé]mon/i.test(text) && !/supporter/i.test(text)) filter = "Pokemon";
    else if (/supporter/i.test(text)) filter = "Supporter";
    else if (/energy/i.test(text)) filter = "Energy";
    const remainder: "shuffle_back" | "bottom" = /(?:shuffle|put).*(?:back|rest)/i.test(text) ? "shuffle_back" : "bottom";
    actions.push({ type: "look_at_top", count, takeCount, filter, destination: "hand", remainder });
  }

  // Heal from each of your Pokemon: "Heal X damage from each of your Pokémon"
  const trainerHealAllMatch = text.match(/heal (\d+) damage from each of your pok[eé]mon/i);
  if (trainerHealAllMatch) {
    actions.push({ type: "heal_all", amount: parseInt(trainerHealAllMatch[1], 10), target: "all_own" });
    // Remove earlier generic heal if present
    for (let i = actions.length - 2; i >= 0; i--) {
      if (actions[i].type === "heal") actions.splice(i, 1);
    }
  }

  // Heal from each of your type Pokemon: "Heal X damage from each of your {Type} Pokémon"
  const trainerHealTypeMatch = text.match(/heal (\d+) damage from each of your \{?(\w+)\}? pok[eé]mon/i);
  if (trainerHealTypeMatch && !trainerHealAllMatch) {
    actions.push({ type: "heal_all", amount: parseInt(trainerHealTypeMatch[1], 10), target: "all_type", typeFilter: trainerHealTypeMatch[2] });
    for (let i = actions.length - 2; i >= 0; i--) {
      if (actions[i].type === "heal") actions.splice(i, 1);
    }
  }

  // Heal from your Active Pokemon: "Heal X damage from your Active Pokémon"
  const trainerHealActiveMatch = text.match(/heal (\d+) damage from your active pok[eé]mon/i);
  if (trainerHealActiveMatch) {
    actions.push({ type: "heal_target", amount: parseInt(trainerHealActiveMatch[1], 10), target: "active" });
    // Remove earlier generic heal if present
    for (let i = actions.length - 2; i >= 0; i--) {
      if (actions[i].type === "heal") actions.splice(i, 1);
    }
  }

  // Heal all damage from 1 Pokemon: "Heal all damage from 1 of your Pokémon"
  if (/heal all damage from (?:1|one) of your pok[eé]mon/i.test(text)) {
    actions.push({ type: "heal_target", amount: "all", target: "any" });
    for (let i = actions.length - 2; i >= 0; i--) {
      if (actions[i].type === "heal") actions.splice(i, 1);
    }
  }

  // Heal from 1 of your Pokemon: "Heal X damage from 1 of your Pokémon"
  const trainerHealAnyMatch = text.match(/heal (\d+) damage from (?:1|one) of your pok[eé]mon/i);
  if (trainerHealAnyMatch && !trainerHealAllMatch) {
    actions.push({ type: "heal_target", amount: parseInt(trainerHealAnyMatch[1], 10), target: "any" });
    for (let i = actions.length - 2; i >= 0; i--) {
      if (actions[i].type === "heal") actions.splice(i, 1);
    }
  }

  // Discard Tools/Special Energy from opponent:
  // Megaton Blower: "Discard all Pokémon Tools and Special Energy attached to your opponent's Pokémon"
  if (/discard all pok[eé]mon tools?.*special energy.*opponent/i.test(text)) {
    actions.push({ type: "discard_opponent_tool", count: 99, includeSpecialEnergy: true, includeStadium: /stadium/i.test(text) });
  }
  // Enhanced Hammer: "Discard a Special Energy attached to 1 of your opponent's Pokémon"
  else if (/discard (?:a|1|one) special energy.*opponent/i.test(text)) {
    actions.push({ type: "discard_opponent_tool", count: 1, includeSpecialEnergy: true, includeStadium: false });
  }
  // Tool Scrapper: "Choose up to N Pokémon Tools ... and discard them"
  else if (/choose up to (\d+) pok[eé]mon tools?.*discard them/i.test(text)) {
    const toolMatch = text.match(/choose up to (\d+)/i);
    actions.push({ type: "discard_opponent_tool", count: toolMatch ? parseInt(toolMatch[1], 10) : 2, includeSpecialEnergy: false, includeStadium: false });
  }

  // Opponent hand reveal and discard: "your opponent reveals their hand. You may discard up to N [type] cards"
  const opponentHandMatch = text.match(/opponent reveals their hand.*discard up to (\d+) (\w+) cards?/i);
  if (opponentHandMatch) {
    actions.push({
      type: "opponent_hand_reveal_discard",
      count: parseInt(opponentHandMatch[1], 10),
      cardType: opponentHandMatch[2],
    });
  }

  // Discard cards from hand: "discard N cards from your hand"
  // (must be before search_deck so that "discard then search" cards execute in order)
  const discardCardMatch = text.match(/discard (\d+|a|an) (?:other )?cards? from your hand/i);
  if (discardCardMatch) {
    const countStr = discardCardMatch[1];
    const count = countStr === "a" || countStr === "an" ? 1 : parseInt(countStr, 10);
    actions.push({ type: "discard_card", source: "hand", count });
  }

  // Search deck
  const searchMatch = text.match(/search your deck for (?:up to )?(\d+|a|an|any number of) /i);
  if (searchMatch) {
    const countStr = searchMatch[1];
    const isAnyNumber = /any number/i.test(countStr);
    const count = isAnyNumber ? 99 : countStr === "a" || countStr === "an" ? 1 : parseInt(countStr, 10);
    const isUpTo = isAnyNumber || /up to/i.test(searchMatch[0]) || /up to/i.test(text);
    const destination: "hand" | "bench" = /onto your Bench|to your Bench/i.test(text) ? "bench" : "hand";

    // Determine what we're searching for from the text after "search your deck for [up to] N"
    let category: CardData["category"] | undefined;
    let stage: Stage | undefined;
    let trainerType: TrainerType | undefined;
    let suffix: string | undefined;
    let maxHp: number | undefined;
    let filter: string | undefined;

    // "Basic Pokémon" → category Pokemon, stage Basic
    if (/basic pok[eé]mon/i.test(text)) {
      category = "Pokemon";
      stage = "Basic";
    }
    // "Evolution Pokémon" → category Pokemon, evolution filter
    else if (/evolution pok[eé]mon/i.test(text)) {
      category = "Pokemon";
      filter = "Evolution Pokemon";
    }
    // "Pokémon ex" → category Pokemon, suffix ex
    else if (/pok[eé]mon ex\b/i.test(text)) {
      category = "Pokemon";
      suffix = "ex";
    }
    // "Pokémon Tool card" → category Trainer, trainerType Tool
    else if (/pok[eé]mon tool card/i.test(text)) {
      category = "Trainer";
      trainerType = "Tool";
    }
    // "Item card" → category Trainer, trainerType Item
    else if (/item cards?\b/i.test(text)) {
      category = "Trainer";
      trainerType = "Item";
    }
    // "Supporter card" → category Trainer, trainerType Supporter
    else if (/supporter cards?\b/i.test(text)) {
      category = "Trainer";
      trainerType = "Supporter";
    }
    // "Stadium card" → category Trainer, trainerType Stadium
    else if (/stadium cards?\b/i.test(text)) {
      category = "Trainer";
      trainerType = "Stadium";
    }
    // "Trainer card" → category Trainer
    else if (/trainer cards?\b/i.test(text)) {
      category = "Trainer";
    }
    // "Energy card" or "Basic Energy" → category Energy
    else if (/energy cards?\b/i.test(text) || /basic energy/i.test(text)) {
      category = "Energy";
    }
    // Generic "Pokémon" (must be last Pokémon check)
    else if (/for (?:up to )?(?:\d+|a|an) (?:\w+ )*pok[eé]mon/i.test(text)) {
      category = "Pokemon";
    }

    // Extract "with X HP or less"
    const hpMatch = text.match(/with (\d+) HP or less/i);
    if (hpMatch) {
      maxHp = parseInt(hpMatch[1], 10);
    }

    actions.push({
      type: "search_deck",
      player: "self",
      count,
      minCount: isUpTo ? 0 : count,
      destination,
      category,
      stage,
      trainerType,
      suffix,
      maxHp,
      filter,
    });
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


  // Put damage counters on opponent's Benched Pokemon (1 counter = 10 damage)
  const dmgCounterBenchMatch = text.match(/put (\d+) damage counters? on (?:(?:1|one|each) of )?your opponent'?s? benched pok[eé]mon/i);
  if (dmgCounterBenchMatch) {
    actions.push({ type: "damage", target: "bench", amount: parseInt(dmgCounterBenchMatch[1], 10) * 10 });
  }
  // Put damage counters on opponent's Pokemon (any — targets bench as approximation)
  else {
    const dmgCounterAnyMatch = text.match(/put (\d+) damage counters? on (?:(?:1|one) of )?your opponent'?s? pok[eé]mon/i);
    if (dmgCounterAnyMatch) {
      actions.push({ type: "damage", target: "bench", amount: parseInt(dmgCounterAnyMatch[1], 10) * 10 });
    }
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

  // ---------------------------------------------------------------------------
  // Attack-specific effect patterns
  // ---------------------------------------------------------------------------

  // Flip until tails: "Flip a coin until you get tails. This attack does X more damage for each heads."
  const flipUntilTailsMatch = text.match(/flip a coin until you get tails.*does (\d+) (?:more )?damage (?:for each|times|×|x) (?:the number of )?heads/i);
  if (flipUntilTailsMatch) {
    actions.push({
      type: "flip_until_tails",
      perHeads: [{ type: "damage", target: "defender", amount: parseInt(flipUntilTailsMatch[1], 10) }],
    });
  }

  // Damage ignoring weakness/resistance/effects: "This attack's damage isn't affected by Weakness or Resistance"
  if (/this attack'?s? damage isn'?t affected by weakness or resistance/i.test(text)) {
    actions.push({ type: "damage_ignore_effects" });
  }

  // Before doing damage, discard all Pokemon Tools from opponent's Active Pokemon
  if (/before doing damage.*discard all pok[eé]mon tools? from your opponent'?s? active/i.test(text)) {
    actions.push({ type: "discard_tools_before_damage" });
  }

  // Copy attack: "Choose 1 of your opponent's Active Pokemon's attacks and use it as this attack"
  if (/choose (?:1|one) of your opponent'?s? active pok[eé]mon'?s? attacks? and use it/i.test(text)) {
    actions.push({ type: "copy_attack" });
  }

  // Self-evolve: "Search your deck for a card that evolves from this Pokemon and put it onto this Pokemon to evolve it"
  if (/search your deck for a card that evolves from this pok[eé]mon.*put it onto this pok[eé]mon/i.test(text)) {
    actions.push({ type: "self_evolve" });
  }

  // Deck mill: "Discard the top N cards of your opponent's deck"
  const deckMillMatch = text.match(/discard the top (\d+) cards? of your opponent'?s? deck/i);
  if (deckMillMatch) {
    actions.push({ type: "deck_mill", count: parseInt(deckMillMatch[1], 10) });
  }

  // Discard opponent energy: "Discard an Energy from your opponent's Active Pokemon"
  const discardOppEnergyMatch = text.match(/discard (\d+|an?) (?:(\w+) )?energy from your opponent'?s? active pok[eé]mon/i);
  if (discardOppEnergyMatch) {
    const countStr = discardOppEnergyMatch[1];
    const count = countStr === "a" || countStr === "an" ? 1 : parseInt(countStr, 10);
    actions.push({ type: "discard_opponent_energy", count, energyType: "any" });
  }

  // Hand disruption — random discard: "Discard a random card from your opponent's hand"
  if (/discard a random card from your opponent'?s? hand/i.test(text)) {
    actions.push({ type: "hand_disruption", mode: "random_discard", count: 1 });
  }

  // Hand disruption — opponent discards: "Your opponent discards N cards from their hand"
  const oppDiscardMatch = text.match(/your opponent discards (\d+) cards? from their hand/i);
  if (oppDiscardMatch) {
    actions.push({ type: "hand_disruption", mode: "opponent_discards", count: parseInt(oppDiscardMatch[1], 10) });
  }

  // Opponent hand reveal+shuffle: "Choose a random card from opponent's hand. They reveal it and shuffle it into their deck."
  if (/choose a random card from.*opponent'?s? hand.*reveal.*shuffle.*into their deck/i.test(text)) {
    actions.push({ type: "opponent_hand_reveal_shuffle", count: 1 });
  }

  // Damage prevention from Basic Pokemon: "prevent all damage done to this Pokemon by attacks from Basic Pokemon"
  if (/prevent all damage.*(?:done )?to this pok[eé]mon.*(?:by )?attacks from basic pok[eé]mon/i.test(text)) {
    actions.push({ type: "damage_reduction", amount: 9999, turns: 1, fromBasicOnly: true });
  }

  // Damage reduction: "this Pokemon takes X less damage from attacks"
  const dmgReductionMatch = text.match(/this pok[eé]mon takes (\d+) less damage from attacks/i);
  if (dmgReductionMatch) {
    actions.push({ type: "damage_reduction", amount: parseInt(dmgReductionMatch[1], 10), turns: 1 });
  }

  // Item lock: "they can't play any Item cards from their hand"
  if (/(?:opponent'?s?|they) can'?t play (?:any )?item cards? from their hand/i.test(text)) {
    actions.push({ type: "item_lock", turns: 1 });
  }

  // Damage per energy on both active: "X more damage for each Energy attached to both Active Pokemon"
  const dmgPerEnergyBothMatch = text.match(/does (\d+) more damage for each energy attached to both active pok[eé]mon/i);
  if (dmgPerEnergyBothMatch) {
    actions.push({ type: "damage_per_energy", amount: parseInt(dmgPerEnergyBothMatch[1], 10), source: "both" });
  }
  // Damage per energy on opponent: "X more damage for each Energy attached to your opponent's Active Pokemon"
  else {
    const dmgPerEnergyOppMatch = text.match(/does (\d+) more damage for each energy attached to your opponent'?s? active pok[eé]mon/i);
    if (dmgPerEnergyOppMatch) {
      actions.push({ type: "damage_per_energy", amount: parseInt(dmgPerEnergyOppMatch[1], 10), source: "defender" });
    }
  }

  // Damage for each energy attached to this Pokemon: "does X damage for each Energy attached to this Pokemon"
  const dmgForEachEnergySelfMatch = text.match(/does (\d+) damage for each energy attached to this pok[eé]mon/i);
  if (dmgForEachEnergySelfMatch) {
    actions.push({ type: "damage_per_energy", amount: parseInt(dmgForEachEnergySelfMatch[1], 10), source: "self" });
  }

  // Damage for specific energy type: "X more damage for each {W} Energy attached to this Pokemon"
  const dmgForEnergyTypeMatch = text.match(/does (\d+) more damage for each \{(\w)\} energy attached to this pok[eé]mon/i);
  if (dmgForEnergyTypeMatch) {
    const energyMap: Record<string, EnergyType> = { G: "Grass", R: "Fire", W: "Water", L: "Lightning", P: "Psychic", F: "Fighting", D: "Darkness", M: "Metal", Y: "Fairy", N: "Dragon", C: "Colorless" };
    const eType = energyMap[dmgForEnergyTypeMatch[2].toUpperCase()] ?? "Colorless";
    actions.push({ type: "damage_for_energy_type", amount: parseInt(dmgForEnergyTypeMatch[1], 10), energyType: eType });
  }

  // Damage per damage counter on self: "X damage/more for each damage counter on this Pokemon"
  const dmgPerCounterSelfMatch = text.match(/does (\d+) (?:more )?damage for each damage counter on this pok[eé]mon/i);
  if (dmgPerCounterSelfMatch) {
    actions.push({ type: "damage_per_damage_counter", amount: parseInt(dmgPerCounterSelfMatch[1], 10), source: "self" });
  }

  // Damage less for each damage counter on self: "X less damage for each damage counter on this Pokemon"
  const dmgLessPerCounterMatch = text.match(/does (\d+) less damage for each damage counter on this pok[eé]mon/i);
  if (dmgLessPerCounterMatch) {
    actions.push({ type: "damage_per_damage_counter", amount: -parseInt(dmgLessPerCounterMatch[1], 10), source: "self" });
  }

  // Damage per damage counter on opponent: "X more damage for each damage counter on your opponent's Active Pokemon"
  const dmgPerCounterOppMatch = text.match(/does (\d+) (?:more )?damage for each damage counter on your opponent'?s? active pok[eé]mon/i);
  if (dmgPerCounterOppMatch) {
    actions.push({ type: "damage_per_damage_counter", amount: parseInt(dmgPerCounterOppMatch[1], 10), source: "defender" });
  }

  // Damage per bench — opponent: "X more damage for each of your opponent's Benched Pokemon"
  const dmgPerBenchOppMatch = text.match(/does (\d+) more damage for each of your opponent'?s? benched pok[eé]mon/i);
  if (dmgPerBenchOppMatch) {
    actions.push({ type: "damage_per_bench", amount: parseInt(dmgPerBenchOppMatch[1], 10), whose: "opponent" });
  }

  // Damage per bench — both: "X more damage for each Benched Pokemon (both yours and your opponent's)"
  const dmgPerBenchBothMatch = text.match(/does (\d+) more damage for each benched pok[eé]mon.*both/i);
  if (dmgPerBenchBothMatch) {
    actions.push({ type: "damage_per_bench", amount: parseInt(dmgPerBenchBothMatch[1], 10), whose: "both" });
  }

  // Conditional damage — ex or V: "If your opponent's Active Pokemon is a Pokemon ex or Pokemon V, this attack does X more damage"
  const condDmgExVMatch = text.match(/opponent'?s? active pok[eé]mon is a pok[eé]mon ex or pok[eé]mon v.*does (\d+) more damage/i);
  if (condDmgExVMatch) {
    actions.push({ type: "conditional_damage", amount: parseInt(condDmgExVMatch[1], 10), condition: "ex_or_v" });
  }

  // Conditional damage — has damage counters: "If opponent's Active Pokemon already has any damage counters, X more damage"
  const condDmgHasDamageMatch = text.match(/opponent'?s? active pok[eé]mon (?:already )?has (?:any )?damage counters?.*does (\d+) more damage/i);
  if (condDmgHasDamageMatch) {
    actions.push({ type: "conditional_damage", amount: parseInt(condDmgHasDamageMatch[1], 10), condition: "has_damage" });
  }

  // Conditional damage — has special condition: "If opponent's Active Pokemon is affected by a Special Condition, X more damage"
  const condDmgSpecCondMatch = text.match(/opponent'?s? active pok[eé]mon is affected by a special condition.*does (\d+) more damage/i);
  if (condDmgSpecCondMatch) {
    actions.push({ type: "conditional_damage", amount: parseInt(condDmgSpecCondMatch[1], 10), condition: "has_special_condition" });
  }

  // Bench snipe — opponent: "This attack does X damage to 1 of your opponent's Pokemon"
  const benchSnipeMatch = text.match(/this attack does (\d+) damage to (?:1|one) of your opponent'?s? pok[eé]mon/i);
  if (benchSnipeMatch) {
    actions.push({ type: "bench_snipe", amount: parseInt(benchSnipeMatch[1], 10), whose: "opponent" });
  }

  // Bench snipe via "also does X damage to 1 of your opponent's Benched Pokemon"
  const benchSnipeAlsoMatch = text.match(/also does (\d+) damage to (?:1|one) of your opponent'?s? benched pok[eé]mon/i);
  if (benchSnipeAlsoMatch) {
    actions.push({ type: "bench_snipe", amount: parseInt(benchSnipeAlsoMatch[1], 10), whose: "opponent" });
  }

  // Bench snipe — spread to opponent bench: "also does X damage to each of opponent's Benched Pokemon"
  const spreadOppBenchMatch = text.match(/also does (\d+) damage to each of (?:your )?opponent'?s? benched pok[eé]mon/i);
  if (spreadOppBenchMatch) {
    actions.push({ type: "damage", target: "bench", amount: parseInt(spreadOppBenchMatch[1], 10) });
  }

  // Self bench damage: "also does X damage to each of your Benched Pokemon"
  const selfBenchDmgMatch = text.match(/also does (\d+) damage to (?:each of )?your benched pok[eé]mon/i);
  if (selfBenchDmgMatch) {
    actions.push({ type: "bench_damage_self", amount: parseInt(selfBenchDmgMatch[1], 10) });
  }

  // Self condition — confused: "This Pokemon is now Confused"
  if (/this pok[eé]mon is now confused/i.test(text)) {
    actions.push({ type: "self_condition", condition: "Confused" });
  }

  // Self condition — recover all: "This Pokemon recovers from all Special Conditions"
  if (/this pok[eé]mon recovers from all special conditions/i.test(text)) {
    actions.push({ type: "self_condition", condition: "recover_all" });
  }

  // Damage for retreat cost: "X more damage for each {C} in opponent's Active Pokemon's Retreat Cost"
  const dmgRetreatMatch = text.match(/does (\d+) more damage for each \{C\} in (?:your )?opponent'?s? active pok[eé]mon'?s? retreat cost/i);
  if (dmgRetreatMatch) {
    actions.push({ type: "damage_for_retreat_cost", amount: parseInt(dmgRetreatMatch[1], 10) });
  }

  // Damage per tool: "X damage for each Pokemon Tool attached to all of your Pokemon"
  const dmgPerToolMatch = text.match(/does (\d+) damage for each pok[eé]mon tool attached to (?:all of )?your pok[eé]mon/i);
  if (dmgPerToolMatch) {
    actions.push({ type: "damage_per_tool", amount: parseInt(dmgPerToolMatch[1], 10) });
  }

  // Damage per prize taken by opponent: "X damage for each Prize card your opponent has taken"
  const dmgPerPrizeMatch = text.match(/does (\d+) damage for each prize card your opponent has taken/i);
  if (dmgPerPrizeMatch) {
    actions.push({ type: "damage_per_prize", amount: parseInt(dmgPerPrizeMatch[1], 10), whose: "opponent" });
  }

  // Discard stadium (conditional for extra damage): "You may discard a Stadium in play. If you do, this attack does X more damage"
  const discardStadiumDmgMatch = text.match(/you may discard a stadium in play.*does (\d+) more damage/i);
  if (discardStadiumDmgMatch) {
    actions.push({ type: "discard_stadium", conditional: true });
    actions.push({ type: "conditional_stadium_damage", amount: parseInt(discardStadiumDmgMatch[1], 10) });
  }
  // Discard stadium (plain): "You may discard a Stadium in play"
  else if (/you may discard a stadium in play/i.test(text)) {
    actions.push({ type: "discard_stadium", conditional: false });
  }

  // Return energy to hand: "Put N Energy attached to this Pokemon into your hand"
  const returnEnergyMatch = text.match(/put (\d+|an?) energy attached to this pok[eé]mon into your hand/i);
  if (returnEnergyMatch) {
    const countStr = returnEnergyMatch[1];
    const count = countStr === "a" || countStr === "an" ? 1 : parseInt(countStr, 10);
    actions.push({ type: "return_energy_to_hand", count });
  }

  // Bounce self to hand: "Put this Pokemon and all attached cards into your hand"
  if (/put this pok[eé]mon and all attached cards into your hand/i.test(text)) {
    actions.push({ type: "bounce_self_to_hand" });
  }

  // Heal equal to damage dealt: "Heal from this Pokemon the same amount of damage you did"
  if (/heal.*(?:from )?this pok[eé]mon.*(?:the )?same amount of damage/i.test(text)) {
    actions.push({ type: "heal_equal_to_damage" });
  }

  // Extra prize: "take N more Prize card(s)"
  const extraPrizeMatch = text.match(/take (\d+) more prize cards?/i);
  if (extraPrizeMatch) {
    actions.push({ type: "extra_prize", count: parseInt(extraPrizeMatch[1], 10) });
  }

  // Flip a coin, tails can't attack: "Flip a coin. If tails, during your next turn, this Pokemon can't attack"
  if (/flip a coin.*if tails.*(?:during your next turn.*)?(?:this pok[eé]mon )?can'?t attack/i.test(text) && !lower.includes("does nothing")) {
    // Don't duplicate if we already matched the simpler coin_flip pattern
    if (!actions.some(a => a.type === "coin_flip")) {
      actions.push({ type: "cant_attack_self_tails" });
    }
  }

  // Discard hand and draw (attack version): "Discard your hand and draw N cards"
  // Already handled above in the trainer section

  // Switch both: "Switch this Pokemon with 1 of your Benched Pokemon. If you do, switch out opponent's Active to Bench."
  // Already handled by self-switch above; opponent switch is additional
  if (/switch this pok[eé]mon.*benched.*switch.*opponent'?s? active/i.test(text)) {
    // Self switch already matched above; ensure opponent switch too
    if (!actions.some(a => a.type === "switch_pokemon" && a.player === "opponent")) {
      actions.push({ type: "switch_pokemon", player: "opponent" });
    }
  }

  // Search deck for supporter: "Search your deck for a Supporter card, reveal it, and put it into your hand"
  // Already handled by the generic search_deck pattern above

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
