import type { CardInstance, DragPayload, PokemonInPlay, SimulatorActions, SimulatorStore } from "./types";
import { fetchDecks } from "../../lib/api";
import {
  appendLog,
  autoMulliganUntilBasic,
  buildDeckFromInput,
  canAct,
  canEvolvePokemon,
  createEmptyPlayer,
  drawFromDeck,
  isBasicPokemon,
  isEvolutionPokemon,
  makePokemonInPlay,
  removeBenchPokemon,
  removeHandCard,
  removePrizeCard,
  shuffle,
} from "./logic";
import {
  toEnginePokemon,
  toEngineBoard,
  toEngineCardInstance,
  syncFromEnginePokemon,
} from "./engine-bridge";
import {
  parseDamage,
  parseEffectText,
  validateAttack,
  resolveAttack,
  prizesToTake,
  applyPokemonCheckup,
  endTurnParalysisCheck,
  canRetreat as engineCanRetreat,
  canRetreatCondition,
  applySpecialCondition,
  canPlayTrainer,
  playTrainer,
  canUseAbility,
  useAbility as resolveAbilityUse,
} from "@luminous/engine";
import type { CardAttack, EffectAction, GameState as EngineGameState } from "@luminous/engine";

type WithStore = <Args extends unknown[], R>(
  fn: (draft: SimulatorStore, ...args: Args) => R | Promise<R>,
  options?: { history?: "push" | "skip" | "replace" },
) => (...args: Args) => Promise<R>;

function evolvePokemon(
  store: SimulatorStore,
  pokemon: PokemonInPlay,
  evoCard: CardInstance,
  playerIdx: 0 | 1,
): void {
  const oldName = pokemon.base.card.name;
  // The old base card goes under as an attached card (keeps all attached cards)
  pokemon.attached.push(pokemon.base);
  // New base is the evolution card
  pokemon.base = evoCard;
  // Update turn tracker to prevent double evolution
  pokemon.turnPlayedOrEvolved = store.turnNumber;
  // Clear special conditions on evolution
  pokemon.specialConditions = [];
  pokemon.poisonDamage = 10;
  pokemon.burnDamage = 20;
  // Reset ability usage
  pokemon.usedAbilityThisTurn = false;
  appendLog(store, `P${playerIdx + 1} evolved ${oldName} into ${evoCard.card.name}.`);
}

function discardActivePokemon(store: SimulatorStore, playerIdx: 0 | 1): void {
  const player = store.players[playerIdx];
  const active = player.active;
  if (!active) return;

  player.discard.push(active.base);
  for (const attached of active.attached) {
    player.discard.push(attached);
  }
  player.active = null;
}

function takePrizeCards(
  store: SimulatorStore,
  takerIdx: 0 | 1,
  count: number,
  reason: string,
): void {
  const taker = store.players[takerIdx];
  let taken = 0;

  for (let i = 0; i < count && taker.prizes.length > 0; i += 1) {
    const prize = taker.prizes.shift();
    if (!prize) continue;
    taker.hand.push(prize);
    taker.takenPrizes += 1;
    taken += 1;
  }

  if (taken > 0) {
    appendLog(store, `P${takerIdx + 1} takes ${taken} Prize card(s) ${reason}.`);
  }
}

function promoteActiveOrDeclareLoss(store: SimulatorStore, playerIdx: 0 | 1, reason: string): void {
  const player = store.players[playerIdx];
  if (player.active || store.winner !== null) return;

  if (player.bench.length === 0) {
    store.winner = (playerIdx === 0 ? 1 : 0);
    appendLog(store, `P${playerIdx + 1} has no Pokemon left ${reason}. P${store.winner + 1} wins!`);
    return;
  }

  const [promoted] = player.bench.splice(0, 1);
  if (!promoted) return;
  player.active = promoted;
  appendLog(store, `P${playerIdx + 1} promotes ${promoted.base.card.name} to the Active Spot.`);
}

function applyWinChecks(store: SimulatorStore): boolean {
  if (store.players[0].takenPrizes >= 6) {
    store.winner = 0;
    appendLog(store, "P1 wins by taking all Prize cards!");
    return true;
  }

  if (store.players[1].takenPrizes >= 6) {
    store.winner = 1;
    appendLog(store, "P2 wins by taking all Prize cards!");
    return true;
  }

  return false;
}

function resolveActiveKnockOut(
  store: SimulatorStore,
  knockedOutPlayerIdx: 0 | 1,
  prizeCount: number,
  reason: string,
): void {
  const knockedOutPlayer = store.players[knockedOutPlayerIdx];
  const active = knockedOutPlayer.active;
  if (!active) return;

  appendLog(store, `${active.base.card.name} is Knocked Out${reason}!`);
  discardActivePokemon(store, knockedOutPlayerIdx);

  const takerIdx = (knockedOutPlayerIdx === 0 ? 1 : 0) as 0 | 1;
  takePrizeCards(store, takerIdx, prizeCount, reason === " by conditions" ? "from the condition KO." : "from the knockout.");
  if (applyWinChecks(store)) return;

  promoteActiveOrDeclareLoss(store, knockedOutPlayerIdx, "after the knockout");
}

function runPokemonCheckup(store: SimulatorStore, playerIdx: 0 | 1): void {
  const player = store.players[playerIdx];
  if (!player.active) return;

  const enginePokemon = toEnginePokemon(player.active);

  if (playerIdx === store.currentTurn) {
    const paralysisLog = endTurnParalysisCheck(enginePokemon);
    if (paralysisLog) appendLog(store, paralysisLog);
  }

  const checkupLogs = applyPokemonCheckup(enginePokemon);
  for (const log of checkupLogs) appendLog(store, log);

  syncFromEnginePokemon(player.active, enginePokemon);

  if (player.active.damage >= (player.active.base.card.hp ?? 0)) {
    resolveActiveKnockOut(store, playerIdx, prizesToTake(enginePokemon), " by conditions");
  }
}

function finishTurn(store: SimulatorStore): void {
  // Move trainer use zone cards to discard for current player
  const currentPlayer = store.players[store.currentTurn];
  if (currentPlayer.trainerUseZone.length > 0) {
    currentPlayer.discard.push(...currentPlayer.trainerUseZone);
    currentPlayer.trainerUseZone = [];
  }

  runPokemonCheckup(store, 0);
  if (store.winner !== null) return;

  runPokemonCheckup(store, 1);
  if (store.winner !== null) return;

  const next = (store.currentTurn === 0 ? 1 : 0) as 0 | 1;
  store.currentTurn = next;
  store.turnNumber += 1;
  store.turnDrawDone = false;

  const nextPlayer = store.players[next];
  nextPlayer.energyAttachedThisTurn = false;
  nextPlayer.supporterPlayedThisTurn = false;
  nextPlayer.retreatedThisTurn = false;
  store.stadiumUsedThisTurn[next] = false;

  if (nextPlayer.active) nextPlayer.active.usedAbilityThisTurn = false;
  for (const pokemon of nextPlayer.bench) pokemon.usedAbilityThisTurn = false;

  appendLog(store, `P${next + 1} turn.`);

  const drawn = drawFromDeck(nextPlayer, 1);
  if (drawn.length === 0) {
    store.winner = (next === 0 ? 1 : 0);
    appendLog(store, `P${next + 1} cannot draw at turn start and loses.`);
    return;
  }

  nextPlayer.hand.push(...drawn);
  store.turnDrawDone = true;
}

function buildEngineState(store: SimulatorStore): EngineGameState {
  return {
    players: [toEngineBoard(store.players[0]), toEngineBoard(store.players[1])],
    stadium: store.stadium ? { card: toEngineCardInstance(store.stadium.card), playedByPlayer: store.stadium.playedByPlayer } : null,
    currentTurn: store.currentTurn,
    firstPlayer: store.firstPlayer,
    turnNumber: store.turnNumber,
    phase: store.phase === "idle" ? "setup" : store.phase,
    winner: store.winner as 0 | 1 | null,
    turnDrawDone: store.turnDrawDone,
    logs: [],
  };
}

function findPokemon(store: SimulatorStore, playerIdx: 0 | 1, pokemonUid: string): PokemonInPlay | null {
  const player = store.players[playerIdx];
  if (player.active?.uid === pokemonUid) return player.active;
  return player.bench.find((pokemon) => pokemon.uid === pokemonUid) ?? null;
}

function movePokemonCards(
  store: SimulatorStore,
  playerIdx: 0 | 1,
  pokemon: PokemonInPlay,
  destination: "hand" | "deck" | "discard",
): void {
  const owner = store.players[playerIdx];
  const cards = [pokemon.base, ...pokemon.attached];

  if (destination === "discard") {
    owner.discard.push(...cards);
    return;
  }

  if (destination === "hand") {
    owner.hand.push(...cards);
    return;
  }

  owner.deck = shuffle([...owner.deck, ...cards]);
}

