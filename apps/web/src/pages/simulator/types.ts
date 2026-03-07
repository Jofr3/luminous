import type { CardDetail, CardSummary } from "~/lib/types";

export type Phase = "idle" | "setup" | "playing";
export type Zone = "hand" | "active" | "bench" | "prize";

export interface DeckLine {
  qty: number;
  query: string;
}

export interface CardInstance {
  uid: string;
  card: CardSummary;
}

export interface PokemonInPlay {
  uid: string;
  base: CardInstance;
  damage: number;
  attached: CardInstance[];
}

export interface DragPayload {
  playerIdx: 0 | 1;
  zone: Zone;
  uid: string;
}

export interface PlayerBoard {
  name: string;
  deck: CardInstance[];
  hand: CardInstance[];
  prizes: CardInstance[];
  discard: CardInstance[];
  active: PokemonInPlay | null;
  bench: PokemonInPlay[];
  takenPrizes: number;
  mulligans: number;
  energyAttachedThisTurn: boolean;
}

export interface SimulatorStore {
  phase: Phase;
  winner: string | null;
  coinFlipResult: "Heads" | "Tails" | null;
  deckInput1: string;
  deckInput2: string;
  loading: boolean;
  firstPlayer: 0 | 1;
  currentTurn: 0 | 1;
  turnNumber: number;
  turnDrawDone: boolean;
  selectedHandUid: [string | null, string | null];
  selectedPrizeUid: [string | null, string | null];
  selectedAttackIndex: [number, number];
  revealedPrizeUids: [string[], string[]];
  detailCache: Record<string, CardDetail>;
  nameQueryCache: Record<string, CardSummary | null>;
  logs: string[];
  players: [PlayerBoard, PlayerBoard];
  showDecklists: boolean;
  showGameLog: boolean;
}
