import {
  $,
  component$,
  useSignal,
  useTask$,
  useComputed$,
} from "@builder.io/qwik";
import { useLocation, useNavigate } from "@builder.io/qwik-city";
import type { FilterOptions, SetSummary } from "~/lib/types";

interface FilterSidebarProps {
  filterOptions: FilterOptions;
  sets: SetSummary[];
}

// --- Helpers ---

function getParamValues(params: URLSearchParams, key: string): string[] {
  const val = params.get(key);
  if (!val) return [];
  return val.split(",").filter(Boolean);
}

// --- FilterSidebar ---

export const FilterSidebar = component$<FilterSidebarProps>(
  ({ filterOptions, sets }) => {
    const loc = useLocation();
    const nav = useNavigate();
    const mobileOpen = useSignal(false);
    const setSearch = useSignal("");
    const hpMinInput = useSignal("");
    const hpMaxInput = useSignal("");
    const hpTimer = useSignal<number>();

    // Sync HP inputs from URL
    useTask$(({ track }) => {
      track(() => loc.url.searchParams.get("hp_min"));
      track(() => loc.url.searchParams.get("hp_max"));
      hpMinInput.value = loc.url.searchParams.get("hp_min") ?? "";
      hpMaxInput.value = loc.url.searchParams.get("hp_max") ?? "";
    });

    const activeCount = useComputed$(() => {
      const p = loc.url.searchParams;
      let count = 0;
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
      for (const k of keys) {
        if (p.get(k)) count++;
      }
      return count;
    });

    const toggleSingle = $((key: string, value: string) => {
      const params = new URLSearchParams(loc.url.searchParams.toString());
      if (params.get(key) === value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      params.delete("offset");
      nav(`/?${params.toString()}`);
    });

    const toggleMulti = $((key: string, value: string) => {
      const params = new URLSearchParams(loc.url.searchParams.toString());
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
      params.delete("offset");
      nav(`/?${params.toString()}`);
    });

    const toggleBool = $((key: string) => {
      const params = new URLSearchParams(loc.url.searchParams.toString());
      if (params.get(key)) {
        params.delete(key);
      } else {
        params.set(key, "1");
      }
      params.delete("offset");
      nav(`/?${params.toString()}`);
    });

    const setHP = $((key: string, value: string) => {
      const params = new URLSearchParams(loc.url.searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("offset");
      nav(`/?${params.toString()}`);
    });

    const clearAll = $(() => {
      const params = new URLSearchParams();
      const q = loc.url.searchParams.get("q");
      if (q) params.set("q", q);
      nav(`/?${params.toString()}`);
      mobileOpen.value = false;
    });

    const selectSet = $((setId: string) => {
      const params = new URLSearchParams(loc.url.searchParams.toString());
      if (setId) {
        params.set("set", setId);
      } else {
        params.delete("set");
      }
      params.delete("offset");
      setSearch.value = "";
      nav(`/?${params.toString()}`);
    });

    const filteredSets = useComputed$(() => {
      const s = setSearch.value.toLowerCase();
      if (!s) return sets.slice(0, 20);
      return sets.filter((set) => set.name.toLowerCase().includes(s));
    });

    const selectedSetName = useComputed$(() => {
      const id = loc.url.searchParams.get("set");
      if (!id) return "";
      return sets.find((s) => s.id === id)?.name ?? id;
    });

    const sidebarContent = (
      <div class="filter-sidebar__inner">
        <div class="filter-sidebar__header">
          <h3 class="filter-sidebar__title">Filters</h3>
          {activeCount.value > 0 && (
            <button class="filter-clear-btn" onClick$={clearAll}>
              Clear ({activeCount.value})
            </button>
          )}
          <button
            class="filter-sidebar__close"
            onClick$={() => {
              mobileOpen.value = false;
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M5 5L15 15M15 5L5 15"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>

        {/* --- Category --- */}
        <details
          class="filter-group"
          open={!!loc.url.searchParams.get("category") || undefined}
        >
          <summary class="filter-group__header">Category</summary>
          <div class="filter-group__content">
            {filterOptions.categories.map((v) => (
              <label key={v} class="filter-checkbox">
                <input
                  type="checkbox"
                  checked={loc.url.searchParams.get("category") === v}
                  onChange$={() => toggleSingle("category", v)}
                />
                <span>{v}</span>
              </label>
            ))}
          </div>
        </details>

        {/* --- Set --- */}
        <details
          class="filter-group"
          open={!!loc.url.searchParams.get("set") || undefined}
        >
          <summary class="filter-group__header">Set</summary>
          <div class="filter-group__content">
            {selectedSetName.value && (
              <div class="filter-set-active">
                <span>{selectedSetName.value}</span>
                <button
                  class="filter-set-clear"
                  onClick$={() => selectSet("")}
                >
                  x
                </button>
              </div>
            )}
            <input
              class="filter-select__search"
              type="text"
              placeholder="Search sets..."
              value={setSearch.value}
              onInput$={(_, el) => {
                setSearch.value = el.value;
              }}
            />
            <div class="filter-select__list">
              {filteredSets.value.map((s) => (
                <button
                  key={s.id}
                  class={`filter-select__option ${loc.url.searchParams.get("set") === s.id ? "filter-select__option--active" : ""}`}
                  onClick$={() => selectSet(s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        </details>

        {/* --- Rarity --- */}
        <details
          class="filter-group"
          open={!!loc.url.searchParams.get("rarity") || undefined}
        >
          <summary class="filter-group__header">Rarity</summary>
          <div class="filter-group__content">
            {filterOptions.rarities.map((v) => (
              <label key={v} class="filter-checkbox">
                <input
                  type="checkbox"
                  checked={loc.url.searchParams.get("rarity") === v}
                  onChange$={() => toggleSingle("rarity", v)}
                />
                <span>{v}</span>
              </label>
            ))}
          </div>
        </details>

        {/* --- Stage --- */}
        {filterOptions.stages.length > 0 && (
          <details
            class="filter-group"
            open={!!loc.url.searchParams.get("stage") || undefined}
          >
            <summary class="filter-group__header">Stage</summary>
            <div class="filter-group__content">
              {filterOptions.stages.map((v) => (
                <label key={v} class="filter-checkbox">
                  <input
                    type="checkbox"
                    checked={loc.url.searchParams.get("stage") === v}
                    onChange$={() => toggleSingle("stage", v)}
                  />
                  <span>{v}</span>
                </label>
              ))}
            </div>
          </details>
        )}

        {/* --- Types --- */}
        {filterOptions.types.length > 0 && (
          <details
            class="filter-group"
            open={!!loc.url.searchParams.get("types") || undefined}
          >
            <summary class="filter-group__header">Types</summary>
            <div class="filter-group__content">
              {filterOptions.types.map((v) => (
                <label key={v} class="filter-checkbox">
                  <input
                    type="checkbox"
                    checked={getParamValues(loc.url.searchParams, "types").includes(v)}
                    onChange$={() => toggleMulti("types", v)}
                  />
                  <span>{v}</span>
                </label>
              ))}
            </div>
          </details>
        )}

        {/* --- Weaknesses --- */}
        {filterOptions.weaknesses.length > 0 && (
          <details
            class="filter-group"
            open={!!loc.url.searchParams.get("weakness") || undefined}
          >
            <summary class="filter-group__header">Weakness</summary>
            <div class="filter-group__content">
              {filterOptions.weaknesses.map((v) => (
                <label key={v} class="filter-checkbox">
                  <input
                    type="checkbox"
                    checked={getParamValues(loc.url.searchParams, "weakness").includes(v)}
                    onChange$={() => toggleMulti("weakness", v)}
                  />
                  <span>{v}</span>
                </label>
              ))}
            </div>
          </details>
        )}

        {/* --- Resistances --- */}
        {filterOptions.resistances.length > 0 && (
          <details
            class="filter-group"
            open={!!loc.url.searchParams.get("resistance") || undefined}
          >
            <summary class="filter-group__header">Resistance</summary>
            <div class="filter-group__content">
              {filterOptions.resistances.map((v) => (
                <label key={v} class="filter-checkbox">
                  <input
                    type="checkbox"
                    checked={getParamValues(loc.url.searchParams, "resistance").includes(v)}
                    onChange$={() => toggleMulti("resistance", v)}
                  />
                  <span>{v}</span>
                </label>
              ))}
            </div>
          </details>
        )}

        {/* --- HP Range --- */}
        <details
          class="filter-group"
          open={
            !!(
              loc.url.searchParams.get("hp_min") ||
              loc.url.searchParams.get("hp_max")
            ) || undefined
          }
        >
          <summary class="filter-group__header">HP</summary>
          <div class="filter-group__content">
            <div class="filter-range">
              <input
                type="number"
                class="filter-range__input"
                placeholder={String(filterOptions.hp.min)}
                value={hpMinInput.value}
                onInput$={(_, el) => {
                  hpMinInput.value = el.value;
                  if (hpTimer.value) clearTimeout(hpTimer.value);
                  hpTimer.value = setTimeout(
                    () => setHP("hp_min", el.value),
                    300,
                  ) as unknown as number;
                }}
              />
              <span class="filter-range__sep">-</span>
              <input
                type="number"
                class="filter-range__input"
                placeholder={String(filterOptions.hp.max)}
                value={hpMaxInput.value}
                onInput$={(_, el) => {
                  hpMaxInput.value = el.value;
                  if (hpTimer.value) clearTimeout(hpTimer.value);
                  hpTimer.value = setTimeout(
                    () => setHP("hp_max", el.value),
                    300,
                  ) as unknown as number;
                }}
              />
            </div>
          </div>
        </details>

        {/* --- Retreat --- */}
        {filterOptions.retreats.length > 0 && (
          <details
            class="filter-group"
            open={!!loc.url.searchParams.get("retreat") || undefined}
          >
            <summary class="filter-group__header">Retreat Cost</summary>
            <div class="filter-group__content">
              {filterOptions.retreats.map((v) => (
                <label key={v} class="filter-checkbox">
                  <input
                    type="checkbox"
                    checked={
                      loc.url.searchParams.get("retreat") === String(v)
                    }
                    onChange$={() => toggleSingle("retreat", String(v))}
                  />
                  <span>{v}</span>
                </label>
              ))}
            </div>
          </details>
        )}

        {/* --- Trainer Type --- */}
        {filterOptions.trainer_types.length > 0 && (
          <details
            class="filter-group"
            open={!!loc.url.searchParams.get("trainer_type") || undefined}
          >
            <summary class="filter-group__header">Trainer Type</summary>
            <div class="filter-group__content">
              {filterOptions.trainer_types.map((v) => (
                <label key={v} class="filter-checkbox">
                  <input
                    type="checkbox"
                    checked={loc.url.searchParams.get("trainer_type") === v}
                    onChange$={() => toggleSingle("trainer_type", v)}
                  />
                  <span>{v}</span>
                </label>
              ))}
            </div>
          </details>
        )}

        {/* --- Energy Type --- */}
        {filterOptions.energy_types.length > 0 && (
          <details
            class="filter-group"
            open={!!loc.url.searchParams.get("energy_type") || undefined}
          >
            <summary class="filter-group__header">Energy Type</summary>
            <div class="filter-group__content">
              {filterOptions.energy_types.map((v) => (
                <label key={v} class="filter-checkbox">
                  <input
                    type="checkbox"
                    checked={loc.url.searchParams.get("energy_type") === v}
                    onChange$={() => toggleSingle("energy_type", v)}
                  />
                  <span>{v}</span>
                </label>
              ))}
            </div>
          </details>
        )}

        {/* --- Legality --- */}
        <details class="filter-group">
          <summary class="filter-group__header">Legality</summary>
          <div class="filter-group__content">
            <label class="filter-toggle">
              <span>Standard Legal</span>
              <input
                type="checkbox"
                class="filter-toggle__input"
                checked={!!loc.url.searchParams.get("legal_standard")}
                onChange$={() => toggleBool("legal_standard")}
              />
              <span class="filter-toggle__track">
                <span class="filter-toggle__thumb" />
              </span>
            </label>
            <label class="filter-toggle">
              <span>Expanded Legal</span>
              <input
                type="checkbox"
                class="filter-toggle__input"
                checked={!!loc.url.searchParams.get("legal_expanded")}
                onChange$={() => toggleBool("legal_expanded")}
              />
              <span class="filter-toggle__track">
                <span class="filter-toggle__thumb" />
              </span>
            </label>
          </div>
        </details>
      </div>
    );

    return (
      <>
        {/* Desktop sidebar */}
        <aside class="filter-sidebar">{sidebarContent}</aside>

        {/* Mobile FAB */}
        <button
          class="filter-fab"
          onClick$={() => {
            mobileOpen.value = true;
          }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M3 5H17M6 10H14M9 15H11"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
          {activeCount.value > 0 && (
            <span class="filter-fab__badge">{activeCount.value}</span>
          )}
        </button>

        {/* Mobile drawer */}
        {mobileOpen.value && (
          <>
            <div
              class="filter-backdrop"
              onClick$={() => {
                mobileOpen.value = false;
              }}
            />
            <aside class="filter-sidebar filter-sidebar--mobile">
              {sidebarContent}
            </aside>
          </>
        )}
      </>
    );
  },
);
