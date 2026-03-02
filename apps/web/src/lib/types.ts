export interface CardSummary {
  id: string;
  local_id: string;
  name: string;
  image: string | null;
  category: string;
  rarity: string | null;
  hp: number | null;
  set_id: string;
  set_name: string | null;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CardListResponse {
  data: CardSummary[];
  pagination: PaginationInfo;
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
