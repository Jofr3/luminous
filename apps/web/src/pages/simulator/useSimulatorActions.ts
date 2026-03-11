import type { DragPayload, SimulatorActions, SimulatorStore } from "./types";
import {
  appendLog,
  autoMulliganUntilBasic,
  buildDeckFromInput,
  canAct,
  createEmptyPlayer,
  drawFromDeck,
  isBasicPokemon,
  makePokemonInPlay,
  removeBenchPokemon,
  removeHandCard,
  removePrizeCard,
} from "./logic";
import {
  toEnginePokemon,
  toEngineBoard,
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
  totalEnergyCount,
  applySpecialCondition,
} from "@luminous/engine";
import type { CardAttack } from "@luminous/engine";

type WithStore = <Args extends unknown[], R>(
  fn: (draft: SimulatorStore, ...args: Args) => R | Promise<R>,
) => (...args: Args) => Promise<R>;

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
  appendLog(store, `P${next + 1} drew a card.`);
}

function applyResolvedEffects(store: SimulatorStore, attackerIdx: 0 | 1, defenderIdx: 0 | 1, effects: ReturnType<typeof resolveAttack>["effects"]): void {
  const attacker = store.players[attackerIdx];
  const defender = store.players[defenderIdx];

  for (const effect of effects) {
    switch (effect.type) {
      case "special_condition": {
        const targetPlayer = effect.target === "self" ? attacker : defender;
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
            ? attacker
            : defender;
        const drawn = drawFromDeck(targetPlayer, effect.count);
        targetPlayer.hand.push(...drawn);
        appendLog(store, `P${effect.player === "self" ? attackerIdx + 1 : defenderIdx + 1} drew ${drawn.length} card(s).`);
        break;
      }
      case "heal": {
        const target =
          effect.target === "self"
            ? attacker.active
            : null;
        if (!target) break;
        target.damage = Math.max(0, target.damage - effect.amount);
        appendLog(store, `${target.base.card.name} healed ${effect.amount} damage.`);
        break;
      }
      case "discard_energy": {
        const target =
          effect.target === "self"
            ? attacker.active
            : defender.active;
        if (!target) break;

        let remaining = effect.count;
        while (remaining > 0) {
          const energyIdx = target.attached.findLastIndex((card) => card.card.category === "Energy");
          if (energyIdx === -1) break;
          const [removed] = target.attached.splice(energyIdx, 1);
          if (!removed) break;
          const owner = effect.target === "self" ? attacker : defender;
          owner.discard.push(removed);
          remaining -= 1;
        }
        break;
      }
      default:
        break;
    }
  }
}

