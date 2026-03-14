import type { EffectAction, GameState as EngineGameState } from "@luminous/engine";
import type { CardInstance, CardSummary, PlayerBoard, PokemonInPlay, SimulatorStore } from "./types";
import { toEngineBoard, toEngineCardInstance } from "./engine-bridge";

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

function getStadiumEvolveBypass(
  store: SimulatorStore,
  evoCard: CardSummary,
  target: PokemonInPlay,
): { bypassFirstTurn: boolean; bypassSameTurn: boolean } {
  if (!store.stadium?.card.card.effect) return { bypassFirstTurn: false, bypassSameTurn: false };

  if (/pok[eé]mon can evolve.*during the turn they play those pok[eé]mon.*except during their first turn/is.test(store.stadium.card.card.effect)) {
    const targetIsGrass = target.base.card.types?.includes("Grass");
    const evoIsGrass = evoCard.types?.includes("Grass");
    if (targetIsGrass && evoIsGrass) {
      return { bypassFirstTurn: false, bypassSameTurn: true };
    }
  }

  return { bypassFirstTurn: false, bypassSameTurn: false };
}

export function canEvolvePokemon(
  evoCard: CardSummary,
  target: PokemonInPlay,
  store: SimulatorStore,
  options?: { rareCandy?: boolean },
): { ok: boolean; reason?: string } {
  if (!isEvolutionPokemon(evoCard)) return { ok: false, reason: `${evoCard.name} is not an evolution card.` };

  const targetStage = target.base.card.stage;
  if (options?.rareCandy) {
    if (evoCard.stage !== "Stage2") return { ok: false, reason: "Rare Candy can only be used with Stage 2 Pokemon." };
    if (targetStage !== "Basic") return { ok: false, reason: "Rare Candy can only target a Basic Pokemon." };
  } else {
    if (evoCard.stage === "Stage1" && targetStage !== "Basic") {
      return { ok: false, reason: `${evoCard.name} can only evolve from a Basic Pokemon.` };
    }
    if (evoCard.stage === "Stage2" && targetStage !== "Stage1") {
      return { ok: false, reason: `${evoCard.name} can only evolve from a Stage 1 Pokemon.` };
    }
  }

  if (!options?.rareCandy && evoCard.evolve_from && evoCard.evolve_from !== target.base.card.name) {
    return { ok: false, reason: `${evoCard.name} evolves from ${evoCard.evolve_from}, not ${target.base.card.name}.` };
  }

  const bypass = getStadiumEvolveBypass(store, evoCard, target);
  if (store.turnNumber <= 2 && !bypass.bypassFirstTurn) {
    return { ok: false, reason: "Cannot evolve on a player's first turn." };
  }
  if (target.turnPlayedOrEvolved >= store.turnNumber && !bypass.bypassSameTurn) {
    return { ok: false, reason: `${target.base.card.name} was played or evolved this turn.` };
  }

  return { ok: true };
}

export function removeHandCard(player: PlayerBoard, uid: string): CardInstance | null {
  const idx = player.hand.findIndex((card) => card.uid === uid);
  if (idx === -1) return null;
  const [card] = player.hand.splice(idx, 1);
  return card ?? null;
}

export function removeBenchPokemon(player: PlayerBoard, uid: string): PokemonInPlay | null {
  const idx = player.bench.findIndex((pokemon) => pokemon.uid === uid);
  if (idx === -1) return null;
  const [pokemon] = player.bench.splice(idx, 1);
  return pokemon ?? null;
}

