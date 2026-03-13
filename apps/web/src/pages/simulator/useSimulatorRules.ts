import { useEffect, useState } from "react";
import { fetchSimulatorRules } from "~/lib/api";
import type { SimulatorRulesResponse } from "~/lib/types";
import type { SimulatorStore } from "./types";

export function useSimulatorRules(store: SimulatorStore) {
  const [rules, setRules] = useState<SimulatorRulesResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    void fetchSimulatorRules(store)
      .then((nextRules) => {
        if (!cancelled) {
          setRules(nextRules);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRules(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [store]);

  return rules;
}
