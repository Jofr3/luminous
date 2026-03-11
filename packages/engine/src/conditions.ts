import type { PokemonInPlay, SpecialCondition } from "./types";

/** Apply between-turns Pokemon Checkup for special conditions */
export function applyPokemonCheckup(pokemon: PokemonInPlay): string[] {
  const logs: string[] = [];

  if (pokemon.specialConditions.length === 0) return logs;

  // Poisoned: apply poison damage
  if (pokemon.specialConditions.includes("Poisoned")) {
    const poisonDmg = pokemon.poisonDamage || 10;
    pokemon.damage += poisonDmg;
    logs.push(`${pokemon.base.card.name} takes ${poisonDmg} poison damage.`);
  }

  // Burned: flip coin, if tails apply burn damage
  if (pokemon.specialConditions.includes("Burned")) {
    const heads = Math.random() < 0.5;
    if (heads) {
      logs.push(`${pokemon.base.card.name} burn check: Heads! No burn damage.`);
    } else {
      const burnDmg = pokemon.burnDamage || 20;
      pokemon.damage += burnDmg;
      logs.push(`${pokemon.base.card.name} burn check: Tails! Takes ${burnDmg} burn damage.`);
    }
  }

  // Asleep: flip coin, if heads wake up
  if (pokemon.specialConditions.includes("Asleep")) {
    const heads = Math.random() < 0.5;
    if (heads) {
      pokemon.specialConditions = pokemon.specialConditions.filter((c) => c !== "Asleep");
      logs.push(`${pokemon.base.card.name} sleep check: Heads! Wakes up.`);
    } else {
      logs.push(`${pokemon.base.card.name} sleep check: Tails! Still Asleep.`);
    }
  }

  // Paralyzed: removed between turns (after the opponent's turn)
  // This is handled by the turn system, not here.

  return logs;
}

/** Apply a special condition to a Pokemon */
export function applySpecialCondition(pokemon: PokemonInPlay, condition: SpecialCondition): string {
  // Asleep, Confused, and Paralyzed are mutually exclusive
  const mutuallyExclusive: SpecialCondition[] = ["Asleep", "Confused", "Paralyzed"];

  if (mutuallyExclusive.includes(condition)) {
    // Remove any existing mutually exclusive condition
    pokemon.specialConditions = pokemon.specialConditions.filter(
      (c) => !mutuallyExclusive.includes(c)
    );
  }

  // Poisoned and Burned can stack with each other and the above
  if (!pokemon.specialConditions.includes(condition)) {
    pokemon.specialConditions.push(condition);
  }

  if (condition === "Poisoned") {
    pokemon.poisonDamage = 10; // standard, Toxic overrides to 20
  }
  if (condition === "Burned") {
    pokemon.burnDamage = 20;
  }

  return `${pokemon.base.card.name} is now ${condition}.`;
}

/** Remove a special condition */
export function removeSpecialCondition(pokemon: PokemonInPlay, condition: SpecialCondition): void {
  pokemon.specialConditions = pokemon.specialConditions.filter((c) => c !== condition);
}

/** Remove all special conditions (e.g., when retreating or evolving) */
export function clearSpecialConditions(pokemon: PokemonInPlay): void {
  pokemon.specialConditions = [];
  pokemon.poisonDamage = 10;
  pokemon.burnDamage = 20;
}

/** Check if a Pokemon can attack (not Asleep or Paralyzed) */
export function canAttack(pokemon: PokemonInPlay): { allowed: boolean; reason?: string } {
  if (pokemon.specialConditions.includes("Asleep")) {
    return { allowed: false, reason: `${pokemon.base.card.name} is Asleep and cannot attack.` };
  }
  if (pokemon.specialConditions.includes("Paralyzed")) {
    return { allowed: false, reason: `${pokemon.base.card.name} is Paralyzed and cannot attack.` };
  }
  return { allowed: true };
}

/** Check if a Pokemon can retreat (not Asleep or Paralyzed) */
export function canRetreatCondition(pokemon: PokemonInPlay): { allowed: boolean; reason?: string } {
  if (pokemon.specialConditions.includes("Asleep")) {
    return { allowed: false, reason: `${pokemon.base.card.name} is Asleep and cannot retreat.` };
  }
  if (pokemon.specialConditions.includes("Paralyzed")) {
    return { allowed: false, reason: `${pokemon.base.card.name} is Paralyzed and cannot retreat.` };
  }
  return { allowed: true };
}

/** Handle Confusion check before an attack */
export function confusionCheck(pokemon: PokemonInPlay): { canAttack: boolean; selfDamage: number; log: string } {
  if (!pokemon.specialConditions.includes("Confused")) {
    return { canAttack: true, selfDamage: 0, log: "" };
  }

  const heads = Math.random() < 0.5;
  if (heads) {
    return {
      canAttack: true,
      selfDamage: 0,
      log: `${pokemon.base.card.name} confusion check: Heads! Attack proceeds.`,
    };
  }
  return {
    canAttack: false,
    selfDamage: 30,
    log: `${pokemon.base.card.name} confusion check: Tails! Does 30 damage to itself.`,
  };
}

/** Remove Paralyzed condition at end of the affected player's turn */
export function endTurnParalysisCheck(pokemon: PokemonInPlay): string | null {
  if (pokemon.specialConditions.includes("Paralyzed")) {
    removeSpecialCondition(pokemon, "Paralyzed");
    return `${pokemon.base.card.name} is no longer Paralyzed.`;
  }
  return null;
}
