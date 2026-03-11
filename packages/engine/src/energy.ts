import type { CardAttack, CardInstance, EnergyType, PokemonInPlay } from "./types";

/** Map a card's types/energy_type to the energy it provides */
export function getProvidedEnergy(card: CardInstance): EnergyType[] {
  const data = card.card;

  // Basic energy cards provide their type
  if (data.category === "Energy" && data.energyType === "Normal" && data.types.length > 0) {
    return [data.types[0]];
  }

  // Special energy: need to parse effect text. For now, return Colorless as fallback.
  if (data.category === "Energy" && data.energyType === "Special") {
    // Double Colorless Energy and similar
    if (data.name.includes("Double") && data.name.includes("Colorless")) {
      return ["Colorless", "Colorless"];
    }
    if (data.name.includes("Triple") || data.name.includes("Triple Acceleration")) {
      return ["Colorless", "Colorless", "Colorless"];
    }
    // Default: provides 1 Colorless
    return ["Colorless"];
  }

  return [];
}

/** Count available energy on a Pokemon from its attached cards */
export function countAttachedEnergy(pokemon: PokemonInPlay): Map<EnergyType, number> {
  const counts = new Map<EnergyType, number>();

  for (const attached of pokemon.attached) {
    const provided = getProvidedEnergy(attached);
    for (const energy of provided) {
      counts.set(energy, (counts.get(energy) ?? 0) + 1);
    }
  }

  return counts;
}

/** Check if a Pokemon has enough energy to use an attack */
export function canPayAttackCost(pokemon: PokemonInPlay, attack: CardAttack): boolean {
  const available = countAttachedEnergy(pokemon);
  const cost = [...attack.cost];

  // First pass: satisfy specific (non-Colorless) requirements
  const remainingAvailable = new Map(available);
  const unmatched: EnergyType[] = [];

  for (const required of cost) {
    if (required === "Colorless") {
      unmatched.push(required);
      continue;
    }

    const count = remainingAvailable.get(required) ?? 0;
    if (count > 0) {
      remainingAvailable.set(required, count - 1);
    } else {
      // Can't satisfy this specific energy requirement
      return false;
    }
  }

  // Second pass: satisfy Colorless requirements with any remaining energy
  let totalRemaining = 0;
  for (const count of remainingAvailable.values()) {
    totalRemaining += count;
  }

  return totalRemaining >= unmatched.length;
}

/** Get attacks that a Pokemon can currently use */
export function getUsableAttacks(pokemon: PokemonInPlay): CardAttack[] {
  return pokemon.base.card.attacks.filter((attack) => canPayAttackCost(pokemon, attack));
}

/** Count total energy attached */
export function totalEnergyCount(pokemon: PokemonInPlay): number {
  let total = 0;
  for (const attached of pokemon.attached) {
    total += getProvidedEnergy(attached).length;
  }
  return total;
}

/** Check if a Pokemon can retreat (has enough energy for retreat cost) */
export function canRetreat(pokemon: PokemonInPlay): boolean {
  const retreatCost = pokemon.base.card.retreat ?? 0;
  if (retreatCost === 0) return true;
  return totalEnergyCount(pokemon) >= retreatCost;
}

/** Check if a card is an energy card */
export function isEnergyCard(card: CardInstance): boolean {
  return card.card.category === "Energy";
}
