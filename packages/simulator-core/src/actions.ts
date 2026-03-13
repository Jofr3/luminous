import {
  applyPokemonCheckup,
  applySpecialCondition,
  canPlayTrainer,
  canRetreat as engineCanRetreat,
  canRetreatCondition,
  canUseAbility,
  endTurnParalysisCheck,
  parseDamage,
  parseEffectText,
  playTrainer,
  prizesToTake,
  resolveAttack,
  useAbility as resolveAbilityUse,
  validateAttack,
} from "@luminous/engine";
import type { CardAttack, EffectAction, GameState as EngineGameState } from "@luminous/engine";
import { syncFromEnginePokemon, toEngineBoard, toEngineCardInstance, toEnginePokemon } from "./engine-bridge";
import {
  appendLog,
  buildEngineState,
  canAct,
  canEvolvePokemon,
  drawFromDeck,
  findPokemon,
  isBasicPokemon,
  isEvolutionPokemon,
  makePokemonInPlay,
  matchesDeckSearchFilter,
  removeBenchPokemon,
  removeHandCard,
  removePrizeCard,
  shuffle,
} from "./helpers";
import type { CardInstance, PlayerIndex, PokemonInPlay, SimulatorAction, SimulatorStore } from "./types";

function cloneStore<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function evolvePokemon(
  store: SimulatorStore,
  pokemon: PokemonInPlay,
  evoCard: CardInstance,
  playerIdx: PlayerIndex,
): void {
  const oldName = pokemon.base.card.name;
  pokemon.attached.push(pokemon.base);
  pokemon.base = evoCard;
  pokemon.turnPlayedOrEvolved = store.turnNumber;
  pokemon.specialConditions = [];
  pokemon.poisonDamage = 10;
  pokemon.burnDamage = 20;
  pokemon.usedAbilityThisTurn = false;
  appendLog(store, `P${playerIdx + 1} evolved ${oldName} into ${evoCard.card.name}.`);
}

function discardActivePokemon(store: SimulatorStore, playerIdx: PlayerIndex): void {
  const player = store.players[playerIdx];
  const active = player.active;
  if (!active) return;
  player.discard.push(active.base, ...active.attached);
  player.active = null;
}

function takePrizeCards(store: SimulatorStore, takerIdx: PlayerIndex, count: number, reason: string): void {
  const player = store.players[takerIdx];
  let taken = 0;
  for (let i = 0; i < count && player.prizes.length > 0; i += 1) {
    const prize = player.prizes.shift();
    if (!prize) continue;
    player.hand.push(prize);
    player.takenPrizes += 1;
    taken += 1;
  }
  if (taken > 0) appendLog(store, `P${takerIdx + 1} takes ${taken} Prize card(s) ${reason}.`);
}

function promoteActiveOrDeclareLoss(store: SimulatorStore, playerIdx: PlayerIndex, reason: string): void {
  const player = store.players[playerIdx];
  if (player.active || store.winner !== null) return;
  if (player.bench.length === 0) {
    store.winner = playerIdx === 0 ? 1 : 0;
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
  knockedOutPlayerIdx: PlayerIndex,
  prizeCount: number,
  reason: string,
): void {
  const player = store.players[knockedOutPlayerIdx];
  const active = player.active;
  if (!active) return;

  appendLog(store, `${active.base.card.name} is Knocked Out${reason}!`);
  discardActivePokemon(store, knockedOutPlayerIdx);

  const takerIdx = (knockedOutPlayerIdx === 0 ? 1 : 0) as PlayerIndex;
  takePrizeCards(
    store,
    takerIdx,
    prizeCount,
    reason === " by conditions" ? "from the condition KO." : "from the knockout.",
  );
  if (applyWinChecks(store)) return;
  promoteActiveOrDeclareLoss(store, knockedOutPlayerIdx, "after the knockout");
}

function runPokemonCheckup(store: SimulatorStore, playerIdx: PlayerIndex): void {
  const player = store.players[playerIdx];
  if (!player.active) return;
  const enginePokemon = toEnginePokemon(player.active);
  if (playerIdx === store.currentTurn) {
    const paralysisLog = endTurnParalysisCheck(enginePokemon);
    if (paralysisLog) appendLog(store, paralysisLog);
  }
  const logs = applyPokemonCheckup(enginePokemon);
  for (const log of logs) appendLog(store, log);
  syncFromEnginePokemon(player.active, enginePokemon);
  if (player.active.damage >= (player.active.base.card.hp ?? 0)) {
    resolveActiveKnockOut(store, playerIdx, prizesToTake(enginePokemon), " by conditions");
  }
}

function finishTurn(store: SimulatorStore): void {
  const currentPlayer = store.players[store.currentTurn];
  if (currentPlayer.trainerUseZone.length > 0) {
    currentPlayer.discard.push(...currentPlayer.trainerUseZone);
    currentPlayer.trainerUseZone = [];
  }

  runPokemonCheckup(store, 0);
  if (store.winner !== null) return;
  runPokemonCheckup(store, 1);
  if (store.winner !== null) return;

  const next = (store.currentTurn === 0 ? 1 : 0) as PlayerIndex;
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
    store.winner = next === 0 ? 1 : 0;
    appendLog(store, `P${next + 1} cannot draw at turn start and loses.`);
    return;
  }
  nextPlayer.hand.push(...drawn);
  store.turnDrawDone = true;
}

