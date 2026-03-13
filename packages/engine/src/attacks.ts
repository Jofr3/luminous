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

  // Parse effects early to check for coin flip that blocks the whole attack
  const effects = parseEffectText(ctx.attack.effect);

  // Handle "Flip a coin. If tails, this attack does nothing." — must resolve before damage
  const doesNothingFlip = effects.find(
    (e) => e.type === "coin_flip" && e.onTails.length === 1 && e.onTails[0].type === "custom"
      && e.onTails[0].description.toLowerCase().includes("does nothing"),
  );
  if (doesNothingFlip) {
    const flipResult = Math.random() < 0.5 ? "Heads" : "Tails";
    logs.push(`Coin flip: ${flipResult}.`);
    if (flipResult === "Tails") {
      logs.push("This attack does nothing.");
      return {
        damage: {
          baseDamage: 0, afterAttackerMods: 0, afterWeakness: 0,
          afterResistance: 0, afterDefenderMods: 0, finalDamage: 0, steps: [],
        },
        defenderKnockedOut: false,
        selfDamage: 0,
        effects: [],
        logs,
      };
    }
    // Remove the coin flip from effects so it's not processed again
    effects.splice(effects.indexOf(doesNothingFlip), 1);
  }

  // Handle "coin flip extra damage" — resolve before damage calc to modify the base
  const extraDmgFlip = effects.find(
    (e) => e.type === "coin_flip" && e.onHeads.length === 1 && e.onHeads[0].type === "damage" && e.onHeads[0].target === "defender",
  );
  if (extraDmgFlip && extraDmgFlip.type === "coin_flip") {
    const flipResult = Math.random() < 0.5 ? "Heads" : "Tails";
    logs.push(`Coin flip: ${flipResult}.`);
    if (flipResult === "Heads") {
      const extraDmg = extraDmgFlip.onHeads[0];
      if (extraDmg.type === "damage") {
        ctx.attack = { ...ctx.attack, damageBase: ctx.attack.damageBase + extraDmg.amount };
        logs.push(`Attack does ${extraDmg.amount} more damage!`);
      }
    }
    effects.splice(effects.indexOf(extraDmgFlip), 1);
  }

  // Handle multi-coin flip damage attacks (e.g., "Flip 2 coins. 20 damage × heads")
  // These attacks use damageMod "x" — the base damage is multiplied by coin results
  const multiCoinFlip = effects.find((e) => e.type === "multi_coin_flip");
  if (multiCoinFlip && multiCoinFlip.type === "multi_coin_flip") {
    let heads = 0;
    for (let i = 0; i < multiCoinFlip.coins; i += 1) {
      const flip = Math.random() < 0.5 ? "Heads" : "Tails";
      if (flip === "Heads") heads += 1;
    }
    logs.push(`Flipped ${multiCoinFlip.coins} coins: ${heads} Heads, ${multiCoinFlip.coins - heads} Tails.`);
    // Override the damage base with the multiplied result
    const perHeadDmg = multiCoinFlip.perHeads.find((e) => e.type === "damage");
    const totalDamage = perHeadDmg ? perHeadDmg.amount * heads : ctx.attack.damageBase * heads;
    const multiCoinCtx: AttackContext = {
      ...ctx,
      attack: {
        ...ctx.attack,
        damageBase: totalDamage,
        damageMod: null,
        damageRaw: String(totalDamage),
      },
    };
    const damage = calculateDamage(multiCoinCtx);
    logs.push(...damage.steps.map((s) => `  ${s}`));
    if (damage.finalDamage > 0) {
      applyDamage(ctx.defender, damage.finalDamage);
      logs.push(`${ctx.defender.base.card.name} takes ${damage.finalDamage} damage. (${ctx.defender.damage}/${ctx.defender.base.card.hp ?? 0})`);
    } else {
      logs.push("No damage dealt (0 heads).");
    }
    // Remove from effects so it's not processed again
    effects.splice(effects.indexOf(multiCoinFlip), 1);

    const defenderKnockedOut = isKnockedOut(ctx.defender);
    if (defenderKnockedOut) {
      logs.push(`${ctx.defender.base.card.name} is Knocked Out!`);
    }

    return {
      damage: {
        ...damage,
        steps: [`Multi-coin: ${heads} heads × ${perHeadDmg?.amount ?? ctx.attack.damageBase} = ${totalDamage}`, ...damage.steps],
      },
      defenderKnockedOut,
      selfDamage: 0,
      effects: effects.filter((e) => e.type !== "damage" || e.target !== "self"),
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
