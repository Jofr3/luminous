import type { AttackContext, DamageResult, EnergyType, PokemonInPlay, TypeModifier } from "./types";
import { parseEffectText } from "./parser";

export function getAttackerTypes(attacker: PokemonInPlay): EnergyType[] {
  return attacker.base.card.types;
}

export function findWeakness(defender: PokemonInPlay, attackerTypes: EnergyType[]): TypeModifier | null {
  for (const weakness of defender.base.card.weaknesses) {
    if (attackerTypes.includes(weakness.type as EnergyType)) {
      return weakness;
    }
  }
  return null;
}

export function findResistance(defender: PokemonInPlay, attackerTypes: EnergyType[]): TypeModifier | null {
  for (const resistance of defender.base.card.resistances) {
    if (attackerTypes.includes(resistance.type as EnergyType)) {
      return resistance;
    }
  }
  return null;
}

export function parseModifierValue(value: string): { operation: "multiply" | "add"; amount: number } {
  const trimmed = value.replace(/\s/g, "");
  // "x2", "×2"
  const multiplyMatch = trimmed.match(/^[x×](\d+)$/i);
  if (multiplyMatch) {
    return { operation: "multiply", amount: parseInt(multiplyMatch[1], 10) };
  }
  // "+30", "+20"
  const addMatch = trimmed.match(/^\+(\d+)$/);
  if (addMatch) {
    return { operation: "add", amount: parseInt(addMatch[1], 10) };
  }
  // "-30", "-20"
  const subMatch = trimmed.match(/^-(\d+)$/);
  if (subMatch) {
    return { operation: "add", amount: -parseInt(subMatch[1], 10) };
  }
  // Default modern rules: weakness x2
  return { operation: "multiply", amount: 2 };
}

export function calculateDamage(ctx: AttackContext): DamageResult {
  const steps: string[] = [];
  const baseDamage = ctx.attack.damageBase;
  steps.push(`Base damage: ${baseDamage}`);

  // Step 2: Attacker-side modifiers (abilities, tools, stadiums etc.)
  // For now, no modifiers applied — will be extended by ability/trainer system
  const afterAttackerMods = baseDamage;
  steps.push(`After attacker mods: ${afterAttackerMods}`);

  // Step 3: Weakness
  const attackerTypes = getAttackerTypes(ctx.attacker);
  const weakness = findWeakness(ctx.defender, attackerTypes);
  let afterWeakness = afterAttackerMods;
  if (weakness && afterAttackerMods > 0) {
    const mod = parseModifierValue(weakness.value);
    if (mod.operation === "multiply") {
      afterWeakness = afterAttackerMods * mod.amount;
      steps.push(`Weakness (${weakness.type} ${weakness.value}): ${afterAttackerMods} → ${afterWeakness}`);
    } else {
      afterWeakness = afterAttackerMods + mod.amount;
      steps.push(`Weakness (${weakness.type} ${weakness.value}): ${afterAttackerMods} → ${afterWeakness}`);
    }
  }

  // Step 4: Resistance (skipped if attack has ignore_resistance effect)
  const effects = parseEffectText(ctx.attack.effect);
  const ignoresResistance = effects.some((e) => e.type === "ignore_resistance");
  const resistance = ignoresResistance ? null : findResistance(ctx.defender, attackerTypes);
  let afterResistance = afterWeakness;
  if (resistance && afterWeakness > 0) {
    const mod = parseModifierValue(resistance.value);
    if (mod.operation === "add") {
      afterResistance = afterWeakness + mod.amount;
      steps.push(`Resistance (${resistance.type} ${resistance.value}): ${afterWeakness} → ${afterResistance}`);
    }
  }
  if (ignoresResistance) {
    steps.push("Resistance ignored by attack effect.");
  }

  // Step 5: Defender-side modifiers (abilities, tools, stadiums etc.)
  // For now, no modifiers applied — will be extended by ability/trainer system
  const afterDefenderMods = afterResistance;
  steps.push(`After defender mods: ${afterDefenderMods}`);

  // Step 6: Floor at 0
  const finalDamage = Math.max(0, afterDefenderMods);
  if (finalDamage !== afterDefenderMods) {
    steps.push(`Floored to 0 (was ${afterDefenderMods})`);
  }
  steps.push(`Final damage: ${finalDamage}`);

  return {
    baseDamage,
    afterAttackerMods,
    afterWeakness,
    afterResistance,
    afterDefenderMods,
    finalDamage,
    steps,
  };
}

export function applyDamage(pokemon: PokemonInPlay, damage: number): boolean {
  pokemon.damage += damage;
  const hp = pokemon.base.card.hp ?? 0;
  return pokemon.damage >= hp;
}

export function isKnockedOut(pokemon: PokemonInPlay): boolean {
  const hp = pokemon.base.card.hp ?? 0;
  return pokemon.damage >= hp;
}

export function remainingHp(pokemon: PokemonInPlay): number {
  const hp = pokemon.base.card.hp ?? 0;
  return Math.max(0, hp - pokemon.damage);
}
