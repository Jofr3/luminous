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
  set_id: string;
  set_name: string | null;
}

export interface CardAttack {
  cost?: string[];
  name?: string;
  effect?: string;
  damage?: string | number;
}

export interface CardTypeModifier {
  type?: string;
  value?: string;
}

export interface CardDetail extends CardSummary {
  types?: string[] | string | null;
  attacks?: CardAttack[] | string | null;
  weaknesses?: CardTypeModifier[] | string | null;
  resistances?: CardTypeModifier[] | string | null;
}

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
