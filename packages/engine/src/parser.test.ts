import { describe, expect, test } from "bun:test";
import { parseEffectText } from "./parser";

describe("parseEffectText", () => {
  test("does not emit duplicate heal effects for 'heal each of your Pokemon'", () => {
    const effects = parseEffectText("Heal 30 damage from each of your Pokémon.");

    expect(effects.filter((effect) => effect.type === "heal_all")).toHaveLength(1);
    expect(effects.map((effect) => effect.type)).not.toContain("heal_all_pokemon");
  });

  test("parses Lillie's Determination as a single conditional shuffle draw", () => {
    const effects = parseEffectText(
      "Shuffle your hand into your deck. Then, draw 6 cards. If you have exactly 6 Prize cards remaining, draw 8 cards instead.",
    );

    expect(effects).toEqual([{
      type: "conditional_shuffle_draw",
      defaultDraw: 6,
      conditionalDraw: 8,
      condition: "you have exactly 6 Prize cards remaining",
    }]);
  });

  test("parses Night Stretcher as a Pokemon-or-Basic-Energy recovery choice", () => {
    const effects = parseEffectText("Put a Pokémon or a Basic Energy card from your discard pile into your hand.");

    expect(effects).toEqual([{
      type: "recover_from_discard",
      count: 1,
      minCount: 1,
      destination: "hand",
      alternatives: [
        { category: "Pokemon" },
        { category: "Energy", filter: "Basic Energy" },
      ],
    }]);
  });
});
