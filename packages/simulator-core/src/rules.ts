import {
  canPlayTrainer,
  canRetreat as engineCanRetreat,
  canRetreatCondition,
  canUseAbility,
  parseDamage,
  parseEffectText,
  validateAttack,
} from "@luminous/engine";
import { toEngineBoard, toEngineCardInstance, toEnginePokemon } from "./engine-bridge";
import { buildEngineState, canAct, canEvolvePokemon, getMaxBenchSize } from "./helpers";
import type { CardAttack as EngineAttack } from "@luminous/engine";
import type { HandCardRules, PlayerIndex, RuleStatus, SimulatorRules, SimulatorStore } from "./types";

function cloneStore<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function allow(): RuleStatus {
  return { allowed: true, reason: null };
}

function deny(reason: string): RuleStatus {
  return { allowed: false, reason };
}

function hasBlockingPrompt(store: SimulatorStore): boolean {
  return Boolean(
    store.pendingHandSelection ||
      store.pendingDeckSearch ||
      store.pendingDiscardSelection ||
      store.pendingOpponentSwitch ||
      store.pendingSelfSwitch ||
      store.pendingRareCandy ||
      store.pendingEvolveFromDeck,
  );
}

function getEmptyHandRules(store: SimulatorStore, playerIdx: PlayerIndex): HandCardRules {
  return {
    active: deny("Illegal target."),
    bench: deny("Illegal target."),
    stadium: deny("Illegal target."),
    trainerUse: deny("Illegal target."),
    benchPokemon: Object.fromEntries(store.players[playerIdx].bench.map((pokemon) => [pokemon.uid, deny("Illegal target.")])),
  };
}