export function removePrizeCard(player: PlayerBoard, uid: string): CardInstance | null {
  const idx = player.prizes.findIndex((card) => card.uid === uid);
  if (idx === -1) return null;
  const [card] = player.prizes.splice(idx, 1);
  return card ?? null;
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

export function buildEngineState(store: SimulatorStore): EngineGameState {
  return {
    players: [toEngineBoard(store.players[0]), toEngineBoard(store.players[1])],
    stadium: store.stadium
      ? { card: toEngineCardInstance(store.stadium.card), playedByPlayer: store.stadium.playedByPlayer }
      : null,
    currentTurn: store.currentTurn,
    firstPlayer: store.firstPlayer,
    turnNumber: store.turnNumber,
    phase: store.phase === "idle" ? "setup" : store.phase,
    winner: store.winner as 0 | 1 | null,
    turnDrawDone: store.turnDrawDone,
    logs: [],
  };
}

export function findPokemon(store: SimulatorStore, playerIdx: 0 | 1, pokemonUid: string): PokemonInPlay | null {
  const player = store.players[playerIdx];
  if (player.active?.uid === pokemonUid) return player.active;
  return player.bench.find((pokemon) => pokemon.uid === pokemonUid) ?? null;
}

export function matchesDeckSearchFilter(card: CardInstance, effect: Extract<EffectAction, { type: "search_deck" }>): boolean {
  if (effect.category && card.card.category !== effect.category) return false;
  if (effect.stage && card.card.stage !== effect.stage) return false;
  if (effect.trainerType && card.card.trainer_type !== effect.trainerType) return false;
  if (effect.suffix && card.card.suffix !== effect.suffix) return false;
  if (effect.maxHp != null) {
    const hp = card.card.hp ?? Infinity;
    if (hp > effect.maxHp) return false;
  }
  if (!effect.filter) return true;

  const filter = effect.filter.toLowerCase();
  if (filter.includes("pokemon") && card.card.category !== "Pokemon") return false;
  if (filter.includes("energy") && card.card.category !== "Energy") return false;
  if (filter.includes("trainer") && card.card.category !== "Trainer") return false;
  if (filter.includes("evolution") && card.card.stage === "Basic") return false;
  return true;
}

/**
 * After a stadium leaves play, queue an interactive bench discard prompt
 * if any player exceeds the bench limit. The stadium owner discards first.
 */
export function enforceBenchLimit(store: SimulatorStore, firstPlayerIdx?: 0 | 1): void {
  const first = firstPlayerIdx ?? 0;
  const second = (first === 0 ? 1 : 0) as 0 | 1;
  queueBenchDiscardIfNeeded(store, first, second);
}

export function queueBenchDiscardIfNeeded(store: SimulatorStore, playerIdx: 0 | 1, nextPlayerIdx: 0 | 1 | null): void {
  const maxBench = getMaxBenchSize(store, playerIdx);
  const player = store.players[playerIdx];
  const excess = player.bench.length - maxBench;
  if (excess > 0) {
    store.pendingBenchDiscard = {
      playerIdx,
      discardCount: excess,
      selectedUids: [],
      title: "Discard Bench Pokémon",
      instruction: `P${playerIdx + 1}: Choose ${excess} Pokémon to discard from your Bench.`,
      nextPlayerIdx: nextPlayerIdx,
    };
    appendLog(store, `P${playerIdx + 1} must discard ${excess} Pokémon from the Bench.`);
    return;
  }
  // This player is fine — check the next player
  if (nextPlayerIdx != null) {
    queueBenchDiscardIfNeeded(store, nextPlayerIdx, null);
  }
}

export function getMaxBenchSize(store: SimulatorStore, playerIdx: 0 | 1): number {
  if (!store.stadium) return 5;
  const stadiumEffect = store.stadium.card.card.effect ?? "";
  if (!/up to 8 pok[eé]mon on their bench/i.test(stadiumEffect)) return 5;
  // Check if this player has any Tera Pokémon in play
  const player = store.players[playerIdx];
  const allInPlay = [player.active, ...player.bench].filter((p): p is PokemonInPlay => p !== null);
  const hasTera = allInPlay.some((p) => p.base.card.tera);
  return hasTera ? 8 : 5;
}

export function makePokemonInPlay(instance: CardInstance, turnNumber = 0): PokemonInPlay {
  return {
    uid: instance.uid.startsWith("sim-") ? `${instance.uid}-play` : instance.uid,
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
