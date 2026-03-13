import { fetchCardById, fetchCards } from "~/lib/api";
import type { CardDetail, CardSummary } from "~/lib/types";
import type {
  CardInstance,
  DeckLine,
  PlayerBoard,
  PokemonInPlay,
  SimulatorStore,
} from "./types";

let uidCounter = 0;

export function nextUid(): string {
  uidCounter += 1;
  return `sim-${uidCounter}`;
}

export function syncUidCounterFromStore(store: SimulatorStore): void {
  let maxUid = 0;

  const readUid = (uid: string | null | undefined) => {
    if (!uid) return;
    const match = uid.match(/^sim-(\d+)$/);
    if (!match) return;
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed)) {
      maxUid = Math.max(maxUid, parsed);
    }
  };

  for (const player of store.players) {
    for (const card of player.deck) readUid(card.uid);
    for (const card of player.hand) readUid(card.uid);
    for (const card of player.prizes) readUid(card.uid);
    for (const card of player.discard) readUid(card.uid);

    readUid(player.active?.uid);
    readUid(player.active?.base.uid);
    for (const card of player.active?.attached ?? []) readUid(card.uid);

    for (const pokemon of player.bench) {
      readUid(pokemon.uid);
      readUid(pokemon.base.uid);
      for (const card of pokemon.attached) readUid(card.uid);
    }
  }

  uidCounter = Math.max(uidCounter, maxUid);
}

export function appendLog(store: SimulatorStore, message: string): void {
  store.logs = [message, ...store.logs].slice(0, 150);
}

export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function drawFromDeck(player: PlayerBoard, count: number): CardInstance[] {
  const out: CardInstance[] = [];
  for (let i = 0; i < count && player.deck.length > 0; i += 1) {
    const card = player.deck.shift();
    if (card) out.push(card);
  }
  return out;
}

export function isBasicPokemon(card: CardSummary): boolean {
  return card.category === "Pokemon" && card.stage === "Basic";
}

export function isEvolutionPokemon(card: CardSummary): boolean {
  return card.category === "Pokemon" && card.stage !== "Basic" && card.stage != null;
}

export function canEvolvePokemon(
  evoCard: CardSummary,
  target: PokemonInPlay,
  store: SimulatorStore,
  options?: { rareCandy?: boolean },
): { ok: boolean; reason?: string } {
  if (!isEvolutionPokemon(evoCard))
    return { ok: false, reason: `${evoCard.name} is not an evolution card.` };
  const targetStage = target.base.card.stage;
  if (options?.rareCandy) {
    // Rare Candy: Stage 2 can evolve directly from Basic
    if (evoCard.stage !== "Stage2")
      return { ok: false, reason: `Rare Candy can only be used with Stage 2 Pokémon.` };
    if (targetStage !== "Basic")
      return { ok: false, reason: `Rare Candy can only target a Basic Pokémon, not ${targetStage}.` };
  } else {
    // Normal stage validation: Stage 1 from Basic, Stage 2 from Stage 1
    if (evoCard.stage === "Stage1" && targetStage !== "Basic")
      return { ok: false, reason: `${evoCard.name} (Stage 1) can only evolve from a Basic Pokemon.` };
    if (evoCard.stage === "Stage2" && targetStage !== "Stage1")
      return { ok: false, reason: `${evoCard.name} (Stage 2) can only evolve from a Stage 1 Pokemon, not ${targetStage}.` };
  }
  // If evolve_from is known, validate the name match
  // For Rare Candy, evolve_from points to the Stage 1 name, so skip this check
  if (!options?.rareCandy && evoCard.evolve_from && evoCard.evolve_from !== target.base.card.name)
    return { ok: false, reason: `${evoCard.name} evolves from ${evoCard.evolve_from}, not ${target.base.card.name}.` };
  // Check stadium-based evolution timing bypass (e.g. Forest of Vitality for Grass)
  const stadiumBypass = getStadiumEvolveBypass(store, evoCard, target);
  // Cannot evolve on either player's first turn (turns 1 and 2)
  if (store.turnNumber <= 2 && !stadiumBypass.bypassFirstTurn)
    return { ok: false, reason: `Cannot evolve on a player's first turn.` };
  // Cannot evolve a Pokemon on the same turn it was played/evolved
  if (target.turnPlayedOrEvolved >= store.turnNumber && !stadiumBypass.bypassSameTurn)
    return { ok: false, reason: `${target.base.card.name} was played or evolved this turn.` };
  return { ok: true };
}