function getHandCardRules(store: SimulatorStore, playerIdx: PlayerIndex, uid: string): HandCardRules {
  const player = store.players[playerIdx];
  const card = player.hand.find((entry) => entry.uid === uid);
  const rules = getEmptyHandRules(store, playerIdx);
  if (!card) return rules;

  const actionStore = cloneStore(store);
  const actionAllowed = canAct(actionStore, playerIdx, "play this card");
  const gate = actionAllowed ? allow() : deny(actionStore.logs[0] ?? "Illegal action.");

  if (card.card.category === "Pokemon") {
    if (card.card.stage === "Basic") {
      rules.active = !player.active ? allow() : deny("Active spot is already occupied.");
      rules.bench = player.bench.length < getMaxBenchSize(store, playerIdx) ? allow() : deny("Bench is full.");
      return rules;
    }

    if (player.active) {
      const activeResult = actionAllowed
        ? canEvolvePokemon(card.card, player.active, store, { rareCandy: Boolean(store.pendingRareCandy) })
        : { ok: false, reason: gate.reason ?? "Illegal action." };
      rules.active = activeResult.ok ? allow() : deny(activeResult.reason ?? "Illegal evolution target.");
    } else {
      rules.active = deny("No Active Pokemon to evolve.");
    }

    for (const benchPokemon of player.bench) {
      const result = actionAllowed
        ? canEvolvePokemon(card.card, benchPokemon, store, { rareCandy: Boolean(store.pendingRareCandy) })
        : { ok: false, reason: gate.reason ?? "Illegal action." };
      rules.benchPokemon[benchPokemon.uid] = result.ok ? allow() : deny(result.reason ?? "Illegal evolution target.");
    }

    rules.bench = deny("Evolution Pokemon must be dropped onto a target Pokemon.");
    return rules;
  }

  if (card.card.category === "Energy") {
    if (!actionAllowed) {
      rules.active = gate;
      rules.benchPokemon = Object.fromEntries(player.bench.map((pokemon) => [pokemon.uid, gate]));
      return rules;
    }
    if (player.energyAttachedThisTurn) {
      const status = deny("You already attached an Energy this turn.");
      rules.active = status;
      rules.benchPokemon = Object.fromEntries(player.bench.map((pokemon) => [pokemon.uid, status]));
      return rules;
    }
    rules.active = player.active ? allow() : deny("No Active Pokemon to attach Energy to.");
    rules.benchPokemon = Object.fromEntries(player.bench.map((pokemon) => [pokemon.uid, allow()]));
    rules.bench = deny("Energy must be attached to a Pokemon.");
    return rules;
  }

  if (card.card.category !== "Trainer") return rules;

  // Check item_lock effect
  if (card.card.trainer_type === "Item" || card.card.trainer_type === "Technical Machine") {
    const itemLock = player.activeEffects.find((e) => e.type === "item_lock");
    if (itemLock) {
      const lockDeny = deny("Item cards are locked.");
      rules.trainerUse = lockDeny;
      rules.active = lockDeny;
      rules.benchPokemon = Object.fromEntries(player.bench.map((pokemon) => [pokemon.uid, lockDeny]));
      return rules;
    }
  }

  const engineState = buildEngineState(store);
  const enginePlayer = toEngineBoard(player);
  const engineCard = toEngineCardInstance(card);

  if (card.card.trainer_type === "Stadium") {
    if (!actionAllowed) {
      rules.stadium = gate;
      return rules;
    }
    const result = canPlayTrainer(engineCard, enginePlayer, engineState, playerIdx);
    rules.stadium = result.allowed ? allow() : deny(result.reason ?? "Cannot play this Stadium.");
    return rules;
  }

  if (card.card.trainer_type === "Tool") {
    rules.active = !player.active
      ? deny("No Active Pokemon to attach a Tool to.")
      : player.active.attached.some((attached) => attached.card.trainer_type === "Tool")
        ? deny(`${player.active.base.card.name} already has a Tool attached.`)
        : gate;
    rules.benchPokemon = Object.fromEntries(player.bench.map((pokemon) => [
      pokemon.uid,
      pokemon.attached.some((attached) => attached.card.trainer_type === "Tool")
        ? deny(`${pokemon.base.card.name} already has a Tool attached.`)
        : gate,
    ]));
    return rules;
  }

  if (card.card.trainer_type === "Technical Machine") {
    rules.active = player.active ? gate : deny("No Active Pokemon to attach a Technical Machine to.");
    rules.benchPokemon = Object.fromEntries(player.bench.map((pokemon) => [pokemon.uid, gate]));
    return rules;
  }

  if (!actionAllowed) {
    rules.trainerUse = gate;
    return rules;
  }

  const result = canPlayTrainer(engineCard, enginePlayer, engineState, playerIdx);
  rules.trainerUse = result.allowed ? allow() : deny(result.reason ?? "Cannot play this Trainer.");
  return rules;
}

