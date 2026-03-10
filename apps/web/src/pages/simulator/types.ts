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

export interface SimulatorActions {
  useAttack: () => Promise<void>;
  toggleDecklists: () => Promise<void>;
  toggleGameLog: () => Promise<void>;
  setDeckInput1: (value: string) => Promise<void>;
  setDeckInput2: (value: string) => Promise<void>;
  selectPrize: (playerIdx: 0 | 1, uid: string) => Promise<void>;
  revealSelectedPrize: (playerIdx: 0 | 1) => Promise<void>;
  takeSelectedPrizeToHand: (playerIdx: 0 | 1) => Promise<void>;
  dropToActive: (payload: DragPayload, targetPlayerIdx: 0 | 1) => Promise<void>;
  dropToBench: (payload: DragPayload, targetPlayerIdx: 0 | 1) => Promise<void>;
  dropToBenchSlot: (payload: DragPayload, targetPlayerIdx: 0 | 1, benchIdx: number) => Promise<void>;
  dropToDiscard: (payload: DragPayload, targetPlayerIdx: 0 | 1) => Promise<void>;
  dropToHand: (payload: DragPayload, targetPlayerIdx: 0 | 1) => Promise<void>;
  changeDamage: (playerIdx: 0 | 1, target: "active" | number, delta: number) => Promise<void>;
  attachSelectedEnergyTo: (playerIdx: 0 | 1, target: "active" | number) => Promise<void>;
  switchWithBench: (playerIdx: 0 | 1, benchIdx: number) => Promise<void>;
  selectHandCard: (playerIdx: 0 | 1, uid: string) => Promise<void>;
  setSelectedActive: (playerIdx: 0 | 1) => Promise<void>;
  setSelectedBench: (playerIdx: 0 | 1) => Promise<void>;
  discardSelectedCard: (playerIdx: 0 | 1) => Promise<void>;
  loadCardDetail: (cardId: string) => Promise<void>;
  setAttackIndex: (playerIdx: 0 | 1, index: number) => Promise<void>;
  endTurn: () => Promise<void>;
}

export interface SimulatorStore {
  phase: Phase;
  winner: number | null;
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
