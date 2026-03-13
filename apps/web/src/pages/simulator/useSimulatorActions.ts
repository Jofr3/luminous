import type { SimulatorAction } from "@luminous/simulator-core";
import { applySimulatorAction as applySimulatorActionRemote, createSimulatorGame, fetchDecks } from "../../lib/api";
import type { DragPayload, SimulatorActions, SimulatorStore } from "./types";

type WithStore = <Args extends unknown[], R>(
  fn: (draft: SimulatorStore, ...args: Args) => R | Promise<R>,
  options?: { history?: "push" | "skip" | "replace" },
) => (...args: Args) => Promise<R>;

type CommitStore = (next: SimulatorStore, options?: { history?: "push" | "skip" | "replace" }) => void;

export function useSimulatorActions(
  withStore: WithStore,
  getStore: () => SimulatorStore,
  commitStore: CommitStore,
): {
  actions: SimulatorActions;
  autoSetup: (deckOverrides?: { deck1: string; deck2: string }) => Promise<void>;
} {
  const setLoading = withStore((store, value: boolean, deckOverrides?: { deck1: string; deck2: string }) => {
    store.loading = value;
    if (deckOverrides) {
      store.deckInput1 = deckOverrides.deck1;
      store.deckInput2 = deckOverrides.deck2;
    }
  }, { history: "skip" });

  const autoSetup = async (deckOverrides?: { deck1: string; deck2: string }) => {
    const current = getStore();
    const deck1 = deckOverrides?.deck1 ?? current.deckInput1;
    const deck2 = deckOverrides?.deck2 ?? current.deckInput2;
    await setLoading(true, { deck1, deck2 });
    try {
      const next = await createSimulatorGame(deck1, deck2) as SimulatorStore;
      commitStore(next);
    } catch (error) {
      await setLoading(false, { deck1, deck2 });
      throw error;
    }
  };

  const dispatch = async (
    action: SimulatorAction,
    options?: { history?: "push" | "skip" | "replace" },
  ) => {
    const next = await applySimulatorActionRemote(getStore(), action) as SimulatorStore;
    commitStore(next, options);
  };

  const startNewGame = async () => {
    const decks = await fetchDecks();
    await autoSetup({
      deck1: decks[0]?.decklist ?? "",
      deck2: decks[1]?.decklist ?? "",
    });
  };

  const selectHandCard = withStore((store, playerIdx: 0 | 1, uid: string) => {
    store.selectedHandUid[playerIdx] = store.selectedHandUid[playerIdx] === uid ? null : uid;
  });

  const deselectHandCard = withStore((store, playerIdx: 0 | 1) => {
    store.selectedHandUid[playerIdx] = null;
  });

  return {
    autoSetup,
    actions: {
      selectPrize: (playerIdx, uid) => dispatch({ type: "selectPrize", playerIdx, uid }, { history: "skip" }),
      dropToActive: (payload, targetPlayerIdx) => dispatch({ type: "dropToActive", payload, targetPlayerIdx }),
      dropToBench: (payload, targetPlayerIdx) => dispatch({ type: "dropToBench", payload, targetPlayerIdx }),
      dropToBenchSlot: (payload, targetPlayerIdx, benchIdx) => dispatch({ type: "dropToBenchSlot", payload, targetPlayerIdx, benchIdx }),
      dropToDiscard: (payload, targetPlayerIdx) => dispatch({ type: "dropToDiscard", payload, targetPlayerIdx }),
      dropToHand: (payload, targetPlayerIdx) => dispatch({ type: "dropToHand", payload, targetPlayerIdx }),
      dropToStadium: (payload) => dispatch({ type: "dropToStadium", payload }),
      selectHandCard,
      deselectHandCard,
      useAttack: (attackIdx) => dispatch({ type: "useAttack", attackIdx }),
      useAbility: (pokemonUid, abilityIdx) => dispatch({ type: "useAbility", pokemonUid, abilityIdx }),
      playTrainerCard: (uid) => dispatch({ type: "playTrainerCard", uid }),
      toggleHandSelectionCard: (uid) => dispatch({ type: "toggleHandSelectionCard", uid }, { history: "skip" }),
      confirmHandSelection: () => dispatch({ type: "confirmHandSelection" }, { history: "replace" }),
      toggleDeckSearchCard: (uid) => dispatch({ type: "toggleDeckSearchCard", uid }, { history: "skip" }),
      confirmDeckSearch: () => dispatch({ type: "confirmDeckSearch" }, { history: "replace" }),
      cancelDeckSearch: () => dispatch({ type: "cancelDeckSearch" }, { history: "replace" }),
      confirmOpponentSwitch: (benchUid) => dispatch({ type: "confirmOpponentSwitch", benchUid }, { history: "replace" }),
      cancelOpponentSwitch: () => dispatch({ type: "cancelOpponentSwitch" }, { history: "replace" }),
      confirmSelfSwitch: (benchUid) => dispatch({ type: "confirmSelfSwitch", benchUid }, { history: "replace" }),
      cancelSelfSwitch: () => dispatch({ type: "cancelSelfSwitch" }, { history: "replace" }),
      cancelRareCandy: () => dispatch({ type: "cancelRareCandy" }, { history: "replace" }),
      toggleEvolveFromDeckCard: (uid) => dispatch({ type: "toggleEvolveFromDeckCard", uid }, { history: "skip" }),
      confirmEvolveFromDeck: () => dispatch({ type: "confirmEvolveFromDeck" }, { history: "replace" }),
      cancelEvolveFromDeck: () => dispatch({ type: "cancelEvolveFromDeck" }, { history: "replace" }),
      useStadiumAbility: () => dispatch({ type: "useStadiumAbility" }),
      dropToTrainerUse: (payload: DragPayload) => dispatch({ type: "dropToTrainerUse", payload }),
      retreat: (benchUid) => dispatch({ type: "retreat", benchUid }),
      endTurn: () => dispatch({ type: "endTurn" }),
      newGame: startNewGame,
    },
  };
}