function removePokemonFromPlay(store: SimulatorStore, playerIdx: PlayerIndex, pokemonUid: string): PokemonInPlay | null {
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

function movePokemonCards(
  store: SimulatorStore,
  playerIdx: PlayerIndex,
  pokemon: PokemonInPlay,
  destination: "hand" | "deck" | "discard",
): void {
  const owner = store.players[playerIdx];
  const cards = [pokemon.base, ...pokemon.attached];
  if (destination === "discard") owner.discard.push(...cards);
  else if (destination === "hand") owner.hand.push(...cards);
  else owner.deck = shuffle([...owner.deck, ...cards]);
}

function autoPromoteFirstBench(store: SimulatorStore, playerIdx: PlayerIndex, reason: string): void {
  const player = store.players[playerIdx];
  if (player.active || player.bench.length === 0) return;
  const promoted = player.bench.shift();
  if (!promoted) return;
  player.active = promoted;
  appendLog(store, `P${playerIdx + 1} promotes ${promoted.base.card.name} ${reason}.`);
}

function queueDeckSearchPrompt(
  store: SimulatorStore,
  actorIdx: PlayerIndex,
  opponentIdx: PlayerIndex,
  playerIdx: PlayerIndex,
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
  actorIdx: PlayerIndex,
  opponentIdx: PlayerIndex,
  playerIdx: PlayerIndex,
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
  actorIdx: PlayerIndex,
  opponentIdx: PlayerIndex,
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
        const targetPlayer = effect.player === "self" ? actor : opponent;
        const drawn = drawFromDeck(targetPlayer, effect.count);
        targetPlayer.hand.push(...drawn);
        appendLog(store, `P${effect.player === "self" ? actorIdx + 1 : opponentIdx + 1} drew ${drawn.length} card(s).`);
        break;
      }
      case "heal": {
        const target = effect.target === "self"
          ? actor.active
          : effect.pokemonUid
            ? findPokemon(store, actorIdx, effect.pokemonUid)
            : actor.active;
        if (!target) break;
        target.damage = Math.max(0, target.damage - effect.amount);
        appendLog(store, `${target.base.card.name} healed ${effect.amount} damage.`);
        break;
      }
      case "discard_energy": {
        const target = effect.target === "self" ? actor.active : opponent.active;
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
          (effect.target === "self" ? actor : opponent).discard.push(removed);
          remaining -= 1;
        }
        break;
      }
      case "damage": {
        const target = effect.target === "self"
          ? actor.active
          : effect.target === "defender"
            ? opponent.active
            : effect.pokemonUid
              ? findPokemon(store, opponentIdx, effect.pokemonUid)
              : opponent.bench[0] ?? null;
        if (!target) break;
        target.damage += effect.amount;
        appendLog(store, `${target.base.card.name} takes ${effect.amount} damage.`);
        if (target.damage >= (target.base.card.hp ?? 0)) {
          const targetIdx = effect.target === "self" ? actorIdx : opponentIdx;
          resolveActiveKnockOut(store, targetIdx, prizesToTake(toEnginePokemon(target)), " from effect damage");
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
          store.pendingOpponentSwitch = { actorIdx, opponentIdx, remainingEffects };
          appendLog(store, "Choose a Pokemon from your opponent's Bench to switch with their Active Pokemon.");
          return;
        }
        store.pendingSelfSwitch = { actorIdx, opponentIdx, remainingEffects };
        appendLog(store, "Choose one of your Benched Pokemon to switch with your Active Pokemon.");
        return;
      }
      case "rare_candy": {
        store.pendingRareCandy = { actorIdx, remainingEffects };
        appendLog(store, "Rare Candy: drag a Stage 2 Pokemon from your hand onto an eligible Basic Pokemon.");
        return;
      }
      case "evolve_from_deck": {
        const allInPlay = [actor.active, ...actor.bench].filter((pokemon): pokemon is PokemonInPlay => pokemon !== null);
        const eligiblePokemon = allInPlay.filter((pokemon) => !effect.bypassSameTurn || pokemon.turnPlayedOrEvolved < store.turnNumber);
        const candidateUids = actor.deck.filter((card) => {
          if (card.card.category !== "Pokemon" || card.card.stage === "Basic" || !card.card.stage) return false;
          if (!card.card.evolve_from) return false;
          if (effect.excludeSuffix && card.card.suffix === effect.excludeSuffix) return false;
          if (effect.requireSuffix && card.card.suffix !== effect.requireSuffix) return false;
          if (effect.requireNoAbilities && (card.card.abilities?.length ?? 0) > 0) return false;
          if (effect.allowedNames && !effect.allowedNames.some((name) => card.card.name.startsWith(name))) return false;
          return eligiblePokemon.some((pokemon) => pokemon.base.card.name === card.card.evolve_from);
        }).map((card) => card.uid);

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
          instruction: `Select a Pokemon to evolve (${effect.count} remaining).`,
          remainingEffects,
        };
        appendLog(store, "Search your deck for a Pokemon to evolve.");
        return;
      }
      case "end_turn":
        appendLog(store, "Turn ends (card effect).");
        finishTurn(store);
        return;
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
        const sourceZone =
          effect.source === "discard" ? actor.discard :
            effect.source === "hand" ? actor.hand : actor.deck;
        const target = actor.active;
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
        movePokemonCards(store, targetIdx, removed, effect.destination === "deck" ? "deck" : "hand");
        appendLog(store, `${removed.base.card.name} was returned to ${effect.destination}.`);
        autoPromoteFirstBench(store, targetIdx, "after the bounce");
        break;
      }
      case "search_deck": {
        const searchPlayerIdx = effect.player === "self" ? actorIdx : opponentIdx;
        const searchPlayer = store.players[searchPlayerIdx];
        if (searchPlayer.deck.length === 0) {
          appendLog(store, `P${searchPlayerIdx + 1} has no cards in deck to search.`);
          break;
        }
        queueDeckSearchPrompt(store, actorIdx, opponentIdx, searchPlayerIdx, effect, remainingEffects);
        return;
      }
      case "discard_card":
        queueHandSelectionPrompt(store, actorIdx, opponentIdx, actorIdx, effect, remainingEffects);
        return;
      case "multi_coin_flip": {
        let heads = 0;
        for (let i = 0; i < effect.coins; i += 1) {
          if (Math.random() < 0.5) heads += 1;
        }
        appendLog(store, `Flipped ${effect.coins} coins: ${heads} Heads, ${effect.coins - heads} Tails.`);
        if (heads > 0) {
          for (const perHead of effect.perHeads) {
            if (perHead.type === "damage") {
              applyGenericEffects(store, actorIdx, opponentIdx, [{ ...perHead, amount: perHead.amount * heads }]);
            } else {
              for (let i = 0; i < heads; i += 1) applyGenericEffects(store, actorIdx, opponentIdx, [perHead]);
            }
          }
        }
        break;
      }
      case "cant_attack":
        appendLog(store, "This Pokemon can't attack during its next turn.");
        break;
      case "cant_retreat":
        appendLog(store, "The Defending Pokemon can't retreat during the next turn.");
        break;
      case "ignore_resistance":
        appendLog(store, "This attack's damage isn't affected by Resistance.");
        break;
      case "prevent_damage":
        appendLog(store, "Damage prevention effect noted (not fully tracked in simulator).");
        break;
      case "custom":
        appendLog(store, `Manual effect: ${effect.description}`);
        break;
      default:
        break;
    }
  }
}

