import { useMemo } from "react";
import type { SetSummary } from "~/lib/types";

interface GroupProps {
  title: string;
  open?: boolean;
  children: React.ReactNode;
}

function FilterGroup({ title, open, children }: GroupProps) {
  return (
    <details className="filter-group" open={open || undefined}>
      <summary className="filter-group__header">{title}</summary>
      <div className="filter-group__content">{children}</div>
    </details>
  );
}

interface OptionGroupProps {
  title: string;
  options: string[];
  selectedValue: string | null;
  onToggle: (value: string) => void;
}

export function SingleSelectFilterGroup({
  title,
  options,
  selectedValue,
  onToggle,
}: OptionGroupProps) {
  if (options.length === 0) return null;

  return (
    <FilterGroup title={title} open={!!selectedValue}>
      {options.map((value) => (
        <label key={value} className="filter-checkbox">
          <input
            type="checkbox"
            checked={selectedValue === value}
            onChange={() => onToggle(value)}
          />
          <span>{value}</span>
        </label>
      ))}
    </FilterGroup>
  );
}

interface MultiSelectFilterGroupProps {
  title: string;
  options: string[];
  selectedValues: string[];
  onToggle: (value: string) => void;
}

export function MultiSelectFilterGroup({
  title,
  options,
  selectedValues,
  onToggle,
}: MultiSelectFilterGroupProps) {
  if (options.length === 0) return null;

  return (
    <FilterGroup title={title} open={selectedValues.length > 0}>
      {options.map((value) => (
        <label key={value} className="filter-checkbox">
          <input
            type="checkbox"
            checked={selectedValues.includes(value)}
            onChange={() => onToggle(value)}
          />
          <span>{value}</span>
        </label>
      ))}
    </FilterGroup>
  );
}

interface SetFilterGroupProps {
  sets: SetSummary[];
  selectedSetId: string | null;
  setSearch: string;
  onSearchChange: (value: string) => void;
  onSelect: (setId: string) => void;
}

export function SetFilterGroup({
  sets,
  selectedSetId,
  setSearch,
  onSearchChange,
  onSelect,
}: SetFilterGroupProps) {
  const filteredSets = useMemo(() => {
    const search = setSearch.toLowerCase();
    if (!search) return sets.slice(0, 20);
    return sets.filter((set) => set.name.toLowerCase().includes(search));
  }, [setSearch, sets]);

  const selectedSetName = useMemo(() => {
    if (!selectedSetId) return "";
    return sets.find((set) => set.id === selectedSetId)?.name ?? selectedSetId;
  }, [selectedSetId, sets]);

  return (
    <FilterGroup title="Set" open={!!selectedSetId}>
      {selectedSetName && (
        <div className="filter-set-active">
          <span>{selectedSetName}</span>
          <button type="button" className="filter-set-clear" onClick={() => onSelect("")}>
            x
          </button>
        </div>
      )}
      <input
        className="filter-select__search"
        type="text"
        placeholder="Search sets..."
        value={setSearch}
        onInput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
      />
      <div className="filter-select__list">
        {filteredSets.map((set) => (
          <button
            type="button"
            key={set.id}
            className={`filter-select__option ${selectedSetId === set.id ? "filter-select__option--active" : ""}`}
            onClick={() => onSelect(set.id)}
          >
            {set.name}
          </button>
        ))}
      </div>
    </FilterGroup>
  );
}

interface HpFilterGroupProps {
  minPlaceholder: number;
  maxPlaceholder: number;
  hpMinInput: string;
  hpMaxInput: string;
  open: boolean;
  onMinInput: (value: string) => void;
  onMaxInput: (value: string) => void;
}

export function HpFilterGroup({
  minPlaceholder,
  maxPlaceholder,
  hpMinInput,
  hpMaxInput,
  open,
  onMinInput,
  onMaxInput,
}: HpFilterGroupProps) {
  return (
    <FilterGroup title="HP" open={open}>
      <div className="filter-range">
        <input
          type="number"
          className="filter-range__input"
          placeholder={String(minPlaceholder)}
          value={hpMinInput}
          onInput={(e) => onMinInput((e.target as HTMLInputElement).value)}
        />
        <span className="filter-range__sep">-</span>
        <input
          type="number"
          className="filter-range__input"
          placeholder={String(maxPlaceholder)}
          value={hpMaxInput}
          onInput={(e) => onMaxInput((e.target as HTMLInputElement).value)}
        />
      </div>
    </FilterGroup>
  );
}

interface LegalityFilterGroupProps {
  legalStandard: boolean;
  legalExpanded: boolean;
  onToggleStandard: () => void;
  onToggleExpanded: () => void;
}

export function LegalityFilterGroup({
  legalStandard,
  legalExpanded,
  onToggleStandard,
  onToggleExpanded,
}: LegalityFilterGroupProps) {
  return (
    <FilterGroup title="Legality">
      <label className="filter-toggle">
        <span>Standard Legal</span>
        <input
          type="checkbox"
          className="filter-toggle__input"
          checked={legalStandard}
          onChange={onToggleStandard}
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
          checked={legalExpanded}
          onChange={onToggleExpanded}
        />
        <span className="filter-toggle__track">
          <span className="filter-toggle__thumb" />
        </span>
      </label>
    </FilterGroup>
  );
}
