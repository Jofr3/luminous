import type { CardAbility, GameState, PlayerBoard, PokemonInPlay, EffectAction } from "./types";
import { parseEffectText } from "./parser";

export interface AbilityUseResult {
  valid: boolean;
  reason?: string;
  effects: EffectAction[];
  logs: string[];
}

function isOncePerTurnAbility(ability: CardAbility): boolean {
  return /once during (?:each )?your turn|once during each player's turn|you can't use more than 1/i.test(
    ability.effect,
  );
}

/** Check if an ability can be used */
export function canUseAbility(
  pokemon: PokemonInPlay,
  ability: CardAbility,
): { allowed: boolean; reason?: string } {
  // Abilities are blocked by special conditions on the Active Pokemon
  // (varies by ability, but general rule is they work unless explicitly blocked)

  // Poke-Powers require the Pokemon to not have any special condition (old mechanic)
  if (ability.type === "Poke-Power" && pokemon.specialConditions.length > 0) {
    return { allowed: false, reason: `${pokemon.base.card.name}'s ${ability.name} is blocked by special conditions.` };
  }

  // Check if already used this turn (for once-per-turn abilities)
  if (isOncePerTurnAbility(ability) && pokemon.usedAbilityThisTurn) {
    return { allowed: false, reason: `${pokemon.base.card.name} already used an Ability this turn.` };
  }

  return { allowed: true };
}

/** Use an ability */
export function useAbility(
  pokemon: PokemonInPlay,
  ability: CardAbility,
  _playerBoard: PlayerBoard,
  _state: GameState,
): AbilityUseResult {
  const logs: string[] = [];
  logs.push(`${pokemon.base.card.name} uses ${ability.type}: ${ability.name}.`);

  const effects = parseEffectText(ability.effect);

  // Mark as used this turn
  if (isOncePerTurnAbility(ability)) {
    pokemon.usedAbilityThisTurn = true;
  }

  return { valid: true, effects, logs };
}

/** Get all usable abilities for a player's Pokemon */
export function getUsableAbilities(
  playerBoard: PlayerBoard,
): Array<{ pokemon: PokemonInPlay; ability: CardAbility }> {
  const results: Array<{ pokemon: PokemonInPlay; ability: CardAbility }> = [];

  const allPokemon: PokemonInPlay[] = [];
  if (playerBoard.active) allPokemon.push(playerBoard.active);
  allPokemon.push(...playerBoard.bench);

  for (const pokemon of allPokemon) {
    for (const ability of pokemon.base.card.abilities) {
      const check = canUseAbility(pokemon, ability);
      if (check.allowed) {
        results.push({ pokemon, ability });
      }
    }
  }

  return results;
}

/** Reset ability usage flags at start of turn */
export function resetAbilityFlags(playerBoard: PlayerBoard): void {
  if (playerBoard.active) {
    playerBoard.active.usedAbilityThisTurn = false;
  }
  for (const pokemon of playerBoard.bench) {
    pokemon.usedAbilityThisTurn = false;
  }
}
