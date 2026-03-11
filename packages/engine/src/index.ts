// Types
export type {
  EnergyType, CardCategory, TrainerType, Stage, DamageMod, SpecialCondition, AbilityType,
  CardAttack, CardAbility, TypeModifier, CardData, CardInstance, PokemonInPlay, StadiumInPlay,
  PlayerBoard, GameState, DamageResult, AttackContext, AttackResult, EffectAction,
} from "./types";

// Damage calculation
export {
  calculateDamage, applyDamage, isKnockedOut, remainingHp,
  getAttackerTypes, findWeakness, findResistance, parseModifierValue,
} from "./damage";

// Energy management
export {
  getProvidedEnergy, countAttachedEnergy, canPayAttackCost, getUsableAttacks,
  totalEnergyCount, canRetreat, isEnergyCard,
} from "./energy";

// Special conditions
export {
  applyPokemonCheckup, applySpecialCondition, removeSpecialCondition,
  clearSpecialConditions, canAttack, canRetreatCondition, confusionCheck,
  endTurnParalysisCheck,
} from "./conditions";

// Parser
export { parseCardRow, parseDamage, parseEffectText } from "./parser";

// Attacks
export { validateAttack, resolveAttack, prizesToTake } from "./attacks";

// Abilities
export { canUseAbility, useAbility, getUsableAbilities, resetAbilityFlags } from "./abilities";

// Trainers
export {
  canPlayTrainer, playTrainer, attachTool, attachTechnicalMachine,
  getAttachedTool, getTechnicalMachineAttacks,
} from "./trainers";
export type { TrainerPlayResult } from "./trainers";