function removePokemonFromPlay(
  store: SimulatorStore,
  playerIdx: 0 | 1,
  pokemonUid: string,
): PokemonInPlay | null {
  const player = store.players[playerIdx];
  if (player.active?.uid === pokemonUid) {
    const active = player.active;
    player.active = null;
    return active;
  }

  const benchIdx = player.bench.findIndex((pokemon) => pokemon.uid === pokemonUid);
  if (benchIdx === -1) return null;
  const [pokemon] = player.bench.splice(benchIdx, 1);
  return pokemon ?? null;
}

function autoPromoteFirstBench(store: SimulatorStore, playerIdx: 0 | 1, reason: string): void {
  const player = store.players[playerIdx];
  if (player.active || player.bench.length === 0) return;
  const promoted = player.bench.shift();
  if (!promoted) return;
  player.active = promoted;
  appendLog(store, `P${playerIdx + 1} promotes ${promoted.base.card.name} ${reason}.`);
}

function matchesDeckSearchFilter(card: CardInstance, effect: Extract<EffectAction, { type: "search_deck" }>): boolean {
  if (effect.category && card.card.category !== effect.category) {
    return false;
  }
  if (effect.stage && card.card.stage !== effect.stage) {
    return false;
  }
  if (effect.trainerType && card.card.trainer_type !== effect.trainerType) {
    return false;
  }
  if (effect.suffix && card.card.suffix !== effect.suffix) {
    return false;
  }
  if (effect.maxHp != null) {
    const hp = card.card.hp ?? Infinity;
    if (hp > effect.maxHp) {
      return false;
    }
  }
  if (!effect.filter) {
    return true;
  }

  const filterLower = effect.filter.toLowerCase();
  if (filterLower.includes("pokemon") && card.card.category !== "Pokemon") return false;
  if (filterLower.includes("energy") && card.card.category !== "Energy") return false;
  if (filterLower.includes("trainer") && card.card.category !== "Trainer") return false;
  // "Evolution Pokemon" — must not be Basic
  if (filterLower.includes("evolution") && card.card.stage === "Basic") return false;

  return true;
}

function queueDeckSearchPrompt(
  store: SimulatorStore,
  actorIdx: 0 | 1,
  opponentIdx: 0 | 1,
  playerIdx: 0 | 1,
  effect: Extract<EffectAction, { type: "search_deck" }>,
  remainingEffects: EffectAction[],
): boolean {
  const player = store.players[playerIdx];
  const destination = effect.destination ?? "hand";
  const count = destination === "bench"
    ? Math.min(effect.count, Math.max(0, 5 - player.bench.length))
    : effect.count;

  if (count <= 0) {
    appendLog(store, `P${playerIdx + 1} has no room to place searched cards.`);
    player.deck = shuffle(player.deck);
    return true;
  }

  const candidates = player.deck.filter((card) => matchesDeckSearchFilter(card, effect));
  if (candidates.length === 0) {
    appendLog(store, `P${playerIdx + 1} searched their deck but found no valid cards.`);
    player.deck = shuffle(player.deck);
    return true;
  }

  store.pendingDeckSearch = {
    actorIdx,
    opponentIdx,
    playerIdx,
    count,
    minCount: effect.minCount ?? 0,
    destination,
    candidateUids: candidates.map((card) => card.uid),
    selectedUids: [],
    title: destination === "bench" ? "Choose Pokemon to Bench" : "Choose Cards to Take",
    instruction:
      destination === "bench"
        ? `Choose up to ${count} valid card(s) to put onto your Bench.`
        : `Choose up to ${count} valid card(s) to put into your hand.`,
    remainingEffects,
  };
  appendLog(store, `P${playerIdx + 1} is searching their deck.`);
  return true;
}

function queueHandSelectionPrompt(
  store: SimulatorStore,
  actorIdx: 0 | 1,
  opponentIdx: 0 | 1,
  playerIdx: 0 | 1,
  effect: Extract<EffectAction, { type: "discard_card" }>,
  remainingEffects: EffectAction[],
): boolean {
  const player = store.players[playerIdx];
  if (effect.source !== "hand") {
    appendLog(store, `Unsupported discard_card source: ${effect.source}.`);
    return false;
  }
  if (player.hand.length < effect.count) {
    appendLog(store, `P${playerIdx + 1} does not have enough cards in hand.`);
    return true;
  }
  store.pendingHandSelection = {
    actorIdx,
    opponentIdx,
    playerIdx,
    count: effect.count,
    minCount: effect.count,
    candidateUids: player.hand.map((card) => card.uid),
    selectedUids: [],
    title: "Choose Cards to Discard",
    instruction: `Choose ${effect.count} card(s) from your hand to discard.`,
    remainingEffects,
  };
  appendLog(store, `P${playerIdx + 1} must choose ${effect.count} card(s) to discard.`);
  return true;
}

