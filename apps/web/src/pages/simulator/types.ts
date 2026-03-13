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

export interface PendingDeckSearch {
  actorIdx: 0 | 1;
  opponentIdx: 0 | 1;
  playerIdx: 0 | 1;
  count: number;
  minCount: number;
  destination: "hand" | "bench";
  candidateUids: string[];
  selectedUids: string[];
  title: string;
  instruction: string;
  remainingEffects: import("@luminous/engine").EffectAction[];
}

export interface PendingHandSelection {
  actorIdx: 0 | 1;
  opponentIdx: 0 | 1;
  playerIdx: 0 | 1;
  count: number;
  minCount: number;
  candidateUids: string[];
  selectedUids: string[];
  title: string;
  instruction: string;
  remainingEffects: import("@luminous/engine").EffectAction[];
}

export interface PendingDiscardSelection {
  actorIdx: 0 | 1;
  opponentIdx: 0 | 1;
  playerIdx: 0 | 1;
  count: number;
  minCount: number;
  destination: "hand" | "deck";
  candidateUids: string[];
  selectedUids: string[];
  title: string;
  instruction: string;
  remainingEffects: import("@luminous/engine").EffectAction[];
}

export interface PendingOpponentSwitch {
  actorIdx: 0 | 1;
  opponentIdx: 0 | 1;
  remainingEffects: import("@luminous/engine").EffectAction[];
}

export interface PendingSelfSwitch {
  actorIdx: 0 | 1;
  opponentIdx: 0 | 1;
  remainingEffects: import("@luminous/engine").EffectAction[];
}

export interface PendingRareCandy {
  actorIdx: 0 | 1;
  remainingEffects: import("@luminous/engine").EffectAction[];
}

export interface PendingEvolveFromDeck {
  actorIdx: 0 | 1;
  opponentIdx: 0 | 1;
  /** UIDs of valid evolution cards found in the deck */
  candidateUids: string[];
  selectedUids: string[];
  /** How many evolutions total (e.g. 2 for Breeder's Nurturing) */
  count: number;
  /** How many evolutions completed so far */
  evolved: number;
  bypassFirstTurn: boolean;
  bypassSameTurn: boolean;
  endsTurn: boolean;
  excludeSuffix?: string;
  requireSuffix?: string;
  requireNoAbilities?: boolean;
  allowedNames?: string[];
  title: string;
  instruction: string;
  remainingEffects: import("@luminous/engine").EffectAction[];
}

export interface DragPayload {
  playerIdx: 0 | 1;
  zone: Zone;
  uid: string;
}

export interface ActiveEffect {
  type: "item_lock" | "cant_attack" | "cant_retreat" | "prevent_damage" | "damage_reduction";
  turnsRemaining: number;
  amount?: number;
  targetPokemonUid?: string;
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
  trainerUseZone: CardInstance[];
  energyAttachedThisTurn: boolean;
  supporterPlayedThisTurn: boolean;
  retreatedThisTurn: boolean;
  activeEffects: ActiveEffect[];
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
  deselectHandCard: (playerIdx: 0 | 1) => Promise<void>;
  useAttack: (attackIdx: number) => Promise<void>;
  useAbility: (pokemonUid: string, abilityIdx: number) => Promise<void>;
  playTrainerCard: (uid: string) => Promise<void>;
  toggleHandSelectionCard: (uid: string) => Promise<void>;
  confirmHandSelection: () => Promise<void>;
  toggleDiscardSelectionCard: (uid: string) => Promise<void>;
  confirmDiscardSelection: () => Promise<void>;
  cancelDiscardSelection: () => Promise<void>;
  toggleDeckSearchCard: (uid: string) => Promise<void>;
  confirmDeckSearch: () => Promise<void>;
  cancelDeckSearch: () => Promise<void>;
  confirmOpponentSwitch: (benchUid: string) => Promise<void>;
  cancelOpponentSwitch: () => Promise<void>;
  confirmSelfSwitch: (benchUid: string) => Promise<void>;
  cancelSelfSwitch: () => Promise<void>;
  cancelRareCandy: () => Promise<void>;
  toggleEvolveFromDeckCard: (uid: string) => Promise<void>;
  confirmEvolveFromDeck: () => Promise<void>;
  cancelEvolveFromDeck: () => Promise<void>;
  useStadiumAbility: () => Promise<void>;
  dropToTrainerUse: (payload: DragPayload) => Promise<void>;
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
  pendingHandSelection: PendingHandSelection | null;
  pendingDeckSearch: PendingDeckSearch | null;
  pendingDiscardSelection: PendingDiscardSelection | null;
  pendingOpponentSwitch: PendingOpponentSwitch | null;
  pendingSelfSwitch: PendingSelfSwitch | null;
  pendingRareCandy: PendingRareCandy | null;
  pendingEvolveFromDeck: PendingEvolveFromDeck | null;
  stadiumUsedThisTurn: [boolean, boolean];
  gameStarted: boolean;
}