export function evaluateSimulatorRules(store: SimulatorStore): SimulatorRules {
  const currentPlayer = store.currentTurn;
  const player = store.players[currentPlayer];
  const currentActionStore = cloneStore(store);
  const canEndTurn = store.phase === "setup"
    ? (player.active ? allow() : deny("Set an Active Pokemon before ending setup."))
    : (canAct(currentActionStore, currentPlayer, "end the turn")
      ? allow()
      : deny(currentActionStore.logs[0] ?? "Cannot end turn."));

  const attacks = (player.active?.base.card.attacks ?? []).map((attack, index) => {
    const actionStore = cloneStore(store);
    if (!canAct(actionStore, currentPlayer, "attack")) {
      return { index, name: attack.name, allowed: false, reason: actionStore.logs[0] ?? "Cannot attack." };
    }
    if (store.turnNumber === 1 && store.currentTurn === store.firstPlayer) {
      return { index, name: attack.name, allowed: false, reason: "The first player cannot attack on turn 1." };
    }
    const cantAttack = player.activeEffects.find(
      (e) => e.type === "cant_attack" && (!e.targetPokemonUid || e.targetPokemonUid === player.active?.uid),
    );
    if (cantAttack) {
      return { index, name: attack.name, allowed: false, reason: "This Pokemon can't attack this turn." };
    }
    const validation = player.active
      ? validateAttack(toEnginePokemon(player.active), {
        name: attack.name ?? "Unknown",
        cost: (attack.cost ?? []) as EngineAttack["cost"],
        damageBase: parseDamage(attack.damage).base,
        damageMod: parseDamage(attack.damage).mod,
        damageRaw: parseDamage(attack.damage).raw,
        effect: attack.effect ?? null,
      })
      : { valid: false, reason: "No Active Pokemon." };
    return {
      index,
      name: attack.name,
      allowed: validation.valid,
      reason: validation.valid ? null : validation.reason ?? "Cannot use this attack.",
    };
  });

  const abilities = [player.active, ...player.bench]
    .filter((pokemon): pokemon is NonNullable<typeof pokemon> => pokemon !== null)
    .flatMap((pokemon) => (pokemon.base.card.abilities ?? []).map((ability, abilityIdx) => {
      const actionStore = cloneStore(store);
      if (!canAct(actionStore, currentPlayer, "use an ability")) {
        return {
          pokemonUid: pokemon.uid,
          abilityIdx,
          name: ability.name,
          allowed: false,
          reason: actionStore.logs[0] ?? "Cannot use this ability.",
        };
      }
      const result = canUseAbility(toEnginePokemon(pokemon), {
        type: ability.type,
        name: ability.name,
        effect: ability.effect,
      });
      return {
        pokemonUid: pokemon.uid,
        abilityIdx,
        name: ability.name,
        allowed: result.allowed,
        reason: result.allowed ? null : result.reason ?? "Cannot use this ability.",
      };
    }));

  const retreatTargets = Object.fromEntries(player.bench.map((pokemon) => {
    const actionStore = cloneStore(store);
    if (!canAct(actionStore, currentPlayer, "retreat")) {
      return [pokemon.uid, deny(actionStore.logs[0] ?? "Cannot retreat.")];
    }
    if (!player.active) return [pokemon.uid, deny("No Active Pokemon to retreat.")];
    if (player.retreatedThisTurn) return [pokemon.uid, deny("You already retreated this turn.")];
    const cantRetreat = player.activeEffects.find(
      (e) => e.type === "cant_retreat" && (!e.targetPokemonUid || e.targetPokemonUid === player.active?.uid),
    );
    if (cantRetreat) return [pokemon.uid, deny("This Pokemon can't retreat this turn.")];
    const enginePokemon = toEnginePokemon(player.active);
    const conditionCheck = canRetreatCondition(enginePokemon);
    if (!conditionCheck.allowed) return [pokemon.uid, deny(conditionCheck.reason ?? "Retreat is blocked.")];
    if (!engineCanRetreat(enginePokemon)) return [pokemon.uid, deny("Not enough Energy to pay the retreat cost.")];
    return [pokemon.uid, allow()];
  }));

  const hand = Object.fromEntries(player.hand.map((card) => [card.uid, getHandCardRules(store, currentPlayer, card.uid)]));

  const stadiumAbility = (() => {
    const actionStore = cloneStore(store);
    if (!canAct(actionStore, currentPlayer, "use a Stadium ability")) {
      return deny(actionStore.logs[0] ?? "Cannot use a Stadium ability.");
    }
    if (!store.stadium) return deny("No Stadium is in play.");
    if (store.stadiumUsedThisTurn[currentPlayer]) return deny("Stadium ability already used this turn.");
    if (!store.stadium.card.card.effect) return deny("This Stadium has no activatable ability.");
    const effects = parseEffectText(store.stadium.card.card.effect);
    if (effects.some((effect) => effect.type === "stadium_chained_evolution")) {
      if (store.turnNumber <= 2) return deny("Cannot use Grand Tree on a player's first turn.");
      return allow();
    }
    if (effects.some((effect) => effect.type === "stadium_fossil_evolution")) {
      if (player.bench.length >= getMaxBenchSize(store, currentPlayer)) return deny("Bench is full.");
      return allow();
    }
    return deny("This Stadium has no activatable ability.");
  })();

  return {
    currentPlayer,
    locked: hasBlockingPrompt(store),
    endTurn: canEndTurn,
    stadiumAbility,
    attacks,
    abilities,
    retreatTargets,
    hand,
  };
}