export function useSimulatorActions(withStore: WithStore): {
  actions: SimulatorActions;
  autoSetup: () => Promise<void>;
} {
  const autoSetup = withStore(async (store) => {
    store.loading = true;
    try {
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

      store.players = [p1, p2];
      store.winner = null;
      store.coinFlipResult = null;
      store.revealedPrizeUids = [[], []];
      store.selectedPrizeUid = [null, null];
      store.selectedHandUid = [null, null];
      store.stadium = null;
      store.currentTurn = 0;
      store.phase = "setup";
      store.gameStarted = true;

      appendLog(store, `Mulligans -> P1: ${p1.mulligans}, P2: ${p2.mulligans}.`);
      appendLog(store, "P1: place your Active Pokemon (required) and Bench, then click Ready.");
    } finally {
      store.loading = false;
    }
  });

  const newGame = async () => {
    await autoSetup();
  };

  const selectHandCard = withStore((store, playerIdx: 0 | 1, uid: string) => {
    store.selectedHandUid[playerIdx] = uid;
  });

  // ---------------------------------------------------------------------------
  // End Turn (with Pokemon Checkup)
  // ---------------------------------------------------------------------------

  const endTurn = withStore((store) => {
    if (store.phase === "setup") {
      const player = store.players[store.currentTurn];
      if (!player.active) {
        appendLog(store, `P${store.currentTurn + 1} must place an Active Pokemon before continuing.`);
        return;
      }

      if (store.currentTurn === 0) {
        store.currentTurn = 1;
        appendLog(store, "P1 is ready.");
        appendLog(store, "P2: place your Active Pokemon (required) and Bench, then click End Turn.");
        return;
      }

      for (const playerBoard of store.players) {
        playerBoard.prizes = drawFromDeck(playerBoard, 6);
        playerBoard.energyAttachedThisTurn = false;
        playerBoard.supporterPlayedThisTurn = false;
        playerBoard.retreatedThisTurn = false;
      }

      store.coinFlipResult = Math.random() < 0.5 ? "Heads" : "Tails";
      store.firstPlayer = store.coinFlipResult === "Heads" ? 0 : 1;
      store.currentTurn = store.firstPlayer;
      store.turnNumber = 1;
      store.turnDrawDone = false;
      store.phase = "playing";

      appendLog(store, `Coin flip: ${store.coinFlipResult}. P${store.firstPlayer + 1} goes first.`);
      appendLog(store, "First player cannot attack on turn 1.");

      const firstPlayer = store.players[store.firstPlayer];
      const drawn = drawFromDeck(firstPlayer, 1);
      if (drawn.length > 0) {
        firstPlayer.hand.push(...drawn);
        store.turnDrawDone = true;
        appendLog(store, `P${store.firstPlayer + 1} drew a card.`);
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
      appendLog(store, "First player cannot attack on turn 1.");
      return;
    }

    const attacker = store.players[store.currentTurn];
    const defenderIdx = (store.currentTurn === 0 ? 1 : 0) as 0 | 1;
    const defender = store.players[defenderIdx];

    if (!attacker.active || !defender.active) {
      appendLog(store, "Both players need an Active Pokemon to attack.");
      return;
    }

    const attacks = attacker.active.base.card.attacks ?? [];
    if (attackIdx < 0 || attackIdx >= attacks.length) {
      appendLog(store, "Invalid attack index.");
      return;
    }

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
    if (!validation.valid) {
      appendLog(store, validation.reason ?? "Cannot use this attack.");
      return;
    }

    // Resolve
    const result = resolveAttack({
      attacker: engineAttacker,
      defender: engineDefender,
      attack: engineAttack,
      attackerBoard: toEngineBoard(attacker),
      defenderBoard: toEngineBoard(defender),
      state: {
        players: [toEngineBoard(store.players[0]), toEngineBoard(store.players[1])],
        stadium: null,
        currentTurn: store.currentTurn,
        firstPlayer: store.firstPlayer,
        turnNumber: store.turnNumber,
        phase: "playing",
        winner: null,
        turnDrawDone: store.turnDrawDone,
        logs: [],
      },
    });

    for (const log of result.logs) appendLog(store, log);
    applyResolvedEffects(store, store.currentTurn, defenderIdx, result.effects);

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
    let pokemon = player.active?.uid === pokemonUid ? player.active : null;
    if (!pokemon) {
      pokemon = player.bench.find((p) => p.uid === pokemonUid) ?? null;
    }
    if (!pokemon) {
      appendLog(store, "Pokemon not found.");
      return;
    }

    const abilities = pokemon.base.card.abilities ?? [];
    if (abilityIdx < 0 || abilityIdx >= abilities.length) {
      appendLog(store, "Invalid ability index.");
      return;
    }

    if (pokemon.usedAbilityThisTurn) {
      appendLog(store, `${pokemon.base.card.name} already used an Ability this turn.`);
      return;
    }

    const ability = abilities[abilityIdx];
    pokemon.usedAbilityThisTurn = true;
    appendLog(store, `${pokemon.base.card.name} uses ${ability.type}: ${ability.name}.`);
    if (ability.effect) {
      appendLog(store, `  Effect: ${ability.effect}`);
    }
  });

  // ---------------------------------------------------------------------------
  // Play Trainer Card
  // ---------------------------------------------------------------------------

  const playTrainerCard = withStore((store, uid: string) => {
    if (!canAct(store, store.currentTurn, "play Trainer")) return;

    const player = store.players[store.currentTurn];
    const cardInHand = player.hand.find((c) => c.uid === uid);
    if (!cardInHand) {
      appendLog(store, "Card not in hand.");
      return;
    }

    const card = cardInHand.card;
    if (card.category !== "Trainer") {
      appendLog(store, `${card.name} is not a Trainer card.`);
      return;
    }

    // Supporter: one per turn
    if (card.trainer_type === "Supporter") {
      if (player.supporterPlayedThisTurn) {
        appendLog(store, "Already played a Supporter this turn.");
        return;
      }
      // First turn restriction
      if (store.turnNumber === 1 && store.currentTurn === store.firstPlayer) {
        appendLog(store, "Cannot play a Supporter on the first player's first turn.");
        return;
      }
    }

    // Remove from hand
    const card_ = removeHandCard(player, uid);
    if (!card_) return;

    appendLog(store, `P${store.currentTurn + 1} plays ${card.name} (${card.trainer_type ?? "Trainer"}).`);

    // Handle stadiums
    if (card.trainer_type === "Stadium") {
      if (store.stadium) {
        const oldOwner = store.players[store.stadium.playedByPlayer];
        oldOwner.discard.push(store.stadium.card);
        appendLog(store, `${store.stadium.card.card.name} is discarded.`);
      }
      store.stadium = { card: card_, playedByPlayer: store.currentTurn };
      appendLog(store, `${card.name} is now in play.`);
      return;
    }

    // Track supporter usage
    if (card.trainer_type === "Supporter") {
      player.supporterPlayedThisTurn = true;
    }

    // Show effect text for manual resolution
    if (card.effect) {
      appendLog(store, `  Effect: ${card.effect}`);
    }

    // Items and Supporters go to discard
    player.discard.push(card_);
  });

  // ---------------------------------------------------------------------------
  // Retreat
  // ---------------------------------------------------------------------------

  const retreat = withStore((store, benchUid: string) => {
    if (!canAct(store, store.currentTurn, "retreat")) return;

    const player = store.players[store.currentTurn];
    if (!player.active) {
      appendLog(store, "No Active Pokemon to retreat.");
      return;
    }

    if (player.retreatedThisTurn) {
      appendLog(store, "Already retreated this turn.");
      return;
    }

    // Check conditions
    const engineActive = toEnginePokemon(player.active);
    const condCheck = canRetreatCondition(engineActive);
    if (!condCheck.allowed) {
      appendLog(store, condCheck.reason ?? "Cannot retreat due to special conditions.");
      return;
    }

    // Check energy cost
    const retreatCost = player.active.base.card.retreat ?? 0;
    if (retreatCost > 0) {
      const engineInst = toEnginePokemon(player.active);
      if (!engineCanRetreat(engineInst)) {
        appendLog(store, `${player.active.base.card.name} needs ${retreatCost} energy to retreat but has ${totalEnergyCount(engineInst)}.`);
        return;
      }

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
      appendLog(store, "Bench Pokemon not found.");
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
      const benchSlot = removeBenchPokemon(sourcePlayer, payload.uid);
      if (!benchSlot) return;

      if (!targetPlayer.active) {
        targetPlayer.active = benchSlot;
      } else {
        const oldActive = targetPlayer.active;
        targetPlayer.active = benchSlot;
        targetPlayer.bench.push(oldActive);
      }
      appendLog(store, `P${targetPlayerIdx + 1} switched Active via drag-and-drop.`);
      return;
    }

    if (payload.zone !== "hand" || payload.playerIdx !== targetPlayerIdx) return;

    const card = removeHandCard(sourcePlayer, payload.uid);
    if (!card) return;

    if (card.card.category === "Energy") {
      if (store.phase === "setup") {
        sourcePlayer.hand.push(card);
        appendLog(store, "Cannot attach Energy during setup.");
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
        appendLog(store, `P${targetPlayerIdx + 1} already attached Energy this turn.`);
        return;
      }
      targetPlayer.active.attached.push(card);
      targetPlayer.energyAttachedThisTurn = true;
      appendLog(store, `P${targetPlayerIdx + 1} attached ${card.card.name} to Active via drag-and-drop.`);
      return;
    }

    if (!isBasicPokemon(card.card)) {
      sourcePlayer.hand.push(card);
      return;
    }

    if (!targetPlayer.active) {
      targetPlayer.active = makePokemonInPlay(card, store.turnNumber);
      appendLog(store, `P${targetPlayerIdx + 1} set Active via drag-and-drop.`);
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
    appendLog(store, `P${targetPlayerIdx + 1} benched ${card.card.name} via drag-and-drop.`);
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
          appendLog(store, "Cannot attach Energy during setup.");
          return;
        }
        if (!canAct(store, targetPlayerIdx, "attach Energy")) {
          targetPlayer.hand.push(card);
          return;
        }
        if (targetPlayer.energyAttachedThisTurn) {
          targetPlayer.hand.push(card);
          appendLog(store, `P${targetPlayerIdx + 1} already attached Energy this turn.`);
          return;
        }
        benchSlot.attached.push(card);
        targetPlayer.energyAttachedThisTurn = true;
        store.selectedHandUid[targetPlayerIdx] = null;
        appendLog(store, `P${targetPlayerIdx + 1} attached ${card.card.name} to Benched ${benchSlot.base.card.name}.`);
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
    appendLog(store, `P${targetPlayerIdx + 1} discarded ${card.card.name} via drag-and-drop.`);
  });

  const dropToHand = withStore((store, payload: DragPayload, targetPlayerIdx: 0 | 1) => {
    if (payload.playerIdx !== targetPlayerIdx || payload.zone !== "prize") return;

    const player = store.players[targetPlayerIdx];
    const card = removePrizeCard(player, payload.uid);
    if (!card) return;
    player.hand.push(card);

    store.revealedPrizeUids[targetPlayerIdx] = store.revealedPrizeUids[targetPlayerIdx].filter((uid) => uid !== payload.uid);
    appendLog(store, `P${targetPlayerIdx + 1} moved a revealed Prize to hand via drag-and-drop.`);
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
      selectHandCard,
      useAttack,
      useAbility,
      playTrainerCard,
      retreat,
      endTurn,
      newGame,
    },
  };
}
