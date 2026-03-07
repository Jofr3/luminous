import { useEffect, useReducer, useRef } from "react";
import type { SimulatorStore } from "./types";

export function useSimulatorState(initial: () => SimulatorStore) {
  const [store, setStore] = useReducer(
    (_prev: SimulatorStore, next: SimulatorStore) => next,
    undefined,
    initial,
  );
  const storeRef = useRef(store);

  useEffect(() => {
    storeRef.current = store;
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

  return { store, withStore };
}
