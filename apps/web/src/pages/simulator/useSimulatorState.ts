import { useEffect, useReducer, useRef } from "react";
import type { PokemonInPlay, SimulatorStore } from "./types";
import { syncUidCounterFromStore } from "./logic";

const STORAGE_KEY = "luminous.simulator.store.v1";

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
      const draft = structuredClone(storeRef.current);
      const result = await fn(draft, ...args);
      setStore(draft);
      return result;
    };
  };

  return { store, withStore, hydratedFromStorage: hydratedFromStorageRef.current };
}
