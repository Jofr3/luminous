// ---------------------------------------------------------------------------
// Card data types (parsed from DB JSON)
// ---------------------------------------------------------------------------

export type EnergyType =
  | "Grass" | "Fire" | "Water" | "Lightning" | "Psychic"
  | "Fighting" | "Darkness" | "Metal" | "Fairy" | "Dragon" | "Colorless";

export type CardCategory = "Pokemon" | "Trainer" | "Energy";

export type TrainerType =
  | "Item" | "Supporter" | "Stadium" | "Tool"
  | "Technical Machine" | "Rocket's Secret Machine" | "ACE SPEC";

export type Stage =
  | "Basic" | "Stage1" | "Stage2"
  | "BREAK" | "MEGA" | "LEVEL-UP" | "RESTORED"
  | "VMAX" | "V-UNION" | "VSTAR";

export type DamageMod = "+" | "x" | "-" | null;

export type SpecialCondition = "Asleep" | "Burned" | "Confused" | "Paralyzed" | "Poisoned";

export type AbilityType = "Ability" | "Poke-Power" | "Poke-Body" | "Ancient Trait";

export interface CardAttack {
  name: string;
  cost: EnergyType[];
  damageBase: number;
  damageMod: DamageMod;
  damageRaw: string;
  effect: string | null;
}

export interface CardAbility {
  type: AbilityType | string;
  name: string;
  effect: string;
}

export interface TypeModifier {
  type: EnergyType | string;
  value: string; // "x2", "-30", etc.
}

export interface CardData {
  id: string;
  name: string;
  category: CardCategory;
  hp: number | null;
  types: EnergyType[];
  stage: Stage | null;
  suffix: string | null;
  evolveFrom: string | null;
  retreat: number | null;
  attacks: CardAttack[];
  abilities: CardAbility[];
  weaknesses: TypeModifier[];
  resistances: TypeModifier[];
  effect: string | null;
  trainerType: TrainerType | null;
  energyType: string | null;
  image: string | null;
  setId: string;
}

// ---------------------------------------------------------------------------
// Game state types
// ---------------------------------------------------------------------------

export interface CardInstance {
  uid: string;
  card: CardData;
}

export interface PokemonInPlay {
  uid: string;
  base: CardInstance;
  damage: number;
  attached: CardInstance[];
  specialConditions: SpecialCondition[];
  poisonDamage: number; // normally 10, Toxic sets to 20
  burnDamage: number;   // normally 20
  turnPlayedOrEvolved: number;
  usedAbilityThisTurn: boolean;
  usedGxAttack: boolean; // for GX Pokemon
  usedVstarPower: boolean; // for VSTAR Pokemon
}

export interface StadiumInPlay {
  card: CardInstance;
  playedByPlayer: 0 | 1;
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

export interface GameState {
  players: [PlayerBoard, PlayerBoard];
  stadium: StadiumInPlay | null;
  currentTurn: 0 | 1;
  firstPlayer: 0 | 1;
  turnNumber: number;
  phase: "setup" | "playing" | "finished";
  winner: 0 | 1 | null;
  turnDrawDone: boolean;
  logs: string[];
}

// ---------------------------------------------------------------------------
// Action result types
// ---------------------------------------------------------------------------

export interface DamageResult {
  baseDamage: number;
  afterAttackerMods: number;
  afterWeakness: number;
  afterResistance: number;
  afterDefenderMods: number;
  finalDamage: number;
  steps: string[];
}

export interface AttackContext {
  attacker: PokemonInPlay;
  defender: PokemonInPlay;
  attack: CardAttack;
  attackerBoard: PlayerBoard;
  defenderBoard: PlayerBoard;
  state: GameState;
}

export interface AttackResult {
  damage: DamageResult;
  defenderKnockedOut: boolean;
  selfDamage: number;
  effects: EffectAction[];
  logs: string[];
}

// ---------------------------------------------------------------------------
// Effect system types
// ---------------------------------------------------------------------------

export type EffectAction =
  | { type: "damage"; target: "defender" | "self" | "bench"; amount: number; pokemonUid?: string }
  | { type: "heal"; target: "self" | "bench"; amount: number; pokemonUid?: string }
  | { type: "draw"; player: "self" | "opponent"; count: number }
  | { type: "discard_energy"; target: "self" | "defender"; count: number; energyType?: EnergyType | "any" }
  | { type: "special_condition"; target: "defender" | "self"; condition: SpecialCondition }
  | { type: "coin_flip"; onHeads: EffectAction[]; onTails: EffectAction[] }
  | { type: "multi_coin_flip"; coins: number; perHeads: EffectAction[] }
  | { type: "prevent_damage"; turns: number }
  | { type: "cant_attack"; turns: number }
  | { type: "cant_retreat"; turns: number }
  | { type: "ignore_resistance" }
  | { type: "switch_pokemon"; player: "self" | "opponent" }
  | {
    type: "search_deck";
    player: "self";
    filter?: string;
    count: number;
    minCount?: number;
    destination?: "hand" | "bench";
    category?: CardCategory;
    stage?: Stage;
    trainerType?: TrainerType;
    suffix?: string;
    maxHp?: number;
  }
  | { type: "shuffle_hand_draw"; player: "self" | "opponent"; drawCount: number }
  | { type: "energy_accelerate"; source: "deck" | "discard" | "hand"; count: number; energyType?: EnergyType | "any" }
  | { type: "bounce"; target: "defender" | "self"; destination: "hand" | "deck" }
  | { type: "discard_card"; source: "hand" | "field"; count: number }
  | { type: "custom"; description: string }
  | { type: "play_condition"; condition: "opponent_prizes"; count: number; exact: boolean }
  | { type: "rare_candy" }
  | {
    type: "evolve_from_deck";
    count: number;
    bypassFirstTurn: boolean;
    bypassSameTurn: boolean;
    endsTurn: boolean;
    excludeSuffix?: string;
    requireSuffix?: string;
    requireNoAbilities?: boolean;
    allowedNames?: string[];
  }
  | { type: "end_turn" }
  | { type: "stadium_evolve_timing"; bypassSameTurn: boolean; bypassFirstTurn: boolean; typeFilter?: string }
  | {
    type: "stadium_chained_evolution";
  }
  | {
    type: "stadium_fossil_evolution";
    count: number;
    endsTurn: boolean;
  };
