import type { CardSummary } from "~/lib/types";
import type { SpecialCondition } from "@luminous/engine";

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
  specialConditions: SpecialCondition[];
  poisonDamage: number;
  burnDamage: number;
  turnPlayedOrEvolved: number;
  usedAbilityThisTurn: boolean;
}

export interface StadiumInPlay {
  card: CardInstance;
  playedByPlayer: 0 | 1;
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
  supporterPlayedThisTurn: boolean;
  retreatedThisTurn: boolean;
}

export interface SimulatorActions {
  selectPrize: (playerIdx: 0 | 1, uid: string) => Promise<void>;
  dropToActive: (payload: DragPayload, targetPlayerIdx: 0 | 1) => Promise<void>;
  dropToBench: (payload: DragPayload, targetPlayerIdx: 0 | 1) => Promise<void>;
  dropToBenchSlot: (payload: DragPayload, targetPlayerIdx: 0 | 1, benchIdx: number) => Promise<void>;
  dropToDiscard: (payload: DragPayload, targetPlayerIdx: 0 | 1) => Promise<void>;
  dropToHand: (payload: DragPayload, targetPlayerIdx: 0 | 1) => Promise<void>;
  dropToStadium: (payload: DragPayload) => Promise<void>;
  selectHandCard: (playerIdx: 0 | 1, uid: string) => Promise<void>;
  useAttack: (attackIdx: number) => Promise<void>;
  useAbility: (pokemonUid: string, abilityIdx: number) => Promise<void>;
  playTrainerCard: (uid: string) => Promise<void>;
  retreat: (benchUid: string) => Promise<void>;
  endTurn: () => Promise<void>;
  newGame: () => Promise<void>;
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
  revealedPrizeUids: [string[], string[]];
  nameQueryCache: Record<string, CardSummary | null>;
  logs: string[];
  players: [PlayerBoard, PlayerBoard];
  stadium: StadiumInPlay | null;
  gameStarted: boolean;
}
