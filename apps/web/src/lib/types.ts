// ---------------------------------------------------------------------------
// Card data types
// ---------------------------------------------------------------------------

export interface CardAbility {
  type: string;
  name: string;
  effect: string;
}

export interface CardAttack {
  cost: string[];
  name: string;
  effect?: string | null;
  damage?: string | number | null;
}

export interface CardTypeModifier {
  type: string;
  value: string;
}

export interface CardSummary {
  id: string;
  local_id: string;
  name: string;
  image: string | null;
  category: string;
  rarity: string | null;
  hp: number | null;
  stage?: string | null;
  trainer_type?: string | null;
  energy_type?: string | null;
  suffix?: string | null;
  evolve_from?: string | null;
  retreat?: number | null;
  effect?: string | null;
  types?: string[];
  attacks?: CardAttack[];
  abilities?: CardAbility[];
  weaknesses?: CardTypeModifier[];
  resistances?: CardTypeModifier[];
  set_id: string;
  set_name: string | null;
}

export interface CardDetail extends CardSummary {
  evolve_from?: string | null;
  description?: string | null;
  illustrator?: string | null;
  regulation_mark?: string | null;
  legal_standard?: number;
  legal_expanded?: number;
  dex_ids?: number[];
  set_logo?: string | null;
  set_symbol?: string | null;
  set_release_date?: string | null;
}

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

export interface CardListResponse {
  data: CardSummary[];
  total: number;
  hasMore: boolean;
}

export interface SetSummary {
  id: string;
  name: string;
  logo: string | null;
  symbol: string | null;
  card_count_total: number;
  card_count_official: number;
  release_date: string | null;
  series_id: string;
  series_name: string | null;
}

export interface SetListResponse {
  data: SetSummary[];
}

export interface FilterOptions {
  categories: string[];
  rarities: string[];
  stages: string[];
  trainer_types: string[];
  energy_types: string[];
  types: string[];
  weaknesses: string[];
  resistances: string[];
  retreats: number[];
  hp: { min: number; max: number };
  regulation_marks: string[];
}

export interface DeckSummary {
  id: number;
  name: string;
  decklist: string;
  created_at: string;
}

export interface RuleStatus {
  allowed: boolean;
  reason: string | null;
}

export interface AttackRule extends RuleStatus {
  index: number;
  name: string;
}

export interface AbilityRule extends RuleStatus {
  pokemonUid: string;
  abilityIdx: number;
  name: string;
}

export interface HandCardRules {
  active: RuleStatus;
  bench: RuleStatus;
  stadium: RuleStatus;
  trainerUse: RuleStatus;
  benchPokemon: Record<string, RuleStatus>;
}

export interface SimulatorRulesResponse {
  currentPlayer: 0 | 1;
  locked: boolean;
  endTurn: RuleStatus;
  stadiumAbility: RuleStatus;
  attacks: AttackRule[];
  abilities: AbilityRule[];
  retreatTargets: Record<string, RuleStatus>;
  hand: Record<string, HandCardRules>;
}
