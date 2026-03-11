import type { CardSummary, CardAttack as FrontendAttack, CardAbility as FrontendAbility, CardTypeModifier } from "~/lib/types";
import type { CardInstance, PokemonInPlay, PlayerBoard } from "./types";
import type {
  CardData,
  CardAttack,
  CardAbility,
  TypeModifier,
  EnergyType,
  CardInstance as EngineCardInstance,
  PokemonInPlay as EnginePokemon,
  PlayerBoard as EngineBoard,
} from "@luminous/engine";
import { parseDamage } from "@luminous/engine";

function toEngineAttack(a: FrontendAttack): CardAttack {
  const dmg = parseDamage(a.damage);
  return {
    name: a.name ?? "Unknown",
    cost: (a.cost ?? []) as EnergyType[],
    damageBase: dmg.base,
    damageMod: dmg.mod,
    damageRaw: dmg.raw,
    effect: a.effect ?? null,
  };
}

function toEngineAbility(a: FrontendAbility): CardAbility {
  return { type: a.type, name: a.name, effect: a.effect };
}

function toEngineModifier(m: CardTypeModifier): TypeModifier {
  return { type: m.type as EnergyType, value: m.value };
}

export function toEngineCardData(card: CardSummary): CardData {
  return {
    id: card.id,
    name: card.name,
    category: card.category as CardData["category"],
    hp: card.hp ?? null,
    types: (card.types ?? []) as EnergyType[],
    stage: (card.stage as CardData["stage"]) ?? null,
    suffix: card.suffix ?? null,
    evolveFrom: null,
    retreat: card.retreat ?? null,
    attacks: (card.attacks ?? []).map(toEngineAttack),
    abilities: (card.abilities ?? []).map(toEngineAbility),
    weaknesses: (card.weaknesses ?? []).map(toEngineModifier),
    resistances: (card.resistances ?? []).map(toEngineModifier),
    effect: card.effect ?? null,
    trainerType: (card.trainer_type as CardData["trainerType"]) ?? null,
    energyType: card.energy_type ?? null,
    image: card.image,
    setId: card.set_id,
  };
}

export function toEngineCardInstance(inst: CardInstance): EngineCardInstance {
  return { uid: inst.uid, card: toEngineCardData(inst.card) };
}

export function toEnginePokemon(p: PokemonInPlay): EnginePokemon {
  return {
    uid: p.uid,
    base: toEngineCardInstance(p.base),
    damage: p.damage,
    attached: p.attached.map(toEngineCardInstance),
    specialConditions: [...p.specialConditions],
    poisonDamage: p.poisonDamage,
    burnDamage: p.burnDamage,
    turnPlayedOrEvolved: p.turnPlayedOrEvolved,
    usedAbilityThisTurn: p.usedAbilityThisTurn,
    usedGxAttack: false,
    usedVstarPower: false,
  };
}

export function toEngineBoard(board: PlayerBoard): EngineBoard {
  return {
    deck: board.deck.map(toEngineCardInstance),
    hand: board.hand.map(toEngineCardInstance),
    prizes: board.prizes.map(toEngineCardInstance),
    discard: board.discard.map(toEngineCardInstance),
    active: board.active ? toEnginePokemon(board.active) : null,
    bench: board.bench.map(toEnginePokemon),
    takenPrizes: board.takenPrizes,
    mulligans: board.mulligans,
    energyAttachedThisTurn: board.energyAttachedThisTurn,
    supporterPlayedThisTurn: board.supporterPlayedThisTurn,
    retreatedThisTurn: board.retreatedThisTurn,
  };
}

/** Sync damage/conditions back from engine pokemon to simulator pokemon */
export function syncFromEnginePokemon(target: PokemonInPlay, source: EnginePokemon): void {
  target.damage = source.damage;
  target.specialConditions = [...source.specialConditions];
  target.poisonDamage = source.poisonDamage;
  target.burnDamage = source.burnDamage;
  target.usedAbilityThisTurn = source.usedAbilityThisTurn;
}
