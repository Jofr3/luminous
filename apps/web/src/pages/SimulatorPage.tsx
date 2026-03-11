import { useEffect } from "react";
import { SimulatorBoard } from "./simulator/SimulatorBoard";
import { useSimulatorState } from "./simulator/useSimulatorState";
import type { SimulatorStore } from "./simulator/types";
import { createEmptyPlayer } from "./simulator/logic";
import { useSimulatorActions } from "./simulator/useSimulatorActions";
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
    gameStarted: false,
  };
}

export function SimulatorPage() {
  const { store, withStore, undo, redo, canUndo, canRedo } = useSimulatorState(createInitialStore);
  const { actions, autoSetup } = useSimulatorActions(withStore);

  useEffect(() => {
    if (store.gameStarted) return;

    fetchDecks().then((decks) => {
      void autoSetup({
        deck1: decks[0]?.decklist ?? "",
        deck2: decks[1]?.decklist ?? "",
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.gameStarted]);

  return (
    <SimulatorBoard
      store={store}
      actions={actions}
      undo={undo}
      redo={redo}
      canUndo={canUndo}
      canRedo={canRedo}
    />
  );
}