/** Check if an active stadium grants evolution timing bypasses */
function getStadiumEvolveBypass(
  store: SimulatorStore,
  evoCard: CardSummary,
  target: PokemonInPlay,
): { bypassFirstTurn: boolean; bypassSameTurn: boolean } {
  if (!store.stadium) return { bypassFirstTurn: false, bypassSameTurn: false };
  const effect = store.stadium.card.card.effect;
  if (!effect) return { bypassFirstTurn: false, bypassSameTurn: false };

  // Forest of Vitality: Grass Pokemon can evolve into Grass Pokemon during the turn played (not first turn)
  if (/pok[eé]mon can evolve.*during the turn they play those pok[eé]mon.*except during their first turn/is.test(effect)) {
    const targetIsGrass = target.base.card.types?.includes("Grass");
    const evoIsGrass = evoCard.types?.includes("Grass");
    if (targetIsGrass && evoIsGrass) {
      return { bypassFirstTurn: false, bypassSameTurn: true };
    }
  }

  return { bypassFirstTurn: false, bypassSameTurn: false };
}

export function makePokemonInPlay(instance: CardInstance, turnNumber = 0): PokemonInPlay {
  return {
    uid: nextUid(),
    base: instance,
    damage: 0,
    attached: [],
    specialConditions: [],
    poisonDamage: 10,
    burnDamage: 20,
    turnPlayedOrEvolved: turnNumber,
    usedAbilityThisTurn: false,
  };
}

export function createEmptyPlayer(): PlayerBoard {
  return {
    deck: [],
    hand: [],
    prizes: [],
    discard: [],
    active: null,
    bench: [],
    takenPrizes: 0,
    mulligans: 0,
    trainerUseZone: [],
    energyAttachedThisTurn: false,
    supporterPlayedThisTurn: false,
    retreatedThisTurn: false,
  };
}

export function parseDecklist(input: string): { lines: DeckLine[]; errors: string[] } {
  const lines: DeckLine[] = [];
  const errors: string[] = [];

  const rawLines = input
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("#") && !l.startsWith("//"));

  for (const raw of rawLines) {
    const m = raw.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (!m) {
      errors.push(`Could not parse line: \"${raw}\"`);
      continue;
    }

    const qty = parseInt(m[1], 10);
    const query = m[2].trim();

    if (!qty || qty < 1) {
      errors.push(`Invalid quantity in line: \"${raw}\"`);
      continue;
    }

    if (!query) {
      errors.push(`Missing card name/id in line: \"${raw}\"`);
      continue;
    }

    lines.push({ qty, query });
  }

  return { lines, errors };
}

function looksLikeCardId(query: string): boolean {
  return /^[a-z0-9.]+\-\d+[a-z]?$/i.test(query.trim());
}

function summaryFromDetail(detail: CardDetail): CardSummary {
  return {
    id: detail.id,
    local_id: detail.local_id,
    name: detail.name,
    image: detail.image,
    category: detail.category,
    rarity: detail.rarity,
    hp: detail.hp,
    stage: detail.stage ?? null,
    trainer_type: detail.trainer_type ?? null,
    energy_type: detail.energy_type ?? null,
    suffix: detail.suffix ?? null,
    evolve_from: detail.evolve_from ?? null,
    retreat: detail.retreat ?? null,
    effect: detail.effect ?? null,
    types: detail.types ?? [],
    attacks: detail.attacks ?? [],
    abilities: detail.abilities ?? [],
    weaknesses: detail.weaknesses ?? [],
    resistances: detail.resistances ?? [],
    set_id: detail.set_id,
    set_name: detail.set_name,
  };
}

