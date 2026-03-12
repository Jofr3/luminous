import { useCallback, useEffect, useReducer, useRef } from "react";
import type { PokemonInPlay, SimulatorStore } from "./types";
import { syncUidCounterFromStore } from "./logic";

const STORAGE_KEY = "luminous.simulator.store.v2";
const MAX_HISTORY = 200;

/** Backfill fields added after v1 so old localStorage data doesn't crash */
function migrateStore(store: SimulatorStore): SimulatorStore {
  store.stadium ??= null;
  store.gameStarted ??= store.phase !== "idle";
  for (const player of store.players) {
    player.supporterPlayedThisTurn ??= false;
    player.retreatedThisTurn ??= false;
    const migratePokemon = (p: PokemonInPlay | null) => {
      if (!p) return;
      p.specialConditions ??= [];
      p.poisonDamage ??= 10;
      p.burnDamage ??= 20;
      p.turnPlayedOrEvolved ??= 0;
      p.usedAbilityThisTurn ??= false;
    };
    migratePokemon(player.active);
    for (const b of player.bench) migratePokemon(b);
  }
  return store;
}

export function useSimulatorState(initial: () => SimulatorStore) {
  const hydratedFromStorageRef = useRef(false);
  const [store, setStore] = useReducer(
    (_prev: SimulatorStore, next: SimulatorStore) => next,
    undefined,
    () => {
      if (typeof window === "undefined") {
        return initial();
      }

      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          return initial();
        }

        const parsed = migrateStore(JSON.parse(raw) as SimulatorStore);
        hydratedFromStorageRef.current = true;
        syncUidCounterFromStore(parsed);
        return parsed;
      } catch {
        return initial();
      }
    },
  );
  const storeRef = useRef(store);
  const historyRef = useRef<SimulatorStore[]>([]);
  const futureRef = useRef<SimulatorStore[]>([]);

  useEffect(() => {
    storeRef.current = store;
    syncUidCounterFromStore(store);
  }, [store]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }, [store]);

  const withStore = <Args extends unknown[], R>(
    fn: (draft: SimulatorStore, ...args: Args) => R | Promise<R>,
  ) => {
    return async (...args: Args): Promise<R> => {
      const prev = storeRef.current;
      const draft = structuredClone(prev);
      const result = await fn(draft, ...args);

      if (JSON.stringify(prev) !== JSON.stringify(draft)) {
        historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 1)), prev];
        futureRef.current = [];
        setStore(draft);
      }

      return result;
    };
  };

  const undo = useCallback(() => {
    const history = historyRef.current;
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    historyRef.current = history.slice(0, -1);
    futureRef.current = [...futureRef.current, storeRef.current];
    syncUidCounterFromStore(prev);
    setStore(prev);
  }, []);

  const redo = useCallback(() => {
    const future = futureRef.current;
    if (future.length === 0) return;
    const next = future[future.length - 1];
    futureRef.current = future.slice(0, -1);
    historyRef.current = [...historyRef.current, storeRef.current];
    syncUidCounterFromStore(next);
    setStore(next);
  }, []);

  return {
    store,
    withStore,
    hydratedFromStorage: hydratedFromStorageRef.current,
    undo,
    redo,
    canUndo: historyRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
  };
}
