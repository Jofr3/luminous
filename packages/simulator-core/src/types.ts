import type { EffectAction, SpecialCondition } from "@luminous/engine";

export type Phase = "idle" | "setup" | "playing";
export type Zone = "hand" | "active" | "bench" | "prize";
export type PlayerIndex = 0 | 1;

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
  local_id?: string;
  name: string;
  image: string | null;
  category: string;
  rarity?: string | null;
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
  set_name?: string | null;
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
  playedByPlayer: PlayerIndex;
}

export interface PendingDeckSearch {
  actorIdx: PlayerIndex;
  opponentIdx: PlayerIndex;
  playerIdx: PlayerIndex;
  count: number;
  minCount: number;
  destination: "hand" | "bench";
  candidateUids: string[];
  selectedUids: string[];
  title: string;
  instruction: string;
  remainingEffects: EffectAction[];
}

export interface PendingHandSelection {
  actorIdx: PlayerIndex;
  opponentIdx: PlayerIndex;
  playerIdx: PlayerIndex;
  count: number;
  minCount: number;
  candidateUids: string[];
  selectedUids: string[];
  title: string;
  instruction: string;
  remainingEffects: EffectAction[];
}

export interface PendingOpponentSwitch {
  actorIdx: PlayerIndex;
  opponentIdx: PlayerIndex;
  remainingEffects: EffectAction[];
}

export interface PendingSelfSwitch {
  actorIdx: PlayerIndex;
  opponentIdx: PlayerIndex;
  remainingEffects: EffectAction[];
}

export interface PendingRareCandy {
  actorIdx: PlayerIndex;
  remainingEffects: EffectAction[];
}

export interface PendingEvolveFromDeck {
  actorIdx: PlayerIndex;
  opponentIdx: PlayerIndex;
  candidateUids: string[];
  selectedUids: string[];
  count: number;
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
  remainingEffects: EffectAction[];
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
}

export interface SimulatorStore {
  phase: Phase;
  winner: number | null;
  coinFlipResult: "Heads" | "Tails" | null;
  deckInput1: string;
  deckInput2: string;
  loading: boolean;
  firstPlayer: PlayerIndex;
  currentTurn: PlayerIndex;
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
  pendingOpponentSwitch: PendingOpponentSwitch | null;
  pendingSelfSwitch: PendingSelfSwitch | null;
  pendingRareCandy: PendingRareCandy | null;
  pendingEvolveFromDeck: PendingEvolveFromDeck | null;
  stadiumUsedThisTurn: [boolean, boolean];
  gameStarted: boolean;
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

export interface SimulatorRules {
  currentPlayer: PlayerIndex;
  locked: boolean;
  endTurn: RuleStatus;
  stadiumAbility: RuleStatus;
  attacks: AttackRule[];
  abilities: AbilityRule[];
  retreatTargets: Record<string, RuleStatus>;
  hand: Record<string, HandCardRules>;
}

export interface DragPayload {
  playerIdx: PlayerIndex;
  zone: Zone;
  uid: string;
}

export type SimulatorAction =
  | { type: "selectPrize"; playerIdx: PlayerIndex; uid: string }
  | { type: "selectHandCard"; playerIdx: PlayerIndex; uid: string }
  | { type: "deselectHandCard"; playerIdx: PlayerIndex }
  | { type: "dropToActive"; payload: DragPayload; targetPlayerIdx: PlayerIndex }
  | { type: "dropToBench"; payload: DragPayload; targetPlayerIdx: PlayerIndex }
  | { type: "dropToBenchSlot"; payload: DragPayload; targetPlayerIdx: PlayerIndex; benchIdx: number }
  | { type: "dropToDiscard"; payload: DragPayload; targetPlayerIdx: PlayerIndex }
  | { type: "dropToHand"; payload: DragPayload; targetPlayerIdx: PlayerIndex }
  | { type: "dropToStadium"; payload: DragPayload }
  | { type: "useAttack"; attackIdx: number }
  | { type: "useAbility"; pokemonUid: string; abilityIdx: number }
  | { type: "playTrainerCard"; uid: string }
  | { type: "toggleHandSelectionCard"; uid: string }
  | { type: "confirmHandSelection" }
  | { type: "toggleDeckSearchCard"; uid: string }
  | { type: "confirmDeckSearch" }
  | { type: "cancelDeckSearch" }
  | { type: "confirmOpponentSwitch"; benchUid: string }
  | { type: "cancelOpponentSwitch" }
  | { type: "confirmSelfSwitch"; benchUid: string }
  | { type: "cancelSelfSwitch" }
  | { type: "cancelRareCandy" }
  | { type: "toggleEvolveFromDeckCard"; uid: string }
  | { type: "confirmEvolveFromDeck" }
  | { type: "cancelEvolveFromDeck" }
  | { type: "useStadiumAbility" }
  | { type: "dropToTrainerUse"; payload: DragPayload }
  | { type: "retreat"; benchUid: string }
  | { type: "endTurn" };
