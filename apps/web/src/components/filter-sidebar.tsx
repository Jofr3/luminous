import { useEffect, useMemo, useRef, useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import type { FilterOptions, SetSummary } from "~/lib/types";

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

  const filteredSets = useMemo(() => {
    const s = setSearch.toLowerCase();
    if (!s) return sets.slice(0, 20);
    return sets.filter((set) => set.name.toLowerCase().includes(s));
  }, [setSearch, sets]);

  const selectedSetName = useMemo(() => {
    const id = searchParams.get("set");
    if (!id) return "";
    return sets.find((s) => s.id === id)?.name ?? id;
  }, [searchParams, sets]);

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

      <details className="filter-group" open={!!searchParams.get("category") || undefined}>
        <summary className="filter-group__header">Category</summary>
        <div className="filter-group__content">
          {filterOptions.categories.map((v) => (
            <label key={v} className="filter-checkbox">
              <input
                type="checkbox"
                checked={searchParams.get("category") === v}
                onChange={() => toggleSingle("category", v)}
              />
              <span>{v}</span>
            </label>
          ))}
        </div>
      </details>

      <details className="filter-group" open={!!searchParams.get("set") || undefined}>
        <summary className="filter-group__header">Set</summary>
        <div className="filter-group__content">
          {selectedSetName && (
            <div className="filter-set-active">
              <span>{selectedSetName}</span>
              <button className="filter-set-clear" onClick={() => selectSet("")}>
                x
              </button>
            </div>
          )}
          <input
            className="filter-select__search"
            type="text"
            placeholder="Search sets..."
            value={setSearch}
            onInput={(e) => setSetSearch((e.target as HTMLInputElement).value)}
          />
          <div className="filter-select__list">
            {filteredSets.map((s) => (
              <button
                key={s.id}
                className={`filter-select__option ${searchParams.get("set") === s.id ? "filter-select__option--active" : ""}`}
                onClick={() => selectSet(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      </details>

      <details className="filter-group" open={!!searchParams.get("rarity") || undefined}>
        <summary className="filter-group__header">Rarity</summary>
        <div className="filter-group__content">
          {filterOptions.rarities.map((v) => (
            <label key={v} className="filter-checkbox">
              <input
                type="checkbox"
                checked={searchParams.get("rarity") === v}
                onChange={() => toggleSingle("rarity", v)}
              />
              <span>{v}</span>
            </label>
          ))}
        </div>
      </details>

      {filterOptions.stages.length > 0 && (
        <details className="filter-group" open={!!searchParams.get("stage") || undefined}>
          <summary className="filter-group__header">Stage</summary>
          <div className="filter-group__content">
            {filterOptions.stages.map((v) => (
              <label key={v} className="filter-checkbox">
                <input
                  type="checkbox"
                  checked={searchParams.get("stage") === v}
                  onChange={() => toggleSingle("stage", v)}
                />
                <span>{v}</span>
              </label>
            ))}
          </div>
        </details>
      )}

      {filterOptions.types.length > 0 && (
        <details className="filter-group" open={!!searchParams.get("types") || undefined}>
          <summary className="filter-group__header">Types</summary>
          <div className="filter-group__content">
            {filterOptions.types.map((v) => (
              <label key={v} className="filter-checkbox">
                <input
                  type="checkbox"
                  checked={getParamValues(searchParams, "types").includes(v)}
                  onChange={() => toggleMulti("types", v)}
                />
                <span>{v}</span>
              </label>
            ))}
          </div>
        </details>
      )}

      <details
        className="filter-group"
        open={!!(searchParams.get("hp_min") || searchParams.get("hp_max")) || undefined}
      >
        <summary className="filter-group__header">HP</summary>
        <div className="filter-group__content">
          <div className="filter-range">
            <input
              type="number"
              className="filter-range__input"
              placeholder={String(filterOptions.hp.min)}
              value={hpMinInput}
              onInput={(e) => {
                const value = (e.target as HTMLInputElement).value;
                setHpMinInput(value);
                if (hpTimer.current) window.clearTimeout(hpTimer.current);
                hpTimer.current = window.setTimeout(() => setHP("hp_min", value), 300);
              }}
            />
            <span className="filter-range__sep">-</span>
            <input
              type="number"
              className="filter-range__input"
              placeholder={String(filterOptions.hp.max)}
              value={hpMaxInput}
              onInput={(e) => {
                const value = (e.target as HTMLInputElement).value;
                setHpMaxInput(value);
                if (hpTimer.current) window.clearTimeout(hpTimer.current);
                hpTimer.current = window.setTimeout(() => setHP("hp_max", value), 300);
              }}
            />
          </div>
        </div>
      </details>

      <details className="filter-group">
        <summary className="filter-group__header">Legality</summary>
        <div className="filter-group__content">
          <label className="filter-toggle">
            <span>Standard Legal</span>
            <input
              type="checkbox"
              className="filter-toggle__input"
              checked={!!searchParams.get("legal_standard")}
              onChange={() => toggleBool("legal_standard")}
            />
            <span className="filter-toggle__track">
              <span className="filter-toggle__thumb" />
            </span>
          </label>
          <label className="filter-toggle">
            <span>Expanded Legal</span>
            <input
              type="checkbox"
              className="filter-toggle__input"
              checked={!!searchParams.get("legal_expanded")}
              onChange={() => toggleBool("legal_expanded")}
            />
            <span className="filter-toggle__track">
              <span className="filter-toggle__thumb" />
            </span>
          </label>
        </div>
      </details>
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
