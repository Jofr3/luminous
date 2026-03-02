# Attacking and Damage

## Attack Basics

Every attack has:
- **Cost** - The Energy types and amounts required (shown as Energy symbols).
- **Name** - The attack's name.
- **Damage** (optional) - A number to the right of the attack name indicating base damage.
- **Effect text** (optional) - Additional instructions for the attack.

A Pokemon may have multiple attacks. The player chooses which attack to use. Only the Active Pokemon can attack.

An attack with a cost of 0 (or no Energy symbols) can be used without any Energy attached.

## Full Attack Sequence

When performing a complex attack, follow these steps in order:

### A. Choose the Attack
Verify sufficient Energy is attached to the Active Pokemon. Announce which attack you are using.

### B. Check for Attack-Altering Effects
Apply any effects that might alter or cancel the attack (e.g., effects from the opponent's previous turn that say "if the Defending Pokemon tries to attack..."). If the Active Pokemon has changed since the effect was applied, the effect no longer applies.

### C. Check Confusion
If the Active Pokemon is Confused, flip a coin:
- **Heads:** The attack works normally.
- **Tails:** The attack does not happen, and the Confused Pokemon takes 3 damage counters (30 damage) instead.

### D. Make Choices
Make any choices the attack requires (e.g., "Choose 1 of your opponent's Benched Pokemon").

### E. Perform Required Actions
Do anything the attack requires (e.g., flip coins, discard Energy, etc.). If an attack says "if tails, this attack does nothing," the coin flip happens here.

### F. Apply Effects and Damage
Apply effects that happen before damage, then place damage counters, then apply all other effects.

## Damage Calculation

When multiple effects modify damage, apply them in this order:

1. **Base damage** - The number printed to the right of the attack name. If `x`, `-`, or `+` is printed next to it, the attack text explains how to calculate it.

2. **Attacker-side modifiers** - Effects on the Attacking Pokemon from Trainer cards, Abilities, or previous attacks (e.g., "During your next turn, this Pokemon's attacks do 40 more damage before applying Weakness and Resistance").
   - If the base damage is 0 (or the attack does no damage at all), stop here.

3. **Weakness** - If the opponent's Active Pokemon has Weakness to the Attacking Pokemon's type, increase the damage. In modern sets (Scarlet & Violet era), Weakness doubles the damage (x2).

4. **Resistance** - If the opponent's Active Pokemon has Resistance to the Attacking Pokemon's type, reduce the damage. In the Scarlet & Violet era, Resistance reduces damage by 30 (-30).

5. **Defender-side modifiers** - Effects on the Defending Pokemon from Abilities, Trainer cards, or Energy cards (e.g., "This Pokemon takes 20 less damage from attacks after applying Weakness and Resistance").

6. **Place damage counters** - For each 10 damage of the final result, place 1 damage counter on the affected Pokemon. If the final damage is 0 or less, place no damage counters.

## Important Damage Rules

- **Damage counters vs. damage from attacks:** If an attack says to "put damage counters" on a Pokemon, this is NOT modified by Weakness, Resistance, or any other effects. Just place the specified counters directly.
- **Benched Pokemon:** Do NOT apply Weakness or Resistance to Benched Pokemon that are targeted by attacks. Just apply the base damage and any modifiers specified.
- **Damage counters stay:** Damage counters remain on a Pokemon even when it retreats, evolves, or moves to the Bench. They are only removed by healing effects or when the Pokemon is Knocked Out.
- **1 damage counter = 10 damage.** Although 50-damage and 100-damage counters exist for convenience, a "damage counter" always means 10 damage.

## Knock Out

A Pokemon is Knocked Out when its total accumulated damage (from damage counters) is equal to or greater than its HP. For example, 5 or more damage counters (50+ damage) on a Pokemon with 50 HP means it is Knocked Out.

When a Pokemon is Knocked Out:
1. The Pokemon and all attached cards go to its owner's discard pile.
2. The opponent takes Prize card(s) (1 for most Pokemon; 2 for Pokemon ex, EX, GX, V, VSTAR; 3 for VMAX, TAG TEAM, Mega Evolution ex).
3. The player whose Pokemon was Knocked Out chooses a Benched Pokemon to become the new Active Pokemon.
4. If the player has no Benched Pokemon to replace their Active, their opponent wins.