function normalizeName(v: string): string {
  return v.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function resolveCardSummary(store: SimulatorStore, query: string): Promise<CardSummary | null> {
  const key = normalizeName(query);
  if (store.nameQueryCache[key] !== undefined) {
    return store.nameQueryCache[key];
  }

  if (looksLikeCardId(query)) {
    try {
      const detail = await fetchCardById(query.trim());
      const summary = summaryFromDetail(detail);
      store.nameQueryCache[key] = summary;
      return summary;
    } catch {
      store.nameQueryCache[key] = null;
      return null;
    }
  }

  const res = await fetchCards({ q: query, limit: 100 });
  if (res.data.length === 0) {
    store.nameQueryCache[key] = null;
    return null;
  }

  const exact = res.data.find((c) => normalizeName(c.name) === key) ?? res.data[0];
  store.nameQueryCache[key] = exact;
  return exact;
}

export async function buildDeckFromInput(store: SimulatorStore, input: string, label: string): Promise<CardInstance[] | null> {
  const parsed = parseDecklist(input);
  if (parsed.errors.length > 0) {
    for (const err of parsed.errors) appendLog(store, `${label}: ${err}`);
    return null;
  }

  const uniqueQueries = [...new Set(parsed.lines.map((line) => line.query))];
  const summaries = new Map<string, CardSummary | null>();

  await Promise.all(
    uniqueQueries.map(async (query) => {
      summaries.set(query, await resolveCardSummary(store, query));
    }),
  );

  const deck: CardInstance[] = [];
  for (const line of parsed.lines) {
    const summary = summaries.get(line.query) ?? null;
    if (!summary) {
      appendLog(store, `${label}: card not found for \"${line.query}\".`);
      return null;
    }

    for (let i = 0; i < line.qty; i += 1) {
      deck.push({ uid: nextUid(), card: summary });
    }
  }

  if (deck.length !== 60) {
    appendLog(store, `${label}: deck has ${deck.length} cards. It must have exactly 60.`);
    return null;
  }

  return shuffle(deck);
}

export function removeHandCard(player: PlayerBoard, uid: string): CardInstance | null {
  const idx = player.hand.findIndex((c) => c.uid === uid);
  if (idx === -1) return null;
  const [card] = player.hand.splice(idx, 1);
  return card ?? null;
}

export function removeBenchPokemon(player: PlayerBoard, uid: string): PokemonInPlay | null {
  const idx = player.bench.findIndex((p) => p.uid === uid);
  if (idx === -1) return null;
  const [slot] = player.bench.splice(idx, 1);
  return slot ?? null;
}

export function removePrizeCard(player: PlayerBoard, uid: string): CardInstance | null {
  const idx = player.prizes.findIndex((c) => c.uid === uid);
  if (idx === -1) return null;
  const [card] = player.prizes.splice(idx, 1);
  return card ?? null;
}

export function hasBasicInHand(hand: CardInstance[]): boolean {
  return hand.some((c) => isBasicPokemon(c.card));
}

export function autoMulliganUntilBasic(player: PlayerBoard): boolean {
  if (!hasBasicInHand([...player.hand, ...player.deck])) {
    return false;
  }

  while (!hasBasicInHand(player.hand)) {
    player.mulligans += 1;
    player.deck = shuffle([...player.deck, ...player.hand]);
    player.hand = drawFromDeck(player, 7);
  }

  return true;
}

export function canAct(store: SimulatorStore, playerIdx: 0 | 1, action: string): boolean {
  if (store.winner !== null) return false;

  if (store.phase !== "playing") {
    appendLog(store, `Cannot ${action} before setup is finalized.`);
    return false;
  }

  if (store.currentTurn !== playerIdx) {
    appendLog(store, `only current player can ${action}.`);
    return false;
  }

  return true;
}
