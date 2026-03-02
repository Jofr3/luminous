/** Brief series from GET /v2/en/series */
export interface SerieBrief {
  id: string;
  name: string;
  logo?: string;
}

/** Full series from GET /v2/en/series/{id} */
export interface Serie extends SerieBrief {
  releaseDate: string;
  sets: SetBrief[];
}

/** Brief set from series detail */
export interface SetBrief {
  id: string;
  name: string;
  logo: string;
  symbol: string;
  cardCount: {
    official: number;
    total: number;
  };
}

/** Full set from GET /v2/en/sets/{id} */
export interface Set extends SetBrief {
  releaseDate: string;
  tcgOnline?: string;
  serie: { id: string; name: string };
  legal: { standard: boolean; expanded: boolean };
  cards: CardBrief[];
  cardCount: {
    firstEd: number;
    holo: number;
    normal: number;
    official: number;
    reverse: number;
    total: number;
  };
}

/** Brief card from set detail */
export interface CardBrief {
  id: string;
  localId: string;
  name: string;
  image: string;
}

/** Full card from GET /v2/en/cards/{id} */
export interface Card {
  id: string;
  localId: string;
  name: string;
  image: string;
  category: "Pokemon" | "Trainer" | "Energy";
  illustrator?: string;
  rarity: string;
  set: {
    id: string;
    name: string;
    logo: string;
    symbol?: string;
    cardCount: { official: number; total: number };
  };
  variants: {
    firstEdition: boolean;
    holo: boolean;
    normal: boolean;
    reverse: boolean;
    wPromo: boolean;
  };
  regulationMark?: string;
  legal: { standard: boolean; expanded: boolean };
  updated: string;

  // Pokemon-specific
  hp?: number;
  types?: string[];
  stage?: string;
  suffix?: string;
  evolveFrom?: string;
  description?: string;
  level?: string;
  dexId?: number[];
  retreat?: number;
  attacks?: {
    cost: string[];
    name: string;
    effect?: string;
    damage?: number | string;
  }[];
  abilities?: {
    type: string;
    name: string;
    effect: string;
  }[];
  weaknesses?: { type: string; value: string }[];
  resistances?: { type: string; value: string }[];

  // Trainer-specific
  effect?: string;
  trainerType?: string;

  // Energy-specific
  energyType?: string;
}
