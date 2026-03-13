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
} from "./logic";
import {
  toEnginePokemon,
  toEngineBoard,
  toEngineCardInstance,
  syncFromEnginePokemon,
} from "./engine-bridge";
import {
  parseDamage,
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

  owner.deck.push(...cards);
  owner.deck = owner.deck.sort(() => Math.random() - 0.5);
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

function applyGenericEffects(
  store: SimulatorStore,
  actorIdx: 0 | 1,
  opponentIdx: 0 | 1,
  effects: EffectAction[],
): void {
  const actor = store.players[actorIdx];
  const opponent = store.players[opponentIdx];

  for (const effect of effects) {
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
        const incoming = targetPlayer.bench.shift();
        if (!targetPlayer.active || !incoming) {
          appendLog(store, `Switch effect for P${targetIdx + 1} had no valid bench target.`);
          break;
        }
        const previousActive = targetPlayer.active;
        previousActive.specialConditions = [];
        previousActive.poisonDamage = 10;
        previousActive.burnDamage = 20;
        targetPlayer.active = incoming;
        targetPlayer.bench.push(previousActive);
        appendLog(store, `P${targetIdx + 1} switches ${previousActive.base.card.name} with ${incoming.base.card.name}.`);
        break;
      }
      case "shuffle_hand_draw": {
        const targetPlayer = effect.player === "self" ? actor : opponent;
        targetPlayer.deck.push(...targetPlayer.hand);
        targetPlayer.hand = [];
        targetPlayer.deck = targetPlayer.deck.sort(() => Math.random() - 0.5);
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
        // Auto-search: pick the first N matching cards from deck and add to hand
        const found: CardInstance[] = [];
        for (let i = 0; i < searchPlayer.deck.length && found.length < effect.count; i += 1) {
          const card = searchPlayer.deck[i];
          if (effect.filter) {
            const filterLower = effect.filter.toLowerCase();
            // Basic filter matching: "Pokemon", "Energy", "Trainer", or type names
            if (filterLower.includes("pokemon") && card.card.category !== "Pokemon") continue;
            if (filterLower.includes("energy") && card.card.category !== "Energy") continue;
            if (filterLower.includes("trainer") && card.card.category !== "Trainer") continue;
          }
          found.push(card);
        }
        for (const card of found) {
          const idx = searchPlayer.deck.indexOf(card);
          if (idx !== -1) searchPlayer.deck.splice(idx, 1);
          searchPlayer.hand.push(card);
        }
        // Shuffle deck after search
        searchPlayer.deck = searchPlayer.deck.sort(() => Math.random() - 0.5);
        appendLog(store, `P${searchPlayerIdx + 1} searched their deck and found ${found.length} card(s).`);
        break;
      }
      case "discard_card": {
        if (effect.source === "hand") {
          let remaining = effect.count;
          while (remaining > 0 && actor.hand.length > 0) {
            const discarded = actor.hand.pop();
            if (!discarded) break;
            actor.discard.push(discarded);
            remaining -= 1;
          }
          appendLog(store, `P${actorIdx + 1} discarded ${effect.count - remaining} card(s) from hand.`);
        } else {
          appendLog(store, `Unsupported discard_card source: ${effect.source}.`);
        }
        break;
      }
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
      appendLog(store, `${card.name} requires selecting a target Pokemon. That flow is not implemented yet.`);
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
      player.discard.push(playedCard);
    }
  });

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

    // Evolution: drop a Stage1/Stage2 card onto active Pokemon
    if (isEvolutionPokemon(card.card) && targetPlayer.active) {
      if (!canAct(store, targetPlayerIdx, "evolve")) {
        sourcePlayer.hand.push(card);
        return;
      }
      const evoCheck = canEvolvePokemon(card.card, targetPlayer.active, store);
      if (!evoCheck.ok) {
        sourcePlayer.hand.push(card);
        return;
      }
      evolvePokemon(store, targetPlayer.active, card, targetPlayerIdx);
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

      // Evolution: drop a Stage1/Stage2 card onto a bench Pokemon
      if (isEvolutionPokemon(card.card)) {
        if (!canAct(store, targetPlayerIdx, "evolve")) {
          targetPlayer.hand.push(card);
          return;
        }
        const evoCheck = canEvolvePokemon(card.card, benchSlot, store);
        if (!evoCheck.ok) {
          targetPlayer.hand.push(card);
          return;
        }
        evolvePokemon(store, benchSlot, card, targetPlayerIdx);
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
      retreat,
      endTurn,
      newGame: startNewGame,
    },
  };
}
