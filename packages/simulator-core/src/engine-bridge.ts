import { parseDamage } from "@luminous/engine";
import type {
  CardAttack,
  CardData,
  CardInstance as EngineCardInstance,
  PlayerBoard as EngineBoard,
  PokemonInPlay as EnginePokemon,
  TypeModifier,
} from "@luminous/engine";
import type { CardInstance, CardSummary, PokemonInPlay, PlayerBoard } from "./types";

function toEngineAttack(attack: NonNullable<CardSummary["attacks"]>[number]): CardAttack {
  const damage = parseDamage(attack.damage);
  return {
    name: attack.name ?? "Unknown",
    cost: (attack.cost ?? []) as CardAttack["cost"],
    damageBase: damage.base,
    damageMod: damage.mod,
    damageRaw: damage.raw,
    effect: attack.effect ?? null,
  };
}

function toEngineModifier(modifier: NonNullable<CardSummary["weaknesses"]>[number]): TypeModifier {
  return { type: modifier.type as TypeModifier["type"], value: modifier.value };
}

export function toEngineCardData(card: CardSummary): CardData {
  return {
    id: card.id,
    name: card.name,
    category: card.category as CardData["category"],
    hp: card.hp ?? null,
    types: (card.types ?? []) as CardData["types"],
    stage: (card.stage as CardData["stage"]) ?? null,
    suffix: card.suffix ?? null,
    evolveFrom: card.evolve_from ?? null,
    retreat: card.retreat ?? null,
    attacks: (card.attacks ?? []).map(toEngineAttack),
    abilities: (card.abilities ?? []).map((ability) => ({
      type: ability.type,
      name: ability.name,
      effect: ability.effect,
    })),
    weaknesses: (card.weaknesses ?? []).map(toEngineModifier),
    resistances: (card.resistances ?? []).map(toEngineModifier),
    effect: card.effect ?? null,
    trainerType: (card.trainer_type as CardData["trainerType"]) ?? null,
    energyType: card.energy_type ?? null,
    image: card.image,
    setId: card.set_id,
  };
}

export function toEngineCardInstance(instance: CardInstance): EngineCardInstance {
  return { uid: instance.uid, card: toEngineCardData(instance.card) };
}

export function toEnginePokemon(pokemon: PokemonInPlay): EnginePokemon {
  return {
    uid: pokemon.uid,
    base: toEngineCardInstance(pokemon.base),
    damage: pokemon.damage,
    attached: pokemon.attached.map(toEngineCardInstance),
    specialConditions: [...pokemon.specialConditions],
    poisonDamage: pokemon.poisonDamage,
    burnDamage: pokemon.burnDamage,
    turnPlayedOrEvolved: pokemon.turnPlayedOrEvolved,
    usedAbilityThisTurn: pokemon.usedAbilityThisTurn,
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

export function syncFromEnginePokemon(target: PokemonInPlay, source: EnginePokemon): void {
  target.damage = source.damage;
  target.specialConditions = [...source.specialConditions];
  target.poisonDamage = source.poisonDamage;
  target.burnDamage = source.burnDamage;
  target.usedAbilityThisTurn = source.usedAbilityThisTurn;
}