function applyGenericEffects(
  store: SimulatorStore,
  actorIdx: 0 | 1,
  opponentIdx: 0 | 1,
  effects: EffectAction[],
): void {
  const actor = store.players[actorIdx];
  const opponent = store.players[opponentIdx];

  for (let effectIndex = 0; effectIndex < effects.length; effectIndex += 1) {
    const effect = effects[effectIndex];
    const remainingEffects = effects.slice(effectIndex + 1);
    switch (effect.type) {
      case "coin_flip": {
        const result = Math.random() < 0.5 ? "Heads" : "Tails";
        appendLog(store, `Coin flip: ${result}.`);
        applyGenericEffects(store, actorIdx, opponentIdx, result === "Heads" ? effect.onHeads : effect.onTails);
        break;
      }
      case "special_condition": {
        const targetPlayer = effect.target === "self" ? actor : opponent;
        const target = targetPlayer.active;
        if (!target) break;
        const engineTarget = toEnginePokemon(target);
        const log = applySpecialCondition(engineTarget, effect.condition);
        syncFromEnginePokemon(target, engineTarget);
        appendLog(store, log);
        break;
      }
      case "draw": {
        const targetPlayer =
          effect.player === "self"
            ? actor
            : opponent;
        const drawn = drawFromDeck(targetPlayer, effect.count);
        targetPlayer.hand.push(...drawn);
        appendLog(store, `P${effect.player === "self" ? actorIdx + 1 : opponentIdx + 1} drew ${drawn.length} card(s).`);
        break;
      }
      case "heal": {
        const targetPlayer = actor;
        const target =
          effect.target === "self"
            ? targetPlayer.active
            : effect.pokemonUid ? findPokemon(store, actorIdx, effect.pokemonUid) : targetPlayer.active;
        if (!target) break;
        target.damage = Math.max(0, target.damage - effect.amount);
        appendLog(store, `${target.base.card.name} healed ${effect.amount} damage.`);
        break;
      }
      case "discard_energy": {
        const target =
          effect.target === "self"
            ? actor.active
            : opponent.active;
        if (!target) break;

        let remaining = effect.count;
        while (remaining > 0) {
          const energyIdx = target.attached.findLastIndex((card) => {
            if (card.card.category !== "Energy") return false;
            return effect.energyType == null || effect.energyType === "any" || card.card.energy_type === effect.energyType;
          });
          if (energyIdx === -1) break;
          const [removed] = target.attached.splice(energyIdx, 1);
          if (!removed) break;
          const owner = effect.target === "self" ? actor : opponent;
          owner.discard.push(removed);
          remaining -= 1;
        }
        break;
      }
      case "damage": {
        if (effect.target === "self") {
          if (!actor.active) break;
          actor.active.damage += effect.amount;
          appendLog(store, `${actor.active.base.card.name} takes ${effect.amount} damage.`);
          if (actor.active.damage >= (actor.active.base.card.hp ?? 0)) {
            resolveActiveKnockOut(store, actorIdx, prizesToTake(toEnginePokemon(actor.active)), " from effect damage");
          }
          break;
        }

        if (effect.target === "defender") {
          if (!opponent.active) break;
          opponent.active.damage += effect.amount;
          appendLog(store, `${opponent.active.base.card.name} takes ${effect.amount} damage.`);
          if (opponent.active.damage >= (opponent.active.base.card.hp ?? 0)) {
            resolveActiveKnockOut(store, opponentIdx, prizesToTake(toEnginePokemon(opponent.active)), " from effect damage");
          }
          break;
        }

        if (effect.target === "bench") {
          const target = effect.pokemonUid
            ? findPokemon(store, opponentIdx, effect.pokemonUid)
            : opponent.bench[0] ?? null;
          if (!target) {
            appendLog(store, "Bench damage effect had no valid target.");
            break;
          }
          target.damage += effect.amount;
          appendLog(store, `${target.base.card.name} takes ${effect.amount} bench damage.`);
        }
        break;
      }
      case "switch_pokemon": {
        const targetIdx = effect.player === "self" ? actorIdx : opponentIdx;
        const targetPlayer = store.players[targetIdx];
        if (!targetPlayer.active || targetPlayer.bench.length === 0) {
          appendLog(store, `Switch effect for P${targetIdx + 1} had no valid bench target.`);
          break;
        }
        if (effect.player === "opponent") {
          // Queue interactive opponent switch: let the user choose which bench Pokemon to drag in
          store.pendingOpponentSwitch = {
            actorIdx,
            opponentIdx,
            remainingEffects,
          };
          appendLog(store, `Choose a Pokémon from your opponent's Bench to switch with their Active Pokémon.`);
          return;
        }
        // Self switch: let user choose which bench Pokemon to switch in
        store.pendingSelfSwitch = {
          actorIdx,
          opponentIdx,
          remainingEffects,
        };
        appendLog(store, `Choose one of your Benched Pokémon to switch with your Active Pokémon.`);
        return;
      }
      case "rare_candy": {
        store.pendingRareCandy = {
          actorIdx,
          remainingEffects,
        };
        appendLog(store, `Rare Candy: drag a Stage 2 Pokémon from your hand onto an eligible Basic Pokémon.`);
        return;
      }
      case "evolve_from_deck": {
        // Find all valid evolution cards in the deck
        const allInPlay = [actor.active, ...actor.bench].filter((p): p is PokemonInPlay => p !== null);
        const eligiblePokemon = allInPlay.filter((p) => {
          if (!effect.bypassSameTurn && p.turnPlayedOrEvolved >= store.turnNumber) return false;
          return true;
        });
        const candidateUids = actor.deck.filter((c) => {
          if (c.card.category !== "Pokemon" || c.card.stage === "Basic" || !c.card.stage) return false;
          if (!c.card.evolve_from) return false;
          if (effect.excludeSuffix && c.card.suffix === effect.excludeSuffix) return false;
          if (effect.requireSuffix && c.card.suffix !== effect.requireSuffix) return false;
          if (effect.requireNoAbilities && c.card.abilities && c.card.abilities.length > 0) return false;
          if (effect.allowedNames && !effect.allowedNames.some((n) => c.card.name.startsWith(n))) return false;
          return eligiblePokemon.some((p) => p.base.card.name === c.card.evolve_from);
        }).map((c) => c.uid);

        if (candidateUids.length === 0) {
          appendLog(store, "No valid evolution targets found in deck.");
          actor.deck = shuffle(actor.deck);
          break;
        }

        store.pendingEvolveFromDeck = {
          actorIdx,
          opponentIdx,
          candidateUids,
          selectedUids: [],
          count: effect.count,
          evolved: 0,
          bypassFirstTurn: effect.bypassFirstTurn,
          bypassSameTurn: effect.bypassSameTurn,
          endsTurn: effect.endsTurn,
          excludeSuffix: effect.excludeSuffix,
          requireSuffix: effect.requireSuffix,
          requireNoAbilities: effect.requireNoAbilities,
          allowedNames: effect.allowedNames,
          title: "Evolve from Deck",
          instruction: `Select a Pokémon to evolve (${effect.count - 0} remaining).`,
          remainingEffects,
        };
        appendLog(store, `Search your deck for a Pokémon to evolve.`);
        return;
      }
      case "end_turn": {
        appendLog(store, "Turn ends (card effect).");
        finishTurn(store);
        return;
      }
      case "shuffle_hand_draw": {
        const targetPlayer = effect.player === "self" ? actor : opponent;
        targetPlayer.deck.push(...targetPlayer.hand);
        targetPlayer.hand = [];
        targetPlayer.deck = shuffle(targetPlayer.deck);
        const drawn = drawFromDeck(targetPlayer, effect.drawCount);
        targetPlayer.hand.push(...drawn);
        appendLog(store, `P${effect.player === "self" ? actorIdx + 1 : opponentIdx + 1} shuffled their hand into the deck and drew ${drawn.length} card(s).`);
        break;
      }
      case "energy_accelerate": {
        const sourcePlayer = actor;
        const sourceZone = effect.source === "discard" ? sourcePlayer.discard : effect.source === "hand" ? sourcePlayer.hand : sourcePlayer.deck;
        const target = sourcePlayer.active;
        if (!target) break;

        let attached = 0;
        for (let i = sourceZone.length - 1; i >= 0 && attached < effect.count; i -= 1) {
          const card = sourceZone[i];
          if (card.card.category !== "Energy") continue;
          if (effect.energyType && effect.energyType !== "any" && card.card.energy_type !== effect.energyType) continue;
          const [energy] = sourceZone.splice(i, 1);
          if (!energy) continue;
          target.attached.push(energy);
          attached += 1;
        }
        appendLog(store, `${target.base.card.name} attached ${attached} Energy card(s) from ${effect.source}.`);
        break;
      }
      case "bounce": {
        const targetIdx = effect.target === "self" ? actorIdx : opponentIdx;
        const targetPlayer = store.players[targetIdx];
        const target = targetPlayer.active;
        if (!target) break;
        const removed = removePokemonFromPlay(store, targetIdx, target.uid);
        if (!removed) break;
        movePokemonCards(store, targetIdx, removed, effect.destination);
        appendLog(store, `${removed.base.card.name} was returned to ${effect.destination}.`);
        autoPromoteFirstBench(store, targetIdx, "after the bounce");
        break;
      }
      case "search_deck": {
        const searchPlayer = effect.player === "self" ? actor : opponent;
        const searchPlayerIdx = effect.player === "self" ? actorIdx : opponentIdx;
        if (searchPlayer.deck.length === 0) {
          appendLog(store, `P${searchPlayerIdx + 1} has no cards in deck to search.`);
          break;
        }
        queueDeckSearchPrompt(store, actorIdx, opponentIdx, searchPlayerIdx, effect, remainingEffects);
        return;
      }
      case "discard_card": {
        queueHandSelectionPrompt(store, actorIdx, opponentIdx, actorIdx, effect, remainingEffects);
        return;
      }
      case "multi_coin_flip": {
        let heads = 0;
        for (let i = 0; i < effect.coins; i += 1) {
          const flip = Math.random() < 0.5 ? "Heads" : "Tails";
          if (flip === "Heads") heads += 1;
        }
        appendLog(store, `Flipped ${effect.coins} coins: ${heads} Heads, ${effect.coins - heads} Tails.`);
        if (heads > 0) {
          // Apply per-heads effects, multiplying damage amounts
          for (const perHead of effect.perHeads) {
            if (perHead.type === "damage") {
              applyGenericEffects(store, actorIdx, opponentIdx, [
                { ...perHead, amount: perHead.amount * heads },
              ]);
            } else {
              for (let h = 0; h < heads; h += 1) {
                applyGenericEffects(store, actorIdx, opponentIdx, [perHead]);
              }
            }
          }
        }
        break;
      }
      case "cant_attack":
        appendLog(store, `This Pokémon can't attack during its next turn.`);
        break;
      case "cant_retreat":
        appendLog(store, `The Defending Pokémon can't retreat during the next turn.`);
        break;
      case "ignore_resistance":
        appendLog(store, `This attack's damage isn't affected by Resistance.`);
        break;
      case "prevent_damage":
        appendLog(store, `Damage prevention effect noted (not fully tracked in simulator).`);
        break;
      case "custom":
        appendLog(store, `Manual effect: ${effect.description}`);
        break;
      default:
        break;
    }
  }
}