function applyActionInPlace(store: SimulatorStore, action: SimulatorAction): void {
  switch (action.type) {
    case "selectPrize":
      store.selectedPrizeUid[action.playerIdx] = action.uid;
      return;
    case "selectHandCard":
      store.selectedHandUid[action.playerIdx] =
        store.selectedHandUid[action.playerIdx] === action.uid ? null : action.uid;
      return;
    case "deselectHandCard":
      store.selectedHandUid[action.playerIdx] = null;
      return;
    case "endTurn": {
      if (store.phase === "setup") {
        const player = store.players[store.currentTurn];
        if (!player.active) return;
        const otherIdx = (store.currentTurn === 0 ? 1 : 0) as PlayerIndex;
        if (!store.players[otherIdx].active) {
          appendLog(store, `P${store.currentTurn + 1} set ${player.active.base.card.name} to Active.`);
          for (const bench of player.bench) appendLog(store, `P${store.currentTurn + 1} benched ${bench.base.card.name}.`);
          store.currentTurn = otherIdx;
          return;
        }
        appendLog(store, `P${store.currentTurn + 1} set ${player.active.base.card.name} to Active.`);
        for (const bench of player.bench) appendLog(store, `P${store.currentTurn + 1} benched ${bench.base.card.name}.`);
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
      return;
    }
    case "useAttack": {
      if (!canAct(store, store.currentTurn, "attack")) return;
      if (store.turnNumber === 1 && store.currentTurn === store.firstPlayer) return;
      const attacker = store.players[store.currentTurn];
      const defenderIdx = (store.currentTurn === 0 ? 1 : 0) as PlayerIndex;
      const defender = store.players[defenderIdx];
      if (!attacker.active || !defender.active) return;
      const frontendAttack = attacker.active.base.card.attacks?.[action.attackIdx];
      if (!frontendAttack) return;
      const damage = parseDamage(frontendAttack.damage);
      const engineAttack: CardAttack = {
        name: frontendAttack.name ?? "Unknown",
        cost: (frontendAttack.cost ?? []) as CardAttack["cost"],
        damageBase: damage.base,
        damageMod: damage.mod,
        damageRaw: damage.raw,
        effect: frontendAttack.effect ?? null,
      };
      const engineAttacker = toEnginePokemon(attacker.active);
      const engineDefender = toEnginePokemon(defender.active);
      const validation = validateAttack(engineAttacker, engineAttack);
      if (!validation.valid) return;
      const result = resolveAttack({
        attacker: engineAttacker,
        defender: engineDefender,
        attack: engineAttack,
        attackerBoard: toEngineBoard(attacker),
        defenderBoard: toEngineBoard(defender),
        state: buildEngineState(store) as EngineGameState,
      });
      for (const log of result.logs) appendLog(store, log);
      applyGenericEffects(store, store.currentTurn, defenderIdx, result.effects);
      syncFromEnginePokemon(attacker.active, engineAttacker);
      if (defender.active) syncFromEnginePokemon(defender.active, engineDefender);
      if (attacker.active.damage >= (attacker.active.base.card.hp ?? 0)) {
        resolveActiveKnockOut(store, store.currentTurn, prizesToTake(engineAttacker), " from self-damage");
        if (store.winner !== null) return;
      }
      if (result.defenderKnockedOut && defender.active) {
        resolveActiveKnockOut(store, defenderIdx, prizesToTake(engineDefender), "");
        if (store.winner !== null) return;
      }
      finishTurn(store);
      return;
    }
    case "useAbility": {
      if (!canAct(store, store.currentTurn, "use ability")) return;
      const player = store.players[store.currentTurn];
      const pokemon = player.active?.uid === action.pokemonUid
        ? player.active
        : player.bench.find((entry) => entry.uid === action.pokemonUid) ?? null;
      if (!pokemon) return;
      const enginePokemon = toEnginePokemon(pokemon);
      const ability = enginePokemon.base.card.abilities[action.abilityIdx];
      if (!ability) return;
      const canUse = canUseAbility(enginePokemon, ability);
      if (!canUse.allowed) {
        if (canUse.reason) appendLog(store, canUse.reason);
        return;
      }
      const result = resolveAbilityUse(enginePokemon, ability, toEngineBoard(player), buildEngineState(store));
      syncFromEnginePokemon(pokemon, enginePokemon);
      for (const log of result.logs) appendLog(store, log);
      applyGenericEffects(store, store.currentTurn, (store.currentTurn === 0 ? 1 : 0) as PlayerIndex, result.effects);
      return;
    }
    case "playTrainerCard": {
      if (!canAct(store, store.currentTurn, "play Trainer")) return;
      const player = store.players[store.currentTurn];
      const cardInHand = player.hand.find((card) => card.uid === action.uid);
      if (!cardInHand || cardInHand.card.category !== "Trainer") return;
      const engineCard = toEngineCardInstance(cardInHand);
      const canPlay = canPlayTrainer(engineCard, toEngineBoard(player), buildEngineState(store), store.currentTurn);
      if (!canPlay.allowed) {
        if (canPlay.reason) appendLog(store, canPlay.reason);
        return;
      }
      if (engineCard.card.trainerType === "Tool" || engineCard.card.trainerType === "Technical Machine") {
        appendLog(store, `Drag ${cardInHand.card.name} onto a Pokemon to attach it.`);
        return;
      }
      const discardCosts = (engineCard.card.effect ? parseEffectText(engineCard.card.effect) : [])
        .filter((effect: EffectAction): effect is Extract<EffectAction, { type: "discard_card" }> => effect.type === "discard_card" && effect.source === "hand");
      const requiredDiscardCount = discardCosts.reduce((sum, effect) => sum + effect.count, 0);
      if (requiredDiscardCount > 0 && player.hand.length - 1 < requiredDiscardCount) {
        appendLog(store, `${cardInHand.card.name} requires discarding ${requiredDiscardCount} other card(s) from hand.`);
        return;
      }
      const playedCard = removeHandCard(player, action.uid);
      if (!playedCard) return;
      const result = playTrainer(engineCard, toEngineBoard(player), buildEngineState(store), store.currentTurn);
      for (const log of result.logs) appendLog(store, log);
      if (engineCard.card.trainerType === "Supporter") player.supporterPlayedThisTurn = true;
      if (engineCard.card.trainerType === "Stadium") {
        if (store.stadium) {
          const oldOwner = store.players[store.stadium.playedByPlayer];
          oldOwner.discard.push(store.stadium.card);
        }
        store.stadium = { card: playedCard, playedByPlayer: store.currentTurn };
        return;
      }
      applyGenericEffects(store, store.currentTurn, (store.currentTurn === 0 ? 1 : 0) as PlayerIndex, result.effects);
      if (["Item", "Supporter", "ACE SPEC", "Rocket's Secret Machine"].includes(engineCard.card.trainerType ?? "")) {
        player.trainerUseZone.push(playedCard);
      }
      return;
    }
    case "toggleDeckSearchCard": {
      const pending = store.pendingDeckSearch;
      if (!pending || !pending.candidateUids.includes(action.uid)) return;
      const selected = new Set(pending.selectedUids);
      if (selected.has(action.uid)) selected.delete(action.uid);
      else if (selected.size < pending.count) selected.add(action.uid);
      pending.selectedUids = [...selected];
      return;
    }
    case "toggleHandSelectionCard": {
      const pending = store.pendingHandSelection;
      if (!pending || !pending.candidateUids.includes(action.uid)) return;
      const selected = new Set(pending.selectedUids);
      if (selected.has(action.uid)) selected.delete(action.uid);
      else if (selected.size < pending.count) selected.add(action.uid);
      pending.selectedUids = [...selected];
      return;
    }
    case "confirmHandSelection": {
      const pending = store.pendingHandSelection;
      if (!pending || pending.selectedUids.length < pending.minCount) return;
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
      return;
    }
    case "confirmDeckSearch": {
      const pending = store.pendingDeckSearch;
      if (!pending || pending.selectedUids.length < pending.minCount) return;
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
        appendLog(store, `P${pending.playerIdx + 1} searched their deck and benched ${Math.min(selectedCards.length, benchSpace)} card(s).`);
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
      return;
    }
    case "cancelDeckSearch": {
      const pending = store.pendingDeckSearch;
      if (!pending || pending.minCount > 0) return;
      const player = store.players[pending.playerIdx];
      player.deck = shuffle(player.deck);
      appendLog(store, `P${pending.playerIdx + 1} finished searching their deck without taking cards.`);
      store.pendingDeckSearch = null;
      return;
    }
    case "confirmOpponentSwitch": {
      const pending = store.pendingOpponentSwitch;
      if (!pending) return;
      const opponent = store.players[pending.opponentIdx];
      if (!opponent.active) {
        store.pendingOpponentSwitch = null;
        return;
      }
      const benchIdx = opponent.bench.findIndex((pokemon) => pokemon.uid === action.benchUid);
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
      return;
    }
    case "cancelOpponentSwitch":
      if (!store.pendingOpponentSwitch) return;
      store.pendingOpponentSwitch = null;
      appendLog(store, "Opponent switch cancelled.");
      return;
    case "confirmSelfSwitch": {
      const pending = store.pendingSelfSwitch;
      if (!pending) return;
      const player = store.players[pending.actorIdx];
      if (!player.active) {
        store.pendingSelfSwitch = null;
        return;
      }
      const benchIdx = player.bench.findIndex((pokemon) => pokemon.uid === action.benchUid);
      if (benchIdx === -1) return;
      const [incoming] = player.bench.splice(benchIdx, 1);
      if (!incoming) return;
      const previousActive = player.active;
      previousActive.specialConditions = [];
      previousActive.poisonDamage = 10;
      previousActive.burnDamage = 20;
      player.active = incoming;
      player.bench.push(previousActive);
      appendLog(store, `P${pending.actorIdx + 1} switches ${previousActive.base.card.name} with ${incoming.base.card.name}.`);
      const remainingEffects = pending.remainingEffects;
      const actorIdx = pending.actorIdx;
      const opponentIdx = pending.opponentIdx;
      store.pendingSelfSwitch = null;
      applyGenericEffects(store, actorIdx, opponentIdx, remainingEffects);
      return;
    }
    case "cancelSelfSwitch":
      if (!store.pendingSelfSwitch) return;
      store.pendingSelfSwitch = null;
      appendLog(store, "Self switch cancelled.");
      return;
    case "cancelRareCandy":
      if (!store.pendingRareCandy) return;
      store.pendingRareCandy = null;
      appendLog(store, "Rare Candy cancelled.");
      return;
    case "toggleEvolveFromDeckCard": {
      const pending = store.pendingEvolveFromDeck;
      if (!pending || !pending.candidateUids.includes(action.uid)) return;
      pending.selectedUids = pending.selectedUids.includes(action.uid) ? [] : [action.uid];
      return;
    }
    case "confirmEvolveFromDeck": {
      const pending = store.pendingEvolveFromDeck;
      if (!pending || pending.selectedUids.length !== 1) return;
      const actor = store.players[pending.actorIdx];
      const selectedUid = pending.selectedUids[0];
      const cardIdx = actor.deck.findIndex((card) => card.uid === selectedUid);
      if (cardIdx === -1) return;
      const evoCard = actor.deck[cardIdx];
      const allInPlay = [actor.active, ...actor.bench].filter((pokemon): pokemon is PokemonInPlay => pokemon !== null);
      const validTarget = allInPlay.find((pokemon) => {
        if (!pending.bypassSameTurn && pokemon.turnPlayedOrEvolved >= store.turnNumber) return false;
        if (pokemon.base.card.name !== evoCard.card.evolve_from) return false;
        if (evoCard.card.stage === "Stage1" && pokemon.base.card.stage !== "Basic") return false;
        if (evoCard.card.stage === "Stage2" && pokemon.base.card.stage !== "Stage1") return false;
        return true;
      });
      if (!validTarget) {
        appendLog(store, `No valid target Pokemon in play for ${evoCard.card.name}.`);
        return;
      }
      actor.deck.splice(cardIdx, 1);
      evolvePokemon(store, validTarget, evoCard, pending.actorIdx);
      pending.evolved += 1;
      if (pending.evolved < pending.count) {
        const eligiblePokemon = [actor.active, ...actor.bench].filter((pokemon): pokemon is PokemonInPlay =>
          pokemon !== null && (pending.bypassSameTurn || pokemon.turnPlayedOrEvolved < store.turnNumber),
        );
        const newCandidates = actor.deck.filter((card) => {
          if (card.card.category !== "Pokemon" || card.card.stage === "Basic" || !card.card.stage) return false;
          if (!card.card.evolve_from) return false;
          if (pending.excludeSuffix && card.card.suffix === pending.excludeSuffix) return false;
          if (pending.requireSuffix && card.card.suffix !== pending.requireSuffix) return false;
          if (pending.requireNoAbilities && (card.card.abilities?.length ?? 0) > 0) return false;
          if (pending.allowedNames && !pending.allowedNames.some((name) => card.card.name.startsWith(name))) return false;
          return eligiblePokemon.some((pokemon) => pokemon.base.card.name === card.card.evolve_from);
        }).map((card) => card.uid);
        if (newCandidates.length > 0) {
          pending.candidateUids = newCandidates;
          pending.selectedUids = [];
          pending.instruction = `Select a Pokemon to evolve (${pending.count - pending.evolved} remaining).`;
          return;
        }
      }
      const chainedEvo = pending.remainingEffects.find((effect) => effect.type === "stadium_chained_evolution");
      if (chainedEvo && evoCard.card.stage === "Stage1") {
        const stage2Candidates = actor.deck.filter((card) =>
          card.card.category === "Pokemon" &&
          card.card.stage === "Stage2" &&
          card.card.evolve_from === evoCard.card.name,
        ).map((card) => card.uid);
        if (stage2Candidates.length > 0) {
          pending.candidateUids = stage2Candidates;
          pending.selectedUids = [];
          pending.count = 1;
          pending.evolved = 0;
          pending.title = "Grand Tree (Stage 2)";
          pending.instruction = `Optionally select a Stage 2 Pokemon that evolves from ${evoCard.card.name}.`;
          pending.remainingEffects = pending.remainingEffects.filter((effect) => effect.type !== "stadium_chained_evolution");
          return;
        }
      }
      actor.deck = shuffle(actor.deck);
      const endsTurn = pending.endsTurn;
      const remainingEffects = pending.remainingEffects.filter((effect) => effect.type !== "stadium_chained_evolution");
      const actorIdx = pending.actorIdx;
      const opponentIdx = pending.opponentIdx;
      store.pendingEvolveFromDeck = null;
      applyGenericEffects(store, actorIdx, opponentIdx, remainingEffects);
      if (endsTurn) {
        appendLog(store, "Turn ends (card effect).");
        finishTurn(store);
      }
      return;
    }
    case "cancelEvolveFromDeck":
      if (!store.pendingEvolveFromDeck) return;
      store.players[store.pendingEvolveFromDeck.actorIdx].deck = shuffle(store.players[store.pendingEvolveFromDeck.actorIdx].deck);
      store.pendingEvolveFromDeck = null;
      appendLog(store, "Evolution search cancelled.");
      return;
    case "useStadiumAbility": {
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
      const opponentIdx = (actorIdx === 0 ? 1 : 0) as PlayerIndex;
      const actor = store.players[actorIdx];
      const chainedEvo = effects.find((effect) => effect.type === "stadium_chained_evolution");
      if (chainedEvo) {
        if (store.turnNumber <= 2) {
          appendLog(store, "Cannot use Grand Tree on a player's first turn.");
          return;
        }
        const eligibleBasics = [actor.active, ...actor.bench].filter((pokemon): pokemon is PokemonInPlay =>
          pokemon !== null && pokemon.base.card.stage === "Basic" && pokemon.turnPlayedOrEvolved < store.turnNumber,
        );
        if (eligibleBasics.length === 0) {
          appendLog(store, "No eligible Basic Pokemon in play.");
          return;
        }
        const stage1Candidates = actor.deck.filter((card) =>
          card.card.category === "Pokemon" &&
          card.card.stage === "Stage1" &&
          card.card.evolve_from &&
          eligibleBasics.some((pokemon) => pokemon.base.card.name === card.card.evolve_from),
        ).map((card) => card.uid);
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
          instruction: "Select a Stage 1 Pokemon from your deck to evolve a Basic Pokemon.",
          remainingEffects: [{ type: "stadium_chained_evolution" }],
        };
        appendLog(store, "Grand Tree: search your deck for a Stage 1 evolution.");
        return;
      }
      const fossilEffect = effects.find((effect) => effect.type === "stadium_fossil_evolution");
      if (fossilEffect?.type === "stadium_fossil_evolution") {
        const fossilCandidates = actor.deck.filter((card) =>
          card.card.category === "Pokemon" && card.card.evolve_from === "Unidentified Fossil",
        ).map((card) => card.uid);
        if (fossilCandidates.length === 0) {
          appendLog(store, "No Pokemon that evolve from Unidentified Fossil in your deck.");
          return;
        }
        if (actor.bench.length >= 5) {
          appendLog(store, "Your Bench is full.");
          return;
        }
        store.stadiumUsedThisTurn[actorIdx] = true;
        const maxCount = Math.min(fossilEffect.count, 5 - actor.bench.length);
        store.pendingDeckSearch = {
          actorIdx,
          opponentIdx,
          playerIdx: actorIdx,
          count: maxCount,
          minCount: 0,
          destination: "bench",
          candidateUids: fossilCandidates,
          selectedUids: [],
          title: "Pokemon Research Lab",
          instruction: `Select up to ${maxCount} Pokemon that evolve from Unidentified Fossil to put on your Bench.`,
          remainingEffects: [{ type: "end_turn" }],
        };
        appendLog(store, "Pokemon Research Lab: search your deck for Fossil evolutions.");
        return;
      }
      appendLog(store, "This Stadium has no activatable ability.");
      return;
    }
    case "dropToTrainerUse":
      if (action.payload.zone !== "hand") return;
      applyActionInPlace(store, { type: "playTrainerCard", uid: action.payload.uid });
      return;
    case "retreat": {
      if (!canAct(store, store.currentTurn, "retreat")) return;
      const player = store.players[store.currentTurn];
      if (!player.active || player.retreatedThisTurn) return;
      const engineActive = toEnginePokemon(player.active);
      const conditionCheck = canRetreatCondition(engineActive);
      if (!conditionCheck.allowed) return;
      const retreatCost = player.active.base.card.retreat ?? 0;
      if (retreatCost > 0) {
        if (!engineCanRetreat(toEnginePokemon(player.active))) return;
        let remaining = retreatCost;
        while (remaining > 0 && player.active.attached.length > 0) {
          const energyIdx = player.active.attached.findLastIndex((card) => card.card.category === "Energy");
          if (energyIdx === -1) break;
          const [removed] = player.active.attached.splice(energyIdx, 1);
          if (removed) player.discard.push(removed);
          remaining -= 1;
        }
      }
      const benchPokemon = removeBenchPokemon(player, action.benchUid);
      if (!benchPokemon) return;
      const oldActive = player.active;
      oldActive.specialConditions = [];
      oldActive.poisonDamage = 10;
      oldActive.burnDamage = 20;
      player.active = benchPokemon;
      player.bench.push(oldActive);
      player.retreatedThisTurn = true;
      appendLog(store, `${oldActive.base.card.name} retreated. ${benchPokemon.base.card.name} is now Active.`);
      return;
    }
    case "dropToActive": {
      const sourcePlayer = store.players[action.payload.playerIdx];
      const targetPlayer = store.players[action.targetPlayerIdx];
      if (action.payload.zone === "bench" && action.payload.playerIdx === action.targetPlayerIdx) {
        if (!targetPlayer.active) {
          const benchPokemon = removeBenchPokemon(sourcePlayer, action.payload.uid);
          if (!benchPokemon) return;
          targetPlayer.active = benchPokemon;
        } else if (store.phase === "setup") {
          const benchPokemon = removeBenchPokemon(sourcePlayer, action.payload.uid);
          if (!benchPokemon) return;
          const oldActive = targetPlayer.active;
          targetPlayer.active = benchPokemon;
          targetPlayer.bench.push(oldActive);
        } else {
          if (targetPlayer.retreatedThisTurn) return;
          const engineActive = toEnginePokemon(targetPlayer.active);
          if (!canRetreatCondition(engineActive).allowed || !engineCanRetreat(engineActive)) return;
          const benchPokemon = removeBenchPokemon(sourcePlayer, action.payload.uid);
          if (!benchPokemon) return;
          const oldActive = targetPlayer.active;
          oldActive.specialConditions = [];
          oldActive.poisonDamage = 10;
          oldActive.burnDamage = 20;
          let remaining = oldActive.base.card.retreat ?? 0;
          while (remaining > 0 && oldActive.attached.length > 0) {
            const energyIdx = oldActive.attached.findLastIndex((card) => card.card.category === "Energy");
            if (energyIdx === -1) break;
            const [removed] = oldActive.attached.splice(energyIdx, 1);
            if (removed) targetPlayer.discard.push(removed);
            remaining -= 1;
          }
          targetPlayer.active = benchPokemon;
          targetPlayer.bench.push(oldActive);
          targetPlayer.retreatedThisTurn = true;
          appendLog(store, `${oldActive.base.card.name} retreated. ${benchPokemon.base.card.name} is now Active.`);
        }
        return;
      }
      if (action.payload.zone !== "hand" || action.payload.playerIdx !== action.targetPlayerIdx) return;
      const card = removeHandCard(sourcePlayer, action.payload.uid);
      if (!card) return;
      if (card.card.category === "Energy") {
        if (store.phase === "setup" || !targetPlayer.active || !canAct(store, action.targetPlayerIdx, "attach Energy") || targetPlayer.energyAttachedThisTurn) {
          sourcePlayer.hand.push(card);
          return;
        }
        targetPlayer.active.attached.push(card);
        targetPlayer.energyAttachedThisTurn = true;
        appendLog(store, `P${action.targetPlayerIdx + 1} attached ${card.card.name} to ${targetPlayer.active.base.card.name}.`);
        return;
      }
      if (card.card.category === "Trainer" && card.card.trainer_type === "Tool") {
        if (!targetPlayer.active || !canAct(store, action.targetPlayerIdx, "attach Tool")) {
          sourcePlayer.hand.push(card);
          return;
        }
        if (targetPlayer.active.attached.some((attached) => attached.card.trainer_type === "Tool")) {
          appendLog(store, `${targetPlayer.active.base.card.name} already has a Tool attached.`);
          sourcePlayer.hand.push(card);
          return;
        }
        targetPlayer.active.attached.push(card);
        appendLog(store, `P${action.targetPlayerIdx + 1} attached ${card.card.name} to ${targetPlayer.active.base.card.name}.`);
        return;
      }
      if (card.card.category === "Trainer" && card.card.trainer_type === "Technical Machine") {
        if (!targetPlayer.active || !canAct(store, action.targetPlayerIdx, "attach Technical Machine")) {
          sourcePlayer.hand.push(card);
          return;
        }
        targetPlayer.active.attached.push(card);
        appendLog(store, `P${action.targetPlayerIdx + 1} attached ${card.card.name} to ${targetPlayer.active.base.card.name}. It gains a new attack.`);
        return;
      }
      if (isEvolutionPokemon(card.card) && targetPlayer.active) {
        if (!canAct(store, action.targetPlayerIdx, "evolve")) {
          sourcePlayer.hand.push(card);
          return;
        }
        const isRareCandy = Boolean(store.pendingRareCandy && store.pendingRareCandy.actorIdx === action.targetPlayerIdx);
        const evoCheck = canEvolvePokemon(card.card, targetPlayer.active, store, { rareCandy: isRareCandy });
        if (!evoCheck.ok) {
          if (!isRareCandy) {
            const rcCheck = store.pendingRareCandy && store.pendingRareCandy.actorIdx === action.targetPlayerIdx
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
        evolvePokemon(store, targetPlayer.active, card, action.targetPlayerIdx);
        if (isRareCandy) {
          const remaining = store.pendingRareCandy?.remainingEffects ?? [];
          store.pendingRareCandy = null;
          applyGenericEffects(store, action.targetPlayerIdx, (action.targetPlayerIdx === 0 ? 1 : 0) as PlayerIndex, remaining);
        }
        return;
      }
      if (!isBasicPokemon(card.card)) {
        sourcePlayer.hand.push(card);
        return;
      }
      if (!targetPlayer.active) {
        targetPlayer.active = makePokemonInPlay(card, store.turnNumber);
        if (store.phase !== "setup") appendLog(store, `P${action.targetPlayerIdx + 1} set ${card.card.name} to Active.`);
      } else {
        sourcePlayer.hand.push(card);
      }
      return;
    }
    case "dropToBench": {
      if (action.payload.zone !== "hand" || action.payload.playerIdx !== action.targetPlayerIdx) return;
      const targetPlayer = store.players[action.targetPlayerIdx];
      if (targetPlayer.bench.length >= 5) return;
      if (store.phase === "playing" && !canAct(store, action.targetPlayerIdx, "bench a Pokemon")) return;
      const card = removeHandCard(targetPlayer, action.payload.uid);
      if (!card) return;
      if (!isBasicPokemon(card.card)) {
        targetPlayer.hand.push(card);
        return;
      }
      targetPlayer.bench.push(makePokemonInPlay(card, store.turnNumber));
      if (store.phase !== "setup") appendLog(store, `P${action.targetPlayerIdx + 1} benched ${card.card.name}.`);
      return;
    }
    case "dropToBenchSlot": {
      if (action.payload.playerIdx !== action.targetPlayerIdx) return;
      const targetPlayer = store.players[action.targetPlayerIdx];
      const benchSlot = targetPlayer.bench[action.benchIdx];
      if (!benchSlot) return;
      if (action.payload.zone === "hand") {
        const card = removeHandCard(targetPlayer, action.payload.uid);
        if (!card) return;
        if (card.card.category === "Energy") {
          if (store.phase === "setup" || !canAct(store, action.targetPlayerIdx, "attach Energy") || targetPlayer.energyAttachedThisTurn) {
            targetPlayer.hand.push(card);
            return;
          }
          benchSlot.attached.push(card);
          targetPlayer.energyAttachedThisTurn = true;
          appendLog(store, `P${action.targetPlayerIdx + 1} attached ${card.card.name} to ${benchSlot.base.card.name}.`);
          return;
        }
        if (card.card.category === "Trainer" && card.card.trainer_type === "Tool") {
          if (!canAct(store, action.targetPlayerIdx, "attach Tool")) {
            targetPlayer.hand.push(card);
            return;
          }
          if (benchSlot.attached.some((attached) => attached.card.trainer_type === "Tool")) {
            appendLog(store, `${benchSlot.base.card.name} already has a Tool attached.`);
            targetPlayer.hand.push(card);
            return;
          }
          benchSlot.attached.push(card);
          appendLog(store, `P${action.targetPlayerIdx + 1} attached ${card.card.name} to ${benchSlot.base.card.name}.`);
          return;
        }
        if (card.card.category === "Trainer" && card.card.trainer_type === "Technical Machine") {
          if (!canAct(store, action.targetPlayerIdx, "attach Technical Machine")) {
            targetPlayer.hand.push(card);
            return;
          }
          benchSlot.attached.push(card);
          appendLog(store, `P${action.targetPlayerIdx + 1} attached ${card.card.name} to ${benchSlot.base.card.name}. It gains a new attack.`);
          return;
        }
        if (isEvolutionPokemon(card.card)) {
          if (!canAct(store, action.targetPlayerIdx, "evolve")) {
            targetPlayer.hand.push(card);
            return;
          }
          const isRareCandy = Boolean(store.pendingRareCandy && store.pendingRareCandy.actorIdx === action.targetPlayerIdx);
          const evoCheck = canEvolvePokemon(card.card, benchSlot, store, { rareCandy: isRareCandy });
          if (!evoCheck.ok && !isRareCandy) {
            const rcCheck = store.pendingRareCandy && store.pendingRareCandy.actorIdx === action.targetPlayerIdx
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
          evolvePokemon(store, benchSlot, card, action.targetPlayerIdx);
          if (isRareCandy && store.pendingRareCandy) {
            const remaining = store.pendingRareCandy.remainingEffects;
            store.pendingRareCandy = null;
            applyGenericEffects(store, action.targetPlayerIdx, (action.targetPlayerIdx === 0 ? 1 : 0) as PlayerIndex, remaining);
          }
          return;
        }
        targetPlayer.hand.push(card);
        return;
      }
      if (action.payload.zone === "bench" && action.payload.uid !== benchSlot.uid) {
        const draggedIdx = targetPlayer.bench.findIndex((bench) => bench.uid === action.payload.uid);
        if (draggedIdx === -1) return;
        const temp = targetPlayer.bench[draggedIdx];
        targetPlayer.bench[draggedIdx] = benchSlot;
        targetPlayer.bench[action.benchIdx] = temp;
        appendLog(store, `P${action.targetPlayerIdx + 1} rearranged bench.`);
      }
      return;
    }
    case "dropToDiscard": {
      if (action.payload.playerIdx !== action.targetPlayerIdx || action.payload.zone !== "hand") return;
      const player = store.players[action.targetPlayerIdx];
      const card = removeHandCard(player, action.payload.uid);
      if (!card) return;
      player.discard.push(card);
      appendLog(store, `P${action.targetPlayerIdx + 1} discarded ${card.card.name}.`);
      return;
    }
    case "dropToStadium": {
      if (action.payload.zone !== "hand") return;
      const player = store.players[action.payload.playerIdx];
      const card = removeHandCard(player, action.payload.uid);
      if (!card) return;
      if (card.card.category !== "Trainer" || card.card.trainer_type !== "Stadium") {
        player.hand.push(card);
        return;
      }
      if (!canAct(store, action.payload.playerIdx, "play Stadium")) {
        player.hand.push(card);
        return;
      }
      const canPlay = canPlayTrainer(toEngineCardInstance(card), toEngineBoard(player), buildEngineState(store), action.payload.playerIdx);
      if (!canPlay.allowed) {
        if (canPlay.reason) appendLog(store, canPlay.reason);
        player.hand.push(card);
        return;
      }
      const oldStadium = store.stadium;
      store.stadium = { card, playedByPlayer: action.payload.playerIdx };
      appendLog(store, `P${action.payload.playerIdx + 1} plays ${card.card.name} (Stadium).`);
      if (oldStadium) {
        store.players[oldStadium.playedByPlayer].discard.push(oldStadium.card);
        appendLog(store, `${oldStadium.card.card.name} is discarded.`);
      }
      return;
    }
    case "dropToHand": {
      if (action.payload.playerIdx !== action.targetPlayerIdx || action.payload.zone !== "prize") return;
      const player = store.players[action.targetPlayerIdx];
      const card = removePrizeCard(player, action.payload.uid);
      if (!card) return;
      player.hand.push(card);
      store.revealedPrizeUids[action.targetPlayerIdx] = store.revealedPrizeUids[action.targetPlayerIdx].filter((uid) => uid !== action.payload.uid);
      appendLog(store, `P${action.targetPlayerIdx + 1} moved a revealed Prize to hand.`);
      return;
    }
  }
}

export function applySimulatorAction(store: SimulatorStore, action: SimulatorAction): SimulatorStore {
  const next = cloneStore(store);
  applyActionInPlace(next, action);
  return next;
}
