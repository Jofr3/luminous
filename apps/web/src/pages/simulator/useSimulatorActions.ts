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

type WithStore = <Args extends unknown[], R>(
  fn: (draft: SimulatorStore, ...args: Args) => R | Promise<R>,
) => (...args: Args) => Promise<R>;

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
      store.currentTurn = 0;
      store.phase = "setup";

      appendLog(store, `Mulligans -> P1: ${p1.mulligans}, P2: ${p2.mulligans}.`);
      appendLog(store, "P1: place your Active Pokemon (required) and Bench, then click Ready.");
    } finally {
      store.loading = false;
    }
  });

  const selectHandCard = withStore((store, playerIdx: 0 | 1, uid: string) => {
    store.selectedHandUid[playerIdx] = uid;
  });

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

    const next = (store.currentTurn === 0 ? 1 : 0) as 0 | 1;
    store.currentTurn = next;
    store.turnNumber += 1;
    store.turnDrawDone = false;
    store.players[next].energyAttachedThisTurn = false;
    appendLog(store, `P${next + 1} turn.`);

    const player = store.players[next];
    const drawn = drawFromDeck(player, 1);
    if (drawn.length === 0) {
      store.winner = (next === 0 ? 1 : 0);
      appendLog(store, `P${next + 1} cannot draw at turn start and loses.`);
      return;
    }
    player.hand.push(...drawn);
    store.turnDrawDone = true;
    appendLog(store, `P${next + 1} drew a card.`);
  });

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
      if (!targetPlayer.active) {
        sourcePlayer.hand.push(card);
        return;
      }
      if (store.phase === "playing" && !canAct(store, targetPlayerIdx, "attach Energy")) {
        sourcePlayer.hand.push(card);
        return;
      }
      if (store.phase === "playing" && targetPlayer.energyAttachedThisTurn) {
        sourcePlayer.hand.push(card);
        appendLog(store, `P${targetPlayerIdx + 1} already attached Energy this turn.`);
        return;
      }
      targetPlayer.active.attached.push(card);
      if (store.phase === "playing") targetPlayer.energyAttachedThisTurn = true;
      appendLog(store, `P${targetPlayerIdx + 1} attached ${card.card.name} to Active via drag-and-drop.`);
      return;
    }

    if (!isBasicPokemon(card.card)) {
      sourcePlayer.hand.push(card);
      return;
    }

    if (!targetPlayer.active) {
      targetPlayer.active = makePokemonInPlay(card);
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

    targetPlayer.bench.push(makePokemonInPlay(card));
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
        if (store.phase === "playing" && !canAct(store, targetPlayerIdx, "attach Energy")) {
          targetPlayer.hand.push(card);
          return;
        }
        if (store.phase === "playing" && targetPlayer.energyAttachedThisTurn) {
          targetPlayer.hand.push(card);
          appendLog(store, `P${targetPlayerIdx + 1} already attached Energy this turn.`);
          return;
        }
        benchSlot.attached.push(card);
        if (store.phase === "playing") targetPlayer.energyAttachedThisTurn = true;
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
      endTurn,
    },
  };
}