export function useSimulatorActions(withStore: WithStore): {
  actions: SimulatorActions;
  autoSetup: (deckOverrides?: { deck1: string; deck2: string }) => Promise<void>;
} {
  const autoSetup = withStore(async (store, deckOverrides?: { deck1: string; deck2: string }) => {
    store.loading = true;
    try {
      if (deckOverrides) {
        store.deckInput1 = deckOverrides.deck1;
        store.deckInput2 = deckOverrides.deck2;
      }
      const deck1 = await buildDeckFromInput(store, store.deckInput1, "Deck 1");
      const deck2 = await buildDeckFromInput(store, store.deckInput2, "Deck 2");
      if (!deck1 || !deck2) return;

      const p1 = createEmptyPlayer();
      const p2 = createEmptyPlayer();
      p1.deck = deck1;
      p2.deck = deck2;

      p1.hand = drawFromDeck(p1, 7);
      p2.hand = drawFromDeck(p2, 7);

      if (!autoMulliganUntilBasic(p1)) {
        appendLog(store, "Deck 1: deck has no Basic Pokemon and cannot complete setup.");
        return;
      }

      if (!autoMulliganUntilBasic(p2)) {
        appendLog(store, "Deck 2: deck has no Basic Pokemon and cannot complete setup.");
        return;
      }

      const shared = Math.min(p1.mulligans, p2.mulligans);
      const bonus1 = Math.max(0, p2.mulligans - shared);
      const bonus2 = Math.max(0, p1.mulligans - shared);
      p1.hand.push(...drawFromDeck(p1, bonus1));
      p2.hand.push(...drawFromDeck(p2, bonus2));

      store.logs = [];
      store.players = [p1, p2];
      store.winner = null;
      store.revealedPrizeUids = [[], []];
      store.selectedPrizeUid = [null, null];
      store.selectedHandUid = [null, null];
      store.stadium = null;
      store.pendingHandSelection = null;
      store.pendingDeckSearch = null;
      store.pendingOpponentSwitch = null;
      store.pendingSelfSwitch = null;
      store.turnNumber = 0;
      store.phase = "setup";
      store.gameStarted = true;

      store.coinFlipResult = Math.random() < 0.5 ? "Heads" : "Tails";
      store.firstPlayer = store.coinFlipResult === "Heads" ? 0 : 1;
      store.currentTurn = store.firstPlayer;

      appendLog(store, `Coin flip: ${store.coinFlipResult}. P${store.firstPlayer + 1} goes first.`);
      appendLog(store, `Mulligans -> P1: ${p1.mulligans}, P2: ${p2.mulligans}.`);
    } finally {
      store.loading = false;
    }
  });

  const startNewGame = async () => {
    const decks = await fetchDecks();
    await autoSetup({
      deck1: decks[0]?.decklist ?? "",
      deck2: decks[1]?.decklist ?? "",
    });
  };

  const selectHandCard = withStore((store, playerIdx: 0 | 1, uid: string) => {
    store.selectedHandUid[playerIdx] =
      store.selectedHandUid[playerIdx] === uid ? null : uid;
  });

  const deselectHandCard = withStore((store, playerIdx: 0 | 1) => {
    store.selectedHandUid[playerIdx] = null;
  });

  // ---------------------------------------------------------------------------
  // End Turn (with Pokemon Checkup)
  // ---------------------------------------------------------------------------

  const logSetupBoard = (store: SimulatorStore, playerIdx: 0 | 1) => {
    const player = store.players[playerIdx];
    const tag = `P${playerIdx + 1}`;
    appendLog(store, `${tag} set ${player.active!.base.card.name} to Active.`);
    for (const b of player.bench) {
      appendLog(store, `${tag} benched ${b.base.card.name}.`);
    }
  };

  const endTurn = withStore((store) => {
    if (store.phase === "setup") {
      const player = store.players[store.currentTurn];
      if (!player.active) return;

      const otherIdx: 0 | 1 = store.currentTurn === 0 ? 1 : 0;

      // First player done, switch to second player for setup
      if (!store.players[otherIdx].active) {
        logSetupBoard(store, store.currentTurn);
        store.currentTurn = otherIdx;
        return;
      }

      // Both players done — finalize setup
      logSetupBoard(store, store.currentTurn);

      for (const playerBoard of store.players) {
        playerBoard.prizes = drawFromDeck(playerBoard, 6);
        playerBoard.energyAttachedThisTurn = false;
        playerBoard.supporterPlayedThisTurn = false;
        playerBoard.retreatedThisTurn = false;
      }

      store.currentTurn = store.firstPlayer;
      store.turnNumber = 1;
      store.turnDrawDone = false;
      store.phase = "playing";

      const firstPlayer = store.players[store.firstPlayer];
      const drawn = drawFromDeck(firstPlayer, 1);
      if (drawn.length > 0) {
        firstPlayer.hand.push(...drawn);
        store.turnDrawDone = true;
      }
      return;
    }

    if (store.phase !== "playing") return;
    if (!canAct(store, store.currentTurn, "end turn")) return;

    finishTurn(store);
  });

  // ---------------------------------------------------------------------------
  // Use Attack
  // ---------------------------------------------------------------------------

  const useAttack = withStore((store, attackIdx: number) => {
    if (!canAct(store, store.currentTurn, "attack")) return;

    // First player cannot attack on turn 1
    if (store.turnNumber === 1 && store.currentTurn === store.firstPlayer) {
      return;
    }

    const attacker = store.players[store.currentTurn];
    const defenderIdx = (store.currentTurn === 0 ? 1 : 0) as 0 | 1;
    const defender = store.players[defenderIdx];

    if (!attacker.active || !defender.active) return;

    const attacks = attacker.active.base.card.attacks ?? [];
    if (attackIdx < 0 || attackIdx >= attacks.length) return;

    const frontendAttack = attacks[attackIdx];
    const dmg = parseDamage(frontendAttack.damage);
    const engineAttack: CardAttack = {
      name: frontendAttack.name ?? "Unknown",
      cost: (frontendAttack.cost ?? []) as CardAttack["cost"],
      damageBase: dmg.base,
      damageMod: dmg.mod,
      damageRaw: dmg.raw,
      effect: frontendAttack.effect ?? null,
    };

    // Convert to engine types for validation and resolution
    const engineAttacker = toEnginePokemon(attacker.active);
    const engineDefender = toEnginePokemon(defender.active);

    // Validate
    const validation = validateAttack(engineAttacker, engineAttack);
    if (!validation.valid) return;

    // Resolve
    const result = resolveAttack({
      attacker: engineAttacker,
      defender: engineDefender,
      attack: engineAttack,
      attackerBoard: toEngineBoard(attacker),
      defenderBoard: toEngineBoard(defender),
      state: buildEngineState(store),
    });

    for (const log of result.logs) appendLog(store, log);
    applyGenericEffects(store, store.currentTurn, defenderIdx, result.effects);

    syncFromEnginePokemon(attacker.active, engineAttacker);
    syncFromEnginePokemon(defender.active, engineDefender);

    if (attacker.active.damage >= (attacker.active.base.card.hp ?? 0)) {
      resolveActiveKnockOut(store, store.currentTurn, prizesToTake(engineAttacker), " from self-damage");
      if (store.winner !== null) return;
    }

    if (result.defenderKnockedOut && defender.active) {
      resolveActiveKnockOut(store, defenderIdx, prizesToTake(engineDefender), "");
      if (store.winner !== null) return;
    }

    finishTurn(store);
  });

  // ---------------------------------------------------------------------------
  // Use Ability
  // ---------------------------------------------------------------------------

  const useAbility = withStore((store, pokemonUid: string, abilityIdx: number) => {
    if (!canAct(store, store.currentTurn, "use ability")) return;

    const player = store.players[store.currentTurn];
    const pokemon = player.active?.uid === pokemonUid
      ? player.active
      : player.bench.find((p) => p.uid === pokemonUid) ?? null;
    if (!pokemon) return;

    const enginePokemon = toEnginePokemon(pokemon);
    const ability = enginePokemon.base.card.abilities[abilityIdx];
    if (!ability) return;

    const canUse = canUseAbility(enginePokemon, ability);
    if (!canUse.allowed) {
      if (canUse.reason) appendLog(store, canUse.reason);
      return;
    }

    const result = resolveAbilityUse(enginePokemon, ability, toEngineBoard(player), buildEngineState(store));
    syncFromEnginePokemon(pokemon, enginePokemon);
    for (const log of result.logs) appendLog(store, log);
    applyGenericEffects(store, store.currentTurn, (store.currentTurn === 0 ? 1 : 0) as 0 | 1, result.effects);
  });

  // ---------------------------------------------------------------------------
  // Play Trainer Card
  // ---------------------------------------------------------------------------

  const playTrainerCard = withStore((store, uid: string) => {
    if (!canAct(store, store.currentTurn, "play Trainer")) return;

    const player = store.players[store.currentTurn];
    const cardInHand = player.hand.find((c) => c.uid === uid);
    if (!cardInHand) return;

    const card = cardInHand.card;
    if (card.category !== "Trainer") return;

    const engineCard = toEngineCardInstance(cardInHand);
    const canPlay = canPlayTrainer(engineCard, toEngineBoard(player), buildEngineState(store), store.currentTurn);
    if (!canPlay.allowed) {
      if (canPlay.reason) appendLog(store, canPlay.reason);
      return;
    }

    if (engineCard.card.trainerType === "Tool" || engineCard.card.trainerType === "Technical Machine") {
      appendLog(store, `Drag ${card.name} onto a Pokémon to attach it.`);
      return;
    }

    const discardCosts = (engineCard.card.effect ? parseEffectText(engineCard.card.effect) : [])
      .filter((effect: EffectAction): effect is Extract<EffectAction, { type: "discard_card" }> => effect.type === "discard_card" && effect.source === "hand");
    const requiredDiscardCount = discardCosts.reduce((sum: number, effect) => sum + effect.count, 0);
    if (requiredDiscardCount > 0 && player.hand.length - 1 < requiredDiscardCount) {
      appendLog(store, `${card.name} requires discarding ${requiredDiscardCount} other card(s) from hand.`);
      return;
    }

    const playedCard = removeHandCard(player, uid);
    if (!playedCard) return;

    const result = playTrainer(engineCard, toEngineBoard(player), buildEngineState(store), store.currentTurn);
    for (const log of result.logs) appendLog(store, log);

    if (engineCard.card.trainerType === "Supporter") {
      player.supporterPlayedThisTurn = true;
    }

    if (engineCard.card.trainerType === "Stadium") {
      if (store.stadium) {
        const oldOwner = store.players[store.stadium.playedByPlayer];
        oldOwner.discard.push(store.stadium.card);
      }
      store.stadium = { card: playedCard, playedByPlayer: store.currentTurn };
      return;
    }

    applyGenericEffects(store, store.currentTurn, (store.currentTurn === 0 ? 1 : 0) as 0 | 1, result.effects);

    if (engineCard.card.trainerType === "Item" || engineCard.card.trainerType === "Supporter" || engineCard.card.trainerType === "ACE SPEC" || engineCard.card.trainerType === "Rocket's Secret Machine") {
      player.trainerUseZone.push(playedCard);
    }
  });

  const toggleDeckSearchCard = withStore((store, uid: string) => {
    const pending = store.pendingDeckSearch;
    if (!pending) return;
    if (!pending.candidateUids.includes(uid)) return;

    const selected = new Set(pending.selectedUids);
    if (selected.has(uid)) {
      selected.delete(uid);
    } else if (selected.size < pending.count) {
      selected.add(uid);
    }
    pending.selectedUids = [...selected];
  }, { history: "skip" });

  const toggleHandSelectionCard = withStore((store, uid: string) => {
    const pending = store.pendingHandSelection;
    if (!pending) return;
    if (!pending.candidateUids.includes(uid)) return;

    const selected = new Set(pending.selectedUids);
    if (selected.has(uid)) {
      selected.delete(uid);
    } else if (selected.size < pending.count) {
      selected.add(uid);
    }
    pending.selectedUids = [...selected];
  }, { history: "skip" });

  const confirmHandSelection = withStore((store) => {
    const pending = store.pendingHandSelection;
    if (!pending) return;
    if (pending.selectedUids.length < pending.minCount) return;

    const player = store.players[pending.playerIdx];
    let discarded = 0;
    for (const uid of pending.selectedUids) {
      const card = removeHandCard(player, uid);
      if (!card) continue;
      player.discard.push(card);
      discarded += 1;
    }

    appendLog(store, `P${pending.playerIdx + 1} discarded ${discarded} card(s) from hand.`);
    const remainingEffects = pending.remainingEffects;
    const actorIdx = pending.actorIdx;
    const opponentIdx = pending.opponentIdx;
    store.pendingHandSelection = null;
    applyGenericEffects(store, actorIdx, opponentIdx, remainingEffects);
  }, { history: "replace" });

  const confirmDeckSearch = withStore((store) => {
    const pending = store.pendingDeckSearch;
    if (!pending) return;
    if (pending.selectedUids.length < pending.minCount) return;

    const player = store.players[pending.playerIdx];
    const selectedCards: CardInstance[] = [];
    for (const uid of pending.selectedUids) {
      const idx = player.deck.findIndex((card) => card.uid === uid);
      if (idx === -1) continue;
      const [card] = player.deck.splice(idx, 1);
      if (card) selectedCards.push(card);
    }

    if (pending.destination === "bench") {
      const benchSpace = Math.max(0, 5 - player.bench.length);
      for (const card of selectedCards.slice(0, benchSpace)) {
        player.bench.push(makePokemonInPlay(card, store.turnNumber));
      }
      appendLog(
        store,
        `P${pending.playerIdx + 1} searched their deck and benched ${Math.min(selectedCards.length, benchSpace)} card(s).`,
      );
    } else {
      player.hand.push(...selectedCards);
      appendLog(store, `P${pending.playerIdx + 1} searched their deck and took ${selectedCards.length} card(s).`);
    }

    player.deck = shuffle(player.deck);
    const remainingEffects = pending.remainingEffects;
    const actorIdx = pending.actorIdx;
    const opponentIdx = pending.opponentIdx;
    store.pendingDeckSearch = null;
    applyGenericEffects(store, actorIdx, opponentIdx, remainingEffects);
  }, { history: "replace" });

  const cancelDeckSearch = withStore((store) => {
    const pending = store.pendingDeckSearch;
    if (!pending) return;
    if (pending.minCount > 0) return;

    const player = store.players[pending.playerIdx];
    player.deck = shuffle(player.deck);
    appendLog(store, `P${pending.playerIdx + 1} finished searching their deck without taking cards.`);
    store.pendingDeckSearch = null;
  }, { history: "replace" });

  // ---------------------------------------------------------------------------
  // Opponent Switch (Boss's Orders etc.)
  // ---------------------------------------------------------------------------

  const confirmOpponentSwitch = withStore((store, benchUid: string) => {
    const pending = store.pendingOpponentSwitch;
    if (!pending) return;

    const opponent = store.players[pending.opponentIdx];
    if (!opponent.active) {
      store.pendingOpponentSwitch = null;
      return;
    }

    const benchIdx = opponent.bench.findIndex((p) => p.uid === benchUid);
    if (benchIdx === -1) return;

    const [incoming] = opponent.bench.splice(benchIdx, 1);
    if (!incoming) return;

    const previousActive = opponent.active;
    previousActive.specialConditions = [];
    previousActive.poisonDamage = 10;
    previousActive.burnDamage = 20;
    opponent.active = incoming;
    opponent.bench.push(previousActive);
    appendLog(store, `P${pending.opponentIdx + 1} switches ${previousActive.base.card.name} with ${incoming.base.card.name}.`);

    const remainingEffects = pending.remainingEffects;
    const actorIdx = pending.actorIdx;
    const opponentIdx = pending.opponentIdx;
    store.pendingOpponentSwitch = null;
    applyGenericEffects(store, actorIdx, opponentIdx, remainingEffects);
  }, { history: "replace" });

  const cancelOpponentSwitch = withStore((store) => {
    if (!store.pendingOpponentSwitch) return;
    store.pendingOpponentSwitch = null;
    appendLog(store, "Opponent switch cancelled.");
  }, { history: "replace" });

  // ---------------------------------------------------------------------------
  // Self Switch (Prime Catcher etc.)
  // ---------------------------------------------------------------------------

  const confirmSelfSwitch = withStore((store, benchUid: string) => {
    const pending = store.pendingSelfSwitch;
    if (!pending) return;

    const actor = store.players[pending.actorIdx];
    if (!actor.active) {
      store.pendingSelfSwitch = null;
      return;
    }

    const benchIdx = actor.bench.findIndex((p) => p.uid === benchUid);
    if (benchIdx === -1) return;

    const [incoming] = actor.bench.splice(benchIdx, 1);
    if (!incoming) return;

    const previousActive = actor.active;
    previousActive.specialConditions = [];
    previousActive.poisonDamage = 10;
    previousActive.burnDamage = 20;
    actor.active = incoming;
    actor.bench.push(previousActive);
    appendLog(store, `P${pending.actorIdx + 1} switches ${previousActive.base.card.name} with ${incoming.base.card.name}.`);

    const remainingEffects = pending.remainingEffects;
    const actorIdx = pending.actorIdx;
    const opponentIdx = pending.opponentIdx;
    store.pendingSelfSwitch = null;
    applyGenericEffects(store, actorIdx, opponentIdx, remainingEffects);
  }, { history: "replace" });

  const cancelSelfSwitch = withStore((store) => {
    if (!store.pendingSelfSwitch) return;
    store.pendingSelfSwitch = null;
    appendLog(store, "Self switch cancelled.");
  }, { history: "replace" });

  const cancelRareCandy = withStore((store) => {
    if (!store.pendingRareCandy) return;
    store.pendingRareCandy = null;
    appendLog(store, "Rare Candy cancelled.");
  }, { history: "replace" });

  // ---------------------------------------------------------------------------
  // Evolve from Deck (Evosoda, Wally, Boost Shake, etc.)
  // ---------------------------------------------------------------------------

  const toggleEvolveFromDeckCard = withStore((store, uid: string) => {
    const pending = store.pendingEvolveFromDeck;
    if (!pending) return;
    if (!pending.candidateUids.includes(uid)) return;

    // Single selection: toggle the one card
    if (pending.selectedUids.includes(uid)) {
      pending.selectedUids = [];
    } else {
      pending.selectedUids = [uid];
    }
  }, { history: "skip" });

  const confirmEvolveFromDeck = withStore((store) => {
    const pending = store.pendingEvolveFromDeck;
    if (!pending || pending.selectedUids.length !== 1) return;

    const actor = store.players[pending.actorIdx];
    const selectedUid = pending.selectedUids[0];
    const cardIdx = actor.deck.findIndex((c) => c.uid === selectedUid);
    if (cardIdx === -1) return;

    const evoCard = actor.deck[cardIdx];

    // Find the target Pokemon in play whose name matches evolve_from
    const allInPlay: { pokemon: PokemonInPlay; location: "active" | "bench" }[] = [];
    if (actor.active) allInPlay.push({ pokemon: actor.active, location: "active" });
    for (const b of actor.bench) allInPlay.push({ pokemon: b, location: "bench" });

    const validTarget = allInPlay.find((entry) => {
      const p = entry.pokemon;
      if (!pending.bypassSameTurn && p.turnPlayedOrEvolved >= store.turnNumber) return false;
      if (p.base.card.name !== evoCard.card.evolve_from) return false;
      // Stage validation: Stage 1 from Basic, Stage 2 from Stage 1
      if (evoCard.card.stage === "Stage1" && p.base.card.stage !== "Basic") return false;
      if (evoCard.card.stage === "Stage2" && p.base.card.stage !== "Stage1") return false;
      return true;
    });

    if (!validTarget) {
      appendLog(store, `No valid target Pokémon in play for ${evoCard.card.name}.`);
      return;
    }

    // Remove evo card from deck and evolve
    actor.deck.splice(cardIdx, 1);
    evolvePokemon(store, validTarget.pokemon, evoCard, pending.actorIdx);
    pending.evolved += 1;

    // Check if more evolutions are needed
    if (pending.evolved < pending.count) {
      // Recompute candidates for the next evolution
      const eligiblePokemon = [actor.active, ...actor.bench].filter((p): p is PokemonInPlay => {
        if (!p) return false;
        if (!pending.bypassSameTurn && p.turnPlayedOrEvolved >= store.turnNumber) return false;
        return true;
      });
      const newCandidates = actor.deck.filter((c) => {
        if (c.card.category !== "Pokemon" || c.card.stage === "Basic" || !c.card.stage) return false;
        if (!c.card.evolve_from) return false;
        if (pending.excludeSuffix && c.card.suffix === pending.excludeSuffix) return false;
        if (pending.requireSuffix && c.card.suffix !== pending.requireSuffix) return false;
        if (pending.requireNoAbilities && c.card.abilities && c.card.abilities.length > 0) return false;
        if (pending.allowedNames && !pending.allowedNames.some((n) => c.card.name.startsWith(n))) return false;
        return eligiblePokemon.some((p) => p.base.card.name === c.card.evolve_from);
      }).map((c) => c.uid);

      if (newCandidates.length > 0) {
        pending.candidateUids = newCandidates;
        pending.selectedUids = [];
        pending.instruction = `Select a Pokémon to evolve (${pending.count - pending.evolved} remaining).`;
        return;
      }
      // No more valid targets, finish up
    }

    // Grand Tree chained evolution: after Stage 1, offer Stage 2
    const chainedEvo = pending.remainingEffects.find((e) => e.type === "stadium_chained_evolution");
    if (chainedEvo && evoCard.card.stage === "Stage1") {
      // Look for Stage 2 cards that evolve from the just-evolved Stage 1
      const evolvedName = evoCard.card.name;
      const stage2Candidates = actor.deck.filter((c) =>
        c.card.category === "Pokemon" && c.card.stage === "Stage2" && c.card.evolve_from === evolvedName,
      ).map((c) => c.uid);

      if (stage2Candidates.length > 0) {
        pending.candidateUids = stage2Candidates;
        pending.selectedUids = [];
        pending.count = 1;
        pending.evolved = 0;
        pending.title = "Grand Tree (Stage 2)";
        pending.instruction = `Optionally select a Stage 2 Pokémon that evolves from ${evolvedName}.`;
        pending.remainingEffects = pending.remainingEffects.filter((e) => e.type !== "stadium_chained_evolution");
        return;
      }
      // No Stage 2 available, finish
    }

    // Done: shuffle deck, apply remaining effects
    actor.deck = shuffle(actor.deck);
    const endsTurn = pending.endsTurn;
    const remainingEffects = pending.remainingEffects.filter((e) => e.type !== "stadium_chained_evolution");
    const actorIdx = pending.actorIdx;
    const opponentIdx = pending.opponentIdx;
    store.pendingEvolveFromDeck = null;
    applyGenericEffects(store, actorIdx, opponentIdx, remainingEffects);

    if (endsTurn) {
      appendLog(store, "Turn ends (card effect).");
      finishTurn(store);
    }
  }, { history: "replace" });

  const cancelEvolveFromDeck = withStore((store) => {
    if (!store.pendingEvolveFromDeck) return;
    const actor = store.players[store.pendingEvolveFromDeck.actorIdx];
    actor.deck = shuffle(actor.deck);
    store.pendingEvolveFromDeck = null;
    appendLog(store, "Evolution search cancelled.");
  }, { history: "replace" });

  // ---------------------------------------------------------------------------
  // Stadium Abilities (Grand Tree, Pokémon Research Lab)
  // ---------------------------------------------------------------------------

  const useStadiumAbility = withStore((store) => {
    if (!canAct(store, store.currentTurn, "use Stadium ability")) return;
    if (!store.stadium) {
      appendLog(store, "No Stadium in play.");
      return;
    }
    if (store.stadiumUsedThisTurn[store.currentTurn]) {
      appendLog(store, "Stadium ability already used this turn.");
      return;
    }

    const stadiumEffect = store.stadium.card.card.effect;
    if (!stadiumEffect) return;
    const effects = parseEffectText(stadiumEffect);
    const actorIdx = store.currentTurn;
    const opponentIdx = (actorIdx === 0 ? 1 : 0) as 0 | 1;

    // Grand Tree: chained evolution from deck (Basic → Stage 1 → Stage 2)
    const chainedEvo = effects.find((e) => e.type === "stadium_chained_evolution");
    if (chainedEvo) {
      const actor = store.players[actorIdx];
      // Find eligible Basic Pokemon (not first turn, not played this turn)
      if (store.turnNumber <= 2) {
        appendLog(store, "Cannot use Grand Tree on a player's first turn.");
        return;
      }
      const eligibleBasics = [actor.active, ...actor.bench].filter((p): p is PokemonInPlay =>
        p !== null && p.base.card.stage === "Basic" && p.turnPlayedOrEvolved < store.turnNumber,
      );
      if (eligibleBasics.length === 0) {
        appendLog(store, "No eligible Basic Pokémon in play.");
        return;
      }
      // Find Stage 1 cards in deck that evolve from eligible basics
      const stage1Candidates = actor.deck.filter((c) =>
        c.card.category === "Pokemon" && c.card.stage === "Stage1" && c.card.evolve_from &&
        eligibleBasics.some((p) => p.base.card.name === c.card.evolve_from),
      ).map((c) => c.uid);

      if (stage1Candidates.length === 0) {
        appendLog(store, "No Stage 1 evolution targets in deck.");
        return;
      }

      store.stadiumUsedThisTurn[actorIdx] = true;
      store.pendingEvolveFromDeck = {
        actorIdx,
        opponentIdx,
        candidateUids: stage1Candidates,
        selectedUids: [],
        count: 1,
        evolved: 0,
        bypassFirstTurn: false,
        bypassSameTurn: false,
        endsTurn: false,
        title: "Grand Tree",
        instruction: "Select a Stage 1 Pokémon from your deck to evolve a Basic Pokémon.",
        remainingEffects: [{ type: "stadium_chained_evolution" }],
      };
      appendLog(store, "Grand Tree: search your deck for a Stage 1 evolution.");
      return;
    }

    // Pokémon Research Lab: search for up to 2 Fossil evolutions to bench
    const fossilEvo = effects.find((e) => e.type === "stadium_fossil_evolution");
    if (fossilEvo && fossilEvo.type === "stadium_fossil_evolution") {
      const actor = store.players[actorIdx];
      const fossilEvoCandidates = actor.deck.filter((c) =>
        c.card.category === "Pokemon" && c.card.evolve_from === "Unidentified Fossil",
      ).map((c) => c.uid);

      if (fossilEvoCandidates.length === 0) {
        appendLog(store, "No Pokémon that evolve from Unidentified Fossil in your deck.");
        return;
      }
      if (actor.bench.length >= 5) {
        appendLog(store, "Your Bench is full.");
        return;
      }

      store.stadiumUsedThisTurn[actorIdx] = true;
      // Use the existing deck search mechanism for fossils → bench
      const maxCount = Math.min(fossilEvo.count, 5 - actor.bench.length);
      store.pendingDeckSearch = {
        actorIdx,
        opponentIdx,
        playerIdx: actorIdx,
        count: maxCount,
        minCount: 0,
        destination: "bench",
        candidateUids: fossilEvoCandidates,
        selectedUids: [],
        title: "Pokémon Research Lab",
        instruction: `Select up to ${maxCount} Pokémon that evolve from Unidentified Fossil to put on your Bench.`,
        remainingEffects: [{ type: "end_turn" }],
      };
      appendLog(store, "Pokémon Research Lab: search your deck for Fossil evolutions.");
      return;
    }

    appendLog(store, "This Stadium has no activatable ability.");
  });

  // ---------------------------------------------------------------------------
  // Trainer Use Drop Zone
  // ---------------------------------------------------------------------------

  const dropToTrainerUse = async (payload: DragPayload) => {
    if (payload.zone !== "hand") return;
    await playTrainerCard(payload.uid);
  };

  // ---------------------------------------------------------------------------
  // Retreat
  // ---------------------------------------------------------------------------

  const retreat = withStore((store, benchUid: string) => {
    if (!canAct(store, store.currentTurn, "retreat")) return;

    const player = store.players[store.currentTurn];
    if (!player.active) return;
    if (player.retreatedThisTurn) return;

    // Check conditions
    const engineActive = toEnginePokemon(player.active);
    const condCheck = canRetreatCondition(engineActive);
    if (!condCheck.allowed) return;

    // Check energy cost
    const retreatCost = player.active.base.card.retreat ?? 0;
    if (retreatCost > 0) {
      const engineInst = toEnginePokemon(player.active);
      if (!engineCanRetreat(engineInst)) return;

      // Discard energy for retreat cost (remove from end of attached)
      let remaining = retreatCost;
      while (remaining > 0 && player.active.attached.length > 0) {
        const lastEnergyIdx = player.active.attached.findLastIndex((a) => a.card.category === "Energy");
        if (lastEnergyIdx === -1) break;
        const [removed] = player.active.attached.splice(lastEnergyIdx, 1);
        player.discard.push(removed);
        remaining -= 1;
      }
    }

    // Find bench replacement
    const benchSlot = removeBenchPokemon(player, benchUid);
    if (!benchSlot) {
      return;
    }

    // Swap: current active goes to bench, bench comes to active
    const oldActive = player.active;
    // Clear special conditions on retreat
    oldActive.specialConditions = [];
    oldActive.poisonDamage = 10;
    oldActive.burnDamage = 20;

    player.active = benchSlot;
    player.bench.push(oldActive);
    player.retreatedThisTurn = true;

    appendLog(store, `${oldActive.base.card.name} retreated. ${benchSlot.base.card.name} is now Active.`);
  });

  // ---------------------------------------------------------------------------
  // Drag-and-drop actions (unchanged logic, updated for new fields)
  // ---------------------------------------------------------------------------

  const selectPrize = withStore((store, playerIdx: 0 | 1, uid: string) => {
    store.selectedPrizeUid[playerIdx] = uid;
  });

  const dropToActive = withStore((store, payload: DragPayload, targetPlayerIdx: 0 | 1) => {
    const sourcePlayer = store.players[payload.playerIdx];
    const targetPlayer = store.players[targetPlayerIdx];

    if (payload.zone === "bench" && payload.playerIdx === targetPlayerIdx) {
      if (!targetPlayer.active) {
        const benchSlot = removeBenchPokemon(sourcePlayer, payload.uid);
        if (!benchSlot) return;
        targetPlayer.active = benchSlot;
      } else if (store.phase === "setup") {
        const benchSlot = removeBenchPokemon(sourcePlayer, payload.uid);
        if (!benchSlot) return;
        const oldActive = targetPlayer.active;
        targetPlayer.active = benchSlot;
        targetPlayer.bench.push(oldActive);
      } else {
        // During gameplay, bench-to-active swap is a retreat
        if (targetPlayer.retreatedThisTurn) return;
        const engineActive = toEnginePokemon(targetPlayer.active);
        if (!canRetreatCondition(engineActive).allowed) return;
        if (!engineCanRetreat(engineActive)) return;

        const benchSlot = removeBenchPokemon(sourcePlayer, payload.uid);
        if (!benchSlot) return;

        const oldActive = targetPlayer.active;
        oldActive.specialConditions = [];
        oldActive.poisonDamage = 10;
        oldActive.burnDamage = 20;

        // Discard energy for retreat cost
        const retreatCost = oldActive.base.card.retreat ?? 0;
        let remaining = retreatCost;
        while (remaining > 0 && oldActive.attached.length > 0) {
          const lastEnergyIdx = oldActive.attached.findLastIndex((a) => a.card.category === "Energy");
          if (lastEnergyIdx === -1) break;
          const [removed] = oldActive.attached.splice(lastEnergyIdx, 1);
          targetPlayer.discard.push(removed);
          remaining--;
        }

        targetPlayer.active = benchSlot;
        targetPlayer.bench.push(oldActive);
        targetPlayer.retreatedThisTurn = true;
        appendLog(store, `${oldActive.base.card.name} retreated. ${benchSlot.base.card.name} is now Active.`);
      }
      return;
    }

    if (payload.zone !== "hand" || payload.playerIdx !== targetPlayerIdx) return;

    const card = removeHandCard(sourcePlayer, payload.uid);
    if (!card) return;

    if (card.card.category === "Energy") {
      if (store.phase === "setup") {
        sourcePlayer.hand.push(card);
        return;
      }
      if (!targetPlayer.active) {
        sourcePlayer.hand.push(card);
        return;
      }
      if (!canAct(store, targetPlayerIdx, "attach Energy")) {
        sourcePlayer.hand.push(card);
        return;
      }
      if (targetPlayer.energyAttachedThisTurn) {
        sourcePlayer.hand.push(card);
        return;
      }
      targetPlayer.active.attached.push(card);
      targetPlayer.energyAttachedThisTurn = true;
      appendLog(store, `P${targetPlayerIdx + 1} attached ${card.card.name} to ${targetPlayer.active.base.card.name}.`);
      return;
    }

    // Tool: drop onto active Pokemon to attach
    if (card.card.category === "Trainer" && card.card.trainer_type === "Tool") {
      if (!targetPlayer.active) {
        sourcePlayer.hand.push(card);
        return;
      }
      if (!canAct(store, targetPlayerIdx, "attach Tool")) {
        sourcePlayer.hand.push(card);
        return;
      }
      const hasTool = targetPlayer.active.attached.some((a) => a.card.trainer_type === "Tool");
      if (hasTool) {
        appendLog(store, `${targetPlayer.active.base.card.name} already has a Tool attached.`);
        sourcePlayer.hand.push(card);
        return;
      }
      targetPlayer.active.attached.push(card);
      appendLog(store, `P${targetPlayerIdx + 1} attached ${card.card.name} to ${targetPlayer.active.base.card.name}.`);
      return;
    }

    // Technical Machine: drop onto active Pokemon to attach
    if (card.card.category === "Trainer" && card.card.trainer_type === "Technical Machine") {
      if (!targetPlayer.active) {
        sourcePlayer.hand.push(card);
        return;
      }
      if (!canAct(store, targetPlayerIdx, "attach Technical Machine")) {
        sourcePlayer.hand.push(card);
        return;
      }
      targetPlayer.active.attached.push(card);
      appendLog(store, `P${targetPlayerIdx + 1} attached ${card.card.name} to ${targetPlayer.active.base.card.name}. It gains a new attack.`);
      return;
    }

    // Evolution: drop a Stage1/Stage2 card onto active Pokemon
    if (isEvolutionPokemon(card.card) && targetPlayer.active) {
      if (!canAct(store, targetPlayerIdx, "evolve")) {
        sourcePlayer.hand.push(card);
        return;
      }
      const isRareCandy = !!store.pendingRareCandy && store.pendingRareCandy.actorIdx === targetPlayerIdx;
      const evoCheck = canEvolvePokemon(card.card, targetPlayer.active, store, { rareCandy: isRareCandy });
      if (!evoCheck.ok) {
        // If Rare Candy is pending but normal evo also fails, try the other path
        if (!isRareCandy) {
          const rcCheck = store.pendingRareCandy && store.pendingRareCandy.actorIdx === targetPlayerIdx
            ? canEvolvePokemon(card.card, targetPlayer.active, store, { rareCandy: true })
            : null;
          if (!rcCheck?.ok) {
            sourcePlayer.hand.push(card);
            return;
          }
        } else {
          sourcePlayer.hand.push(card);
          return;
        }
      }
      evolvePokemon(store, targetPlayer.active, card, targetPlayerIdx);
      if (isRareCandy) {
        const remaining = store.pendingRareCandy!.remainingEffects;
        store.pendingRareCandy = null;
        applyGenericEffects(store, targetPlayerIdx, (targetPlayerIdx === 0 ? 1 : 0) as 0 | 1, remaining);
      }
      return;
    }

    if (!isBasicPokemon(card.card)) {
      sourcePlayer.hand.push(card);
      return;
    }

    if (!targetPlayer.active) {
      targetPlayer.active = makePokemonInPlay(card, store.turnNumber);
      if (store.phase !== "setup") {
        appendLog(store, `P${targetPlayerIdx + 1} set ${card.card.name} to Active.`);
      }
    } else {
      sourcePlayer.hand.push(card);
    }
  });

  const dropToBench = withStore((store, payload: DragPayload, targetPlayerIdx: 0 | 1) => {
    if (payload.zone !== "hand" || payload.playerIdx !== targetPlayerIdx) return;

    const targetPlayer = store.players[targetPlayerIdx];
    if (targetPlayer.bench.length >= 5) return;

    if (store.phase === "playing" && !canAct(store, targetPlayerIdx, "bench a Pokemon")) return;

    const card = removeHandCard(targetPlayer, payload.uid);
    if (!card) return;

    if (!isBasicPokemon(card.card)) {
      targetPlayer.hand.push(card);
      return;
    }

    targetPlayer.bench.push(makePokemonInPlay(card, store.turnNumber));
    if (store.phase !== "setup") {
      appendLog(store, `P${targetPlayerIdx + 1} benched ${card.card.name}.`);
    }
  });

  const dropToBenchSlot = withStore((store, payload: DragPayload, targetPlayerIdx: 0 | 1, benchIdx: number) => {
    if (payload.playerIdx !== targetPlayerIdx) return;

    const targetPlayer = store.players[targetPlayerIdx];
    const benchSlot = targetPlayer.bench[benchIdx];
    if (!benchSlot) return;

    if (payload.zone === "hand") {
      const card = removeHandCard(targetPlayer, payload.uid);
      if (!card) return;

      if (card.card.category === "Energy") {
        if (store.phase === "setup") {
          targetPlayer.hand.push(card);
          return;
        }
        if (!canAct(store, targetPlayerIdx, "attach Energy")) {
          targetPlayer.hand.push(card);
          return;
        }
        if (targetPlayer.energyAttachedThisTurn) {
          targetPlayer.hand.push(card);
          return;
        }
        benchSlot.attached.push(card);
        targetPlayer.energyAttachedThisTurn = true;
        store.selectedHandUid[targetPlayerIdx] = null;
        appendLog(store, `P${targetPlayerIdx + 1} attached ${card.card.name} to ${benchSlot.base.card.name}.`);
        return;
      }

      // Tool: drop onto bench Pokemon to attach
      if (card.card.category === "Trainer" && card.card.trainer_type === "Tool") {
        if (!canAct(store, targetPlayerIdx, "attach Tool")) {
          targetPlayer.hand.push(card);
          return;
        }
        const hasTool = benchSlot.attached.some((a) => a.card.trainer_type === "Tool");
        if (hasTool) {
          appendLog(store, `${benchSlot.base.card.name} already has a Tool attached.`);
          targetPlayer.hand.push(card);
          return;
        }
        benchSlot.attached.push(card);
        store.selectedHandUid[targetPlayerIdx] = null;
        appendLog(store, `P${targetPlayerIdx + 1} attached ${card.card.name} to ${benchSlot.base.card.name}.`);
        return;
      }

      // Technical Machine: drop onto bench Pokemon to attach
      if (card.card.category === "Trainer" && card.card.trainer_type === "Technical Machine") {
        if (!canAct(store, targetPlayerIdx, "attach Technical Machine")) {
          targetPlayer.hand.push(card);
          return;
        }
        benchSlot.attached.push(card);
        store.selectedHandUid[targetPlayerIdx] = null;
        appendLog(store, `P${targetPlayerIdx + 1} attached ${card.card.name} to ${benchSlot.base.card.name}. It gains a new attack.`);
        return;
      }

      // Evolution: drop a Stage1/Stage2 card onto a bench Pokemon
      if (isEvolutionPokemon(card.card)) {
        if (!canAct(store, targetPlayerIdx, "evolve")) {
          targetPlayer.hand.push(card);
          return;
        }
        const isRareCandy = !!store.pendingRareCandy && store.pendingRareCandy.actorIdx === targetPlayerIdx;
        const evoCheck = canEvolvePokemon(card.card, benchSlot, store, { rareCandy: isRareCandy });
        if (!evoCheck.ok && !isRareCandy) {
          const rcCheck = store.pendingRareCandy && store.pendingRareCandy.actorIdx === targetPlayerIdx
            ? canEvolvePokemon(card.card, benchSlot, store, { rareCandy: true })
            : null;
          if (!rcCheck?.ok) {
            targetPlayer.hand.push(card);
            return;
          }
        } else if (!evoCheck.ok) {
          targetPlayer.hand.push(card);
          return;
        }
        evolvePokemon(store, benchSlot, card, targetPlayerIdx);
        if (isRareCandy || (store.pendingRareCandy && store.pendingRareCandy.actorIdx === targetPlayerIdx)) {
          const remaining = store.pendingRareCandy!.remainingEffects;
          store.pendingRareCandy = null;
          applyGenericEffects(store, targetPlayerIdx, (targetPlayerIdx === 0 ? 1 : 0) as 0 | 1, remaining);
        }
        return;
      }

      targetPlayer.hand.push(card);
      return;
    }

    if (payload.zone === "bench" && payload.uid !== benchSlot.uid) {
      const draggedIdx = targetPlayer.bench.findIndex((bench) => bench.uid === payload.uid);
      if (draggedIdx === -1) return;
      const temp = targetPlayer.bench[draggedIdx];
      targetPlayer.bench[draggedIdx] = benchSlot;
      targetPlayer.bench[benchIdx] = temp;
      appendLog(store, `P${targetPlayerIdx + 1} rearranged bench.`);
    }
  });

  const dropToDiscard = withStore((store, payload: DragPayload, targetPlayerIdx: 0 | 1) => {
    if (payload.playerIdx !== targetPlayerIdx || payload.zone !== "hand") return;

    const targetPlayer = store.players[targetPlayerIdx];
    const card = removeHandCard(targetPlayer, payload.uid);
    if (!card) return;
    targetPlayer.discard.push(card);
    appendLog(store, `P${targetPlayerIdx + 1} discarded ${card.card.name}.`);
  });

  const dropToStadium = withStore((store, payload: DragPayload) => {
    if (payload.zone !== "hand") return;
    const player = store.players[payload.playerIdx];
    const card = removeHandCard(player, payload.uid);
    if (!card) return;
    if (card.card.category !== "Trainer" || card.card.trainer_type !== "Stadium") {
      // Not a stadium card — put it back
      player.hand.push(card);
      return;
    }
    if (!canAct(store, payload.playerIdx, "play Stadium")) {
      player.hand.push(card);
      return;
    }
    const canPlay = canPlayTrainer(
      toEngineCardInstance(card),
      toEngineBoard(player),
      buildEngineState(store),
      payload.playerIdx,
    );
    if (!canPlay.allowed) {
      if (canPlay.reason) appendLog(store, canPlay.reason);
      player.hand.push(card);
      return;
    }
    const oldStadium = store.stadium;
    store.stadium = { card, playedByPlayer: payload.playerIdx };
    appendLog(store, `P${payload.playerIdx + 1} plays ${card.card.name} (Stadium).`);
    if (oldStadium) {
      const oldOwner = store.players[oldStadium.playedByPlayer];
      oldOwner.discard.push(oldStadium.card);
      appendLog(store, `${oldStadium.card.card.name} is discarded.`);
    }
  });

  const dropToHand = withStore((store, payload: DragPayload, targetPlayerIdx: 0 | 1) => {
    if (payload.playerIdx !== targetPlayerIdx || payload.zone !== "prize") return;

    const player = store.players[targetPlayerIdx];
    const card = removePrizeCard(player, payload.uid);
    if (!card) return;
    player.hand.push(card);

    store.revealedPrizeUids[targetPlayerIdx] = store.revealedPrizeUids[targetPlayerIdx].filter((uid) => uid !== payload.uid);
    appendLog(store, `P${targetPlayerIdx + 1} moved a revealed Prize to hand.`);
  });

  return {
    autoSetup,
    actions: {
      selectPrize,
      dropToActive,
      dropToBench,
      dropToBenchSlot,
      dropToDiscard,
      dropToHand,
      dropToStadium,
      selectHandCard,
      deselectHandCard,
      useAttack,
      useAbility,
      playTrainerCard,
      toggleHandSelectionCard,
      confirmHandSelection,
      toggleDeckSearchCard,
      confirmDeckSearch,
      cancelDeckSearch,
      confirmOpponentSwitch,
      cancelOpponentSwitch,
      confirmSelfSwitch,
      cancelSelfSwitch,
      cancelRareCandy,
      toggleEvolveFromDeckCard,
      confirmEvolveFromDeck,
      cancelEvolveFromDeck,
      useStadiumAbility,
      dropToTrainerUse,
      retreat,
      endTurn,
      newGame: startNewGame,
    },
  };
}
