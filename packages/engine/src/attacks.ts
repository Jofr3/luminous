import { calculateDamage, applyDamage, isKnockedOut } from "./damage";
import { canPayAttackCost } from "./energy";
import { canAttack, confusionCheck } from "./conditions";
import { parseEffectText } from "./parser";
import type { AttackContext, AttackResult, CardAttack, PokemonInPlay } from "./types";

export function validateAttack(
  attacker: PokemonInPlay,
  attack: CardAttack,
): { valid: boolean; reason?: string } {
  // Check special conditions
  const conditionCheck = canAttack(attacker);
  if (!conditionCheck.allowed) {
    return { valid: false, reason: conditionCheck.reason };
  }

  // Check energy
  if (!canPayAttackCost(attacker, attack)) {
    return { valid: false, reason: `${attacker.base.card.name} does not have enough energy for ${attack.name}.` };
  }

  return { valid: true };
}

export function resolveAttack(ctx: AttackContext): AttackResult {
  const logs: string[] = [];
  let selfDamage = 0;

  logs.push(`${ctx.attacker.base.card.name} uses ${ctx.attack.name}!`);

  // Confusion check
  const confusion = confusionCheck(ctx.attacker);
  if (confusion.log) logs.push(confusion.log);
  if (!confusion.canAttack) {
    selfDamage = confusion.selfDamage;
    applyDamage(ctx.attacker, selfDamage);
    return {
      damage: {
        baseDamage: 0, afterAttackerMods: 0, afterWeakness: 0,
        afterResistance: 0, afterDefenderMods: 0, finalDamage: 0, steps: [],
      },
      defenderKnockedOut: false,
      selfDamage,
      effects: [],
      logs,
    };
  }

  // Calculate damage
  const damage = calculateDamage(ctx);
  logs.push(...damage.steps.map((s) => `  ${s}`));

  // Apply damage to defender
  if (damage.finalDamage > 0) {
    applyDamage(ctx.defender, damage.finalDamage);
    logs.push(`${ctx.defender.base.card.name} takes ${damage.finalDamage} damage. (${ctx.defender.damage}/${ctx.defender.base.card.hp ?? 0})`);
  }

  // Parse and collect effects
  const effects = parseEffectText(ctx.attack.effect);

  // Apply self-damage effects
  for (const effect of effects) {
    if (effect.type === "damage" && effect.target === "self") {
      selfDamage += effect.amount;
      applyDamage(ctx.attacker, effect.amount);
      logs.push(`${ctx.attacker.base.card.name} does ${effect.amount} damage to itself.`);
    }
  }

  // Check KO
  const defenderKnockedOut = isKnockedOut(ctx.defender);
  if (defenderKnockedOut) {
    logs.push(`${ctx.defender.base.card.name} is Knocked Out!`);
  }

  return {
    damage,
    defenderKnockedOut,
    selfDamage,
    effects,
    logs,
  };
}

/** Get prize cards to take when knocking out a Pokemon */
export function prizesToTake(pokemon: PokemonInPlay): number {
  const suffix = pokemon.base.card.suffix;
  const stage = pokemon.base.card.stage;

  // 3 prizes: VMAX, TAG TEAM-GX, V-UNION
  if (stage === "VMAX" || stage === "V-UNION" || suffix === "TAG TEAM-GX") {
    return 3;
  }

  // 2 prizes: EX, GX, V, VSTAR, MEGA, BREAK (ex lowercase handled by suffix check)
  if (suffix === "EX" || suffix === "GX" || suffix === "V" || stage === "VSTAR" || stage === "MEGA") {
    return 2;
  }

  // Pokemon-ex (lowercase, modern) — check name suffix
  if (pokemon.base.card.name.endsWith(" ex")) {
    return 2;
  }

  return 1;
}
