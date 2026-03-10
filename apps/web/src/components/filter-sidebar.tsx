import { useEffect, useMemo, useRef, useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import type { FilterOptions, SetSummary } from "~/lib/types";
import {
  HpFilterGroup,
  LegalityFilterGroup,
  MultiSelectFilterGroup,
  SetFilterGroup,
  SingleSelectFilterGroup,
} from "./filter-sidebar-sections";

interface FilterSidebarProps {
  filterOptions: FilterOptions;
  sets: SetSummary[];
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
}

function getParamValues(params: URLSearchParams, key: string): string[] {
  const val = params.get(key);
  if (!val) return [];
  return val.split(",").filter(Boolean);
}

export function FilterSidebar({
  filterOptions,
  sets,
  searchParams,
  setSearchParams,
}: FilterSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [setSearch, setSetSearch] = useState("");
  const [hpMinInput, setHpMinInput] = useState("");
  const [hpMaxInput, setHpMaxInput] = useState("");
  const hpTimer = useRef<number | null>(null);

  useEffect(() => {
    setHpMinInput(searchParams.get("hp_min") ?? "");
    setHpMaxInput(searchParams.get("hp_max") ?? "");
  }, [searchParams]);

  useEffect(() => {
    return () => {
      if (hpTimer.current) {
        window.clearTimeout(hpTimer.current);
      }
    };
  }, []);

  const activeCount = useMemo(() => {
    const keys = [
      "category",
      "rarity",
      "stage",
      "trainer_type",
      "energy_type",
      "types",
      "weakness",
      "resistance",
      "retreat",
      "set",
      "legal_standard",
      "legal_expanded",
      "hp_min",
      "hp_max",
    ];
    return keys.reduce((acc, key) => (searchParams.get(key) ? acc + 1 : acc), 0);
  }, [searchParams]);

  const mutateParams = (fn: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    fn(params);
    params.delete("offset");
    setSearchParams(params);
  };

  const toggleSingle = (key: string, value: string) => {
    mutateParams((params) => {
      if (params.get(key) === value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
  };

  const toggleMulti = (key: string, value: string) => {
    mutateParams((params) => {
      const current = getParamValues(params, key);
      const idx = current.indexOf(value);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else {
        current.push(value);
      }
      if (current.length > 0) {
        params.set(key, current.join(","));
      } else {
        params.delete(key);
      }
    });
  };

  const toggleBool = (key: string) => {
    mutateParams((params) => {
      if (params.get(key)) {
        params.delete(key);
      } else {
        params.set(key, "1");
      }
    });
  };

  const setHP = (key: string, value: string) => {
    mutateParams((params) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
  };

  const clearAll = () => {
    const params = new URLSearchParams();
    const q = searchParams.get("q");
    if (q) params.set("q", q);
    setSearchParams(params);
    setMobileOpen(false);
  };

  const selectSet = (setId: string) => {
    mutateParams((params) => {
      if (setId) {
        params.set("set", setId);
      } else {
        params.delete("set");
      }
    });
    setSetSearch("");
  };

  const sidebarContent = (
    <div className="filter-sidebar__inner">
      <div className="filter-sidebar__header">
        <h3 className="filter-sidebar__title">Filters</h3>
        {activeCount > 0 && (
          <button className="filter-clear-btn" onClick={clearAll}>
            Clear ({activeCount})
          </button>
        )}
        <button className="filter-sidebar__close" onClick={() => setMobileOpen(false)}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M5 5L15 15M15 5L5 15"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <SingleSelectFilterGroup
        title="Category"
        options={filterOptions.categories}
        selectedValue={searchParams.get("category")}
        onToggle={(value) => toggleSingle("category", value)}
      />

      <SetFilterGroup
        sets={sets}
        selectedSetId={searchParams.get("set")}
        setSearch={setSearch}
        onSearchChange={setSetSearch}
        onSelect={selectSet}
      />

      <SingleSelectFilterGroup
        title="Rarity"
        options={filterOptions.rarities}
        selectedValue={searchParams.get("rarity")}
        onToggle={(value) => toggleSingle("rarity", value)}
      />

      <SingleSelectFilterGroup
        title="Stage"
        options={filterOptions.stages}
        selectedValue={searchParams.get("stage")}
        onToggle={(value) => toggleSingle("stage", value)}
      />

      <MultiSelectFilterGroup
        title="Types"
        options={filterOptions.types}
        selectedValues={getParamValues(searchParams, "types")}
        onToggle={(value) => toggleMulti("types", value)}
      />

      <HpFilterGroup
        minPlaceholder={filterOptions.hp.min}
        maxPlaceholder={filterOptions.hp.max}
        hpMinInput={hpMinInput}
        hpMaxInput={hpMaxInput}
        open={!!(searchParams.get("hp_min") || searchParams.get("hp_max"))}
        onMinInput={(value) => {
          setHpMinInput(value);
          if (hpTimer.current) window.clearTimeout(hpTimer.current);
          hpTimer.current = window.setTimeout(() => setHP("hp_min", value), 300);
        }}
        onMaxInput={(value) => {
          setHpMaxInput(value);
          if (hpTimer.current) window.clearTimeout(hpTimer.current);
          hpTimer.current = window.setTimeout(() => setHP("hp_max", value), 300);
        }}
      />

      <LegalityFilterGroup
        legalStandard={!!searchParams.get("legal_standard")}
        legalExpanded={!!searchParams.get("legal_expanded")}
        onToggleStandard={() => toggleBool("legal_standard")}
        onToggleExpanded={() => toggleBool("legal_expanded")}
      />
    </div>
  );

  return (
    <>
      <aside className="filter-sidebar">{sidebarContent}</aside>

      <button className="filter-fab" onClick={() => setMobileOpen(true)}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M3 5H17M6 10H14M9 15H11"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        {activeCount > 0 && <span className="filter-fab__badge">{activeCount}</span>}
      </button>

      {mobileOpen && (
        <>
          <div className="filter-backdrop" onClick={() => setMobileOpen(false)} />
          <aside className="filter-sidebar filter-sidebar--mobile">{sidebarContent}</aside>
        </>
      )}
    </>
  );
}
