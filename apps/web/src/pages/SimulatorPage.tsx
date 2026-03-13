import { useEffect } from "react";
import { SimulatorBoard } from "./simulator/SimulatorBoard";
import { useSimulatorState } from "./simulator/useSimulatorState";
import type { SimulatorStore } from "./simulator/types";
import { createEmptyPlayer } from "./simulator/logic";
import { useSimulatorActions } from "./simulator/useSimulatorActions";
import { useSimulatorRules } from "./simulator/useSimulatorRules";
import { fetchDecks } from "../lib/api";

function createInitialStore(): SimulatorStore {
  return {
    phase: "idle",
    winner: null,
    coinFlipResult: null,
    deckInput1: "",
    deckInput2: "",
    loading: false,
    firstPlayer: 0,
    currentTurn: 0,
    turnNumber: 1,
    turnDrawDone: false,
    selectedHandUid: [null, null],
    selectedPrizeUid: [null, null],
    revealedPrizeUids: [[], []],
    nameQueryCache: {},
    logs: [],
    players: [createEmptyPlayer(), createEmptyPlayer()],
    stadium: null,
    pendingHandSelection: null,
    pendingDeckSearch: null,
    pendingDiscardSelection: null,
    pendingOpponentSwitch: null,
    pendingSelfSwitch: null,
    pendingRareCandy: null,
    pendingEvolveFromDeck: null,
    stadiumUsedThisTurn: [false, false],
    gameStarted: false,
  };
}

export function SimulatorPage() {
  const { store, withStore, getStore, commitStore, undo, redo, canUndo, canRedo } = useSimulatorState(createInitialStore);
  const { actions, autoSetup } = useSimulatorActions(withStore, getStore, commitStore);
  const rules = useSimulatorRules(store);

  useEffect(() => {
    if (store.gameStarted) return;

    let cancelled = false;

    void fetchDecks()
      .then((decks) => {
        if (cancelled) return;

        return autoSetup({
          deck1: decks[0]?.decklist ?? "",
          deck2: decks[1]?.decklist ?? "",
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error(error);
      });

    return () => {
      cancelled = true;
    };
  }, [store.gameStarted]);

  return (
    <SimulatorBoard
      store={store}
      rules={rules}
      actions={actions}
      undo={undo}
      redo={redo}
      canUndo={canUndo}
      canRedo={canRedo}
    />
  );
}
