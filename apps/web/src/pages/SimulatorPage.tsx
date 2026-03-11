import { useEffect } from "react";
import { SimulatorBoard } from "./simulator/SimulatorBoard";
import { useSimulatorState } from "./simulator/useSimulatorState";
import type { SimulatorStore } from "./simulator/types";
import { createEmptyPlayer } from "./simulator/logic";
import { useSimulatorActions } from "./simulator/useSimulatorActions";

const DEFAULT_DECKLIST = [
  "4 Pikachu",
  "4 Charmander",
  "4 Bulbasaur",
  "4 Squirtle",
  "4 Nest Ball",
  "4 Ultra Ball",
  "4 Potion",
  "4 Switch",
  "4 Professor's Research",
  "4 Boss's Orders",
  "12 Lightning Energy",
  "8 Fire Energy",
].join("\n");

function createInitialStore(): SimulatorStore {
  return {
    phase: "idle",
    winner: null,
    coinFlipResult: null,
    deckInput1: DEFAULT_DECKLIST,
    deckInput2: DEFAULT_DECKLIST,
    loading: false,
    firstPlayer: 0,
    currentTurn: 0,
    turnNumber: 1,
    turnDrawDone: false,
    selectedHandUid: [null, null],
    selectedPrizeUid: [null, null],
    revealedPrizeUids: [[], []],
    nameQueryCache: {},
    logs: [
      "Loading decklists and setting up the game...",
    ],
    players: [createEmptyPlayer(), createEmptyPlayer()],
    stadium: null,
    gameStarted: false,
  };
}

export function SimulatorPage() {
  const { store, withStore } = useSimulatorState(createInitialStore);
  const { actions, autoSetup } = useSimulatorActions(withStore);

  useEffect(() => {
    if (store.gameStarted) return;
    void autoSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.gameStarted]);

  return <SimulatorBoard store={store} actions={actions} />;
}
