# Turn Structure

Each turn has 3 main parts:

## 1. Draw a Card (Mandatory)

Start your turn by drawing one card from your deck. If there are no cards in your deck at the beginning of your turn, the game is over and your opponent wins.

## 2. Perform Actions (Any Order, Optional)

You may perform any of the following actions in any order:

### A. Play Basic Pokemon to the Bench
- Place Basic Pokemon cards from your hand face up onto your Bench.
- You can play as many as you want (up to the Bench limit of 5).

### B. Evolve Pokemon
- Play an Evolution card from your hand on top of the matching Pokemon in play.
- You may evolve as many Pokemon as you want.
- **Restrictions:**
  - Cannot evolve a Pokemon on its first turn in play.
  - Cannot evolve the same Pokemon twice in one turn.
  - Cannot evolve any Pokemon on either player's first turn (unless a card says so).

### C. Attach Energy
- Take one Energy card from your hand and attach it to one of your Pokemon in play (Active or Benched).
- **Once per turn** (unless a card effect allows additional attachments).

### D. Play Trainer Cards
- Play as many **Item** cards as you want.
- Play only **one Supporter** card per turn.
- Play only **one Stadium** card per turn.
- First player cannot play a Supporter on their first turn.

### E. Retreat Your Active Pokemon
- **Once per turn.**
- Discard Energy equal to the Retreat Cost from the Active Pokemon.
- Switch it with a Benched Pokemon.
- Both Pokemon keep their damage counters and attached cards.
- Special Conditions and attack effects are removed from the retreating Pokemon when it goes to the Bench.
- **Asleep and Paralyzed** Pokemon cannot retreat.
- If the Retreat Cost is 0, the Pokemon retreats for free.
- You can still attack after retreating (with the new Active Pokemon).

### F. Use Abilities
- You may use as many Abilities as you want (subject to each Ability's own restrictions).
- Abilities are not attacks - using an Ability does not end your turn or count as attacking.
- Can use Abilities from both Active and Benched Pokemon.
- Some Abilities are always active (static); others must be explicitly activated.
- Announce which Abilities you are using so your opponent knows.

## 3. Attack (Ends Your Turn)

Once you attack, your turn is over. You cannot go back to perform more actions.

- **First turn of the game:** The starting player skips this step entirely. Their turn ends after performing actions.
- If you cannot or choose not to attack, tell your opponent your turn is over.

See [Attacking and Damage](04-attacking-and-damage.md) for full attack mechanics.

## 4. Pokemon Checkup (Between Turns)

After the attacking player's turn ends, before the next player's turn begins, Pokemon Checkup occurs:

1. **Poisoned** - Put 1 damage counter (10 damage) on each Poisoned Pokemon.
2. **Burned** - Put 2 damage counters (20 damage) on each Burned Pokemon, then flip a coin. Heads = recover (remove Burn marker).
3. **Asleep** - Flip a coin. Heads = recover (turn card right-side up). Tails = stay Asleep.
4. **Paralyzed** - If the Pokemon was Paralyzed before its owner's last turn, it recovers (turn card right-side up).

Also apply effects of any Abilities, Trainer cards, or anything else that a card states must happen during Pokemon Checkup (or "between turns").

**Ordering rule:** You can check Special Conditions first then other effects, or other effects first then Special Conditions, but you cannot interleave them.

After all checks, any Pokemon with damage equal to or greater than its HP is Knocked Out. The player moves a new Pokemon to the Active Spot, and the opponent takes Prize card(s). Then the next player's turn begins.
