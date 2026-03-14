import { describe, expect, test } from "bun:test";
import { applySimulatorAction } from "./actions";
import type { CardInstance, CardSummary, PlayerBoard, PokemonInPlay, SimulatorStore } from "./types";

function makePokemonCard(
  name: string,
  overrides: Partial<CardSummary> = {},
): CardSummary {
  return {
    id: `${name.toLowerCase().replace(/\s+/g, "-")}-id`,
    name,
    image: null,
    category: "Pokemon",
    hp: 120,
    stage: "Basic",
    trainer_type: null,
    energy_type: null,
    suffix: null,
    evolve_from: null,
    retreat: 1,
    effect: null,
    types: ["Colorless"],
    attacks: [],
    abilities: [],
    weaknesses: [],
    resistances: [],
    set_id: "test",
    ...overrides,
  };
}

function makeTrainerCard(
  name: string,
  trainerType: NonNullable<CardSummary["trainer_type"]>,
  effect: string,
): CardSummary {
  return {
    id: `${name.toLowerCase().replace(/\s+/g, "-")}-id`,
    name,
    image: null,
    category: "Trainer",
    hp: null,
    stage: null,
    trainer_type: trainerType,
    energy_type: null,
    suffix: null,
    evolve_from: null,
    retreat: null,
    effect,
    types: [],
    attacks: [],
    abilities: [],
    weaknesses: [],
    resistances: [],
    set_id: "test",
  };
}

function makeCard(uid: string, card: CardSummary): CardInstance {
  return { uid, card };
}

function makePokemonInPlay(
  uid: string,
  card: CardSummary,
  overrides: Partial<PokemonInPlay> = {},
): PokemonInPlay {
  return {
    uid,
    base: makeCard(`${uid}-base`, card),
    damage: 0,
    attached: [],
    specialConditions: [],
    poisonDamage: 10,
    burnDamage: 20,
    turnPlayedOrEvolved: 0,
    usedAbilityThisTurn: false,
    ...overrides,
  };
}

function makePlayerBoard(overrides: Partial<PlayerBoard> = {}): PlayerBoard {
  return {
    deck: [],
    hand: [],
    prizes: [],
    discard: [],
    active: null,
    bench: [],
    takenPrizes: 0,
    mulligans: 0,
    trainerUseZone: [],
    energyAttachedThisTurn: false,
    supporterPlayedThisTurn: false,
    retreatedThisTurn: false,
    activeEffects: [],
    ...overrides,
  };
}

function makeStore(overrides: Partial<SimulatorStore> = {}): SimulatorStore {
  return {
    phase: "playing",
    winner: null,
    coinFlipResult: null,
    deckInput1: "",
    deckInput2: "",
    loading: false,
    firstPlayer: 0,
    currentTurn: 0,
    turnNumber: 2,
    turnDrawDone: true,
    selectedHandUid: [null, null],
    selectedPrizeUid: [null, null],
    revealedPrizeUids: [[], []],
    nameQueryCache: {},
    logs: [],
    players: [makePlayerBoard(), makePlayerBoard()],
    stadium: null,
    pendingHandSelection: null,
    pendingDeckSearch: null,
    pendingDiscardSelection: null,
    pendingOpponentSwitch: null,
    pendingSelfSwitch: null,
    pendingRareCandy: null,
    pendingEvolveFromDeck: null,
    pendingBenchDiscard: null,
    stadiumUsedThisTurn: [false, false],
    gameStarted: true,
    ...overrides,
  };
}

describe("applySimulatorAction", () => {
  test("applies conditional Stadium bonus damage after discarding the Stadium", () => {
    const attackerCard = makePokemonCard("Attacker", {
      attacks: [{
        name: "Stadium Burst",
        cost: [],
        damage: "0",
        effect: "You may discard a Stadium in play. If you do, this attack does 100 more damage.",
      }],
    });
    const defenderCard = makePokemonCard("Defender");
    const stadium = makeCard("stadium", makeTrainerCard("Arena", "Stadium", "In play."));
    const store = makeStore({
      players: [
        makePlayerBoard({ active: makePokemonInPlay("p1-active", attackerCard) }),
        makePlayerBoard({ active: makePokemonInPlay("p2-active", defenderCard) }),
      ],
      stadium: { card: stadium, playedByPlayer: 1 },
    });

    const next = applySimulatorAction(store, { type: "useAttack", attackIdx: 0 });

    expect(next.players[1].active?.damage).toBe(100);
    expect(next.stadium).toBeNull();
    expect(next.players[1].discard.map((card) => card.card.name)).toContain("Arena");
  });

  test("Iono puts cards on the bottom of the deck instead of shuffling them in", () => {
    const iono = makeCard("iono", makeTrainerCard(
      "Iono",
      "Supporter",
      "Each player shuffles their hand and puts it on the bottom of their deck. Then, each player draws a card for each of their remaining Prize cards.",
    ));
    const keptA = makeCard("kept-a", makeTrainerCard("Kept A", "Item", "Blank."));
    const keptB = makeCard("kept-b", makeTrainerCard("Kept B", "Item", "Blank."));
    const deckTop1 = makeCard("deck-top-1", makeTrainerCard("Deck Top 1", "Item", "Blank."));
    const deckTop2 = makeCard("deck-top-2", makeTrainerCard("Deck Top 2", "Item", "Blank."));
    const deckBottom = makeCard("deck-bottom", makeTrainerCard("Deck Bottom", "Item", "Blank."));
    const oppTop1 = makeCard("opp-top-1", makeTrainerCard("Opp Top 1", "Item", "Blank."));
    const oppTop2 = makeCard("opp-top-2", makeTrainerCard("Opp Top 2", "Item", "Blank."));

    const store = makeStore({
      players: [
        makePlayerBoard({
          hand: [iono, keptA, keptB],
          deck: [deckTop1, deckTop2, deckBottom],
          prizes: [makeCard("p1-prize-1", makeTrainerCard("Prize 1", "Item", "Blank.")), makeCard("p1-prize-2", makeTrainerCard("Prize 2", "Item", "Blank."))],
          active: makePokemonInPlay("p1-active", makePokemonCard("P1 Active")),
        }),
        makePlayerBoard({
          hand: [makeCard("opp-hand", makeTrainerCard("Opp Hand", "Item", "Blank."))],
          deck: [oppTop1, oppTop2],
          prizes: [makeCard("p2-prize-1", makeTrainerCard("Prize 3", "Item", "Blank.")), makeCard("p2-prize-2", makeTrainerCard("Prize 4", "Item", "Blank."))],
          active: makePokemonInPlay("p2-active", makePokemonCard("P2 Active")),
        }),
      ],
    });

    const next = applySimulatorAction(store, { type: "playTrainerCard", uid: "iono" });

    expect(next.players[0].hand.map((card) => card.card.name)).toEqual(["Deck Top 1", "Deck Top 2"]);
    expect(next.players[0].deck.map((card) => card.card.name)).toEqual(["Deck Bottom", "Kept A", "Kept B"]);
  });

  test("conditional draw only resolves the base draw and leaves the bonus as manual", () => {
    const drawCard = makeCard("draw-card", makeTrainerCard(
      "Conditional Draw",
      "Item",
      "Draw 2 cards. If you played Arven, draw 2 more cards.",
    ));
    const deck1 = makeCard("deck-1", makeTrainerCard("Deck 1", "Item", "Blank."));
    const deck2 = makeCard("deck-2", makeTrainerCard("Deck 2", "Item", "Blank."));
    const deck3 = makeCard("deck-3", makeTrainerCard("Deck 3", "Item", "Blank."));

    const store = makeStore({
      players: [
        makePlayerBoard({
          hand: [drawCard],
          deck: [deck1, deck2, deck3],
          active: makePokemonInPlay("p1-active", makePokemonCard("P1 Active")),
        }),
        makePlayerBoard({ active: makePokemonInPlay("p2-active", makePokemonCard("P2 Active")) }),
      ],
    });

    const next = applySimulatorAction(store, { type: "playTrainerCard", uid: "draw-card" });

    expect(next.players[0].hand.map((card) => card.card.name)).toEqual(["Deck 1", "Deck 2"]);
    expect(next.players[0].deck.map((card) => card.card.name)).toEqual(["Deck 3"]);
    expect(next.logs.some((log) => log.includes("Manual effect: draw 2 more card(s) if you played Arven"))).toBe(true);
  });

  test("Lillie's Determination draws 8 with 6 prizes and 6 otherwise", () => {
    const lillie = makeCard("lillie", makeTrainerCard(
      "Lillie's Determination",
      "Supporter",
      "Shuffle your hand into your deck. Then, draw 6 cards. If you have exactly 6 Prize cards remaining, draw 8 cards instead.",
    ));
    const deck = Array.from({ length: 10 }, (_, i) => makeCard(`deck-${i}`, makeTrainerCard(`Deck ${i}`, "Item", "Blank.")));

    const withSixPrizes = makeStore({
      players: [
        makePlayerBoard({
          hand: [lillie, makeCard("other", makeTrainerCard("Other", "Item", "Blank."))],
          deck: [...deck],
          prizes: Array.from({ length: 6 }, (_, i) => makeCard(`prize-${i}`, makeTrainerCard(`Prize ${i}`, "Item", "Blank."))),
          active: makePokemonInPlay("p1-active", makePokemonCard("P1 Active")),
        }),
        makePlayerBoard({ active: makePokemonInPlay("p2-active", makePokemonCard("P2 Active")) }),
      ],
    });

    const withoutSixPrizes = makeStore({
      players: [
        makePlayerBoard({
          hand: [lillie, makeCard("other-2", makeTrainerCard("Other 2", "Item", "Blank."))],
          deck: [...deck],
          prizes: Array.from({ length: 4 }, (_, i) => makeCard(`prize-b-${i}`, makeTrainerCard(`Prize B${i}`, "Item", "Blank."))),
          active: makePokemonInPlay("p1-active", makePokemonCard("P1 Active")),
        }),
        makePlayerBoard({ active: makePokemonInPlay("p2-active", makePokemonCard("P2 Active")) }),
      ],
    });

    const eightCardResult = applySimulatorAction(withSixPrizes, { type: "playTrainerCard", uid: "lillie" });
    const sixCardResult = applySimulatorAction(withoutSixPrizes, { type: "playTrainerCard", uid: "lillie" });

    expect(eightCardResult.players[0].hand).toHaveLength(8);
    expect(sixCardResult.players[0].hand).toHaveLength(6);
  });

  test("damage_per_tool counts Tools attached to your Pokemon", () => {
    const toolA = makeCard("tool-a", makeTrainerCard("Tool A", "Tool", "Blank."));
    const toolB = makeCard("tool-b", makeTrainerCard("Tool B", "Tool", "Blank."));
    const opponentTool = makeCard("opponent-tool", makeTrainerCard("Opponent Tool", "Tool", "Blank."));
    const attackerCard = makePokemonCard("Attacker", {
      attacks: [{
        name: "Tool Count",
        cost: [],
        damage: "0",
        effect: "This attack does 40 damage for each Pokémon Tool attached to all of your Pokémon.",
      }],
    });

    const store = makeStore({
      players: [
        makePlayerBoard({
          active: makePokemonInPlay("p1-active", attackerCard, { attached: [toolA] }),
          bench: [makePokemonInPlay("p1-bench", makePokemonCard("Bench"), { attached: [toolB] })],
        }),
        makePlayerBoard({
          active: makePokemonInPlay("p2-active", makePokemonCard("Defender"), { attached: [opponentTool] }),
        }),
      ],
    });

    const next = applySimulatorAction(store, { type: "useAttack", attackIdx: 0 });

    expect(next.players[1].active?.damage).toBe(80);
  });

  test("damage_per_prize uses prizes already taken by the opponent", () => {
    const attackerCard = makePokemonCard("Attacker", {
      attacks: [{
        name: "Prize Count",
        cost: [],
        damage: "0",
        effect: "This attack does 20 damage for each Prize card your opponent has taken.",
      }],
    });

    const store = makeStore({
      players: [
        makePlayerBoard({
          active: makePokemonInPlay("p1-active", attackerCard),
        }),
        makePlayerBoard({
          active: makePokemonInPlay("p2-active", makePokemonCard("Defender")),
          prizes: [
            makeCard("p2-prize-1", makeTrainerCard("Prize A", "Item", "Blank.")),
            makeCard("p2-prize-2", makeTrainerCard("Prize B", "Item", "Blank.")),
          ],
          takenPrizes: 4,
        }),
      ],
    });

    const next = applySimulatorAction(store, { type: "useAttack", attackIdx: 0 });

    expect(next.players[1].active?.damage).toBe(80);
  });

  test("Night Stretcher lets you recover either a Pokemon or a Basic Energy from discard", () => {
    const nightStretcher = makeCard("night-stretcher", makeTrainerCard(
      "Night Stretcher",
      "Item",
      "Put a Pokémon or a Basic Energy card from your discard pile into your hand.",
    ));
    const recoveredPokemon = makeCard("recover-pokemon", makePokemonCard("Recovered Pokemon"));
    const recoveredEnergy = makeCard("recover-energy", {
      ...makePokemonCard("Basic Fire Energy", {
        category: "Energy",
        hp: null,
        stage: null,
        retreat: null,
        effect: null,
        types: ["Fire"],
      }),
      category: "Energy",
      trainer_type: null,
      energy_type: "Normal",
      attacks: [],
      abilities: [],
      weaknesses: [],
      resistances: [],
    });

    const store = makeStore({
      players: [
        makePlayerBoard({
          hand: [nightStretcher],
          discard: [recoveredPokemon, recoveredEnergy],
          active: makePokemonInPlay("p1-active", makePokemonCard("P1 Active")),
        }),
        makePlayerBoard({ active: makePokemonInPlay("p2-active", makePokemonCard("P2 Active")) }),
      ],
    });

    const prompted = applySimulatorAction(store, { type: "playTrainerCard", uid: "night-stretcher" });

    expect(prompted.pendingDiscardSelection?.candidateUids).toEqual(["recover-pokemon", "recover-energy"]);

    const selected = applySimulatorAction(prompted, { type: "toggleDiscardSelectionCard", uid: "recover-pokemon" });
    const resolved = applySimulatorAction(selected, { type: "confirmDiscardSelection" });

    expect(resolved.players[0].hand.map((card) => card.uid)).toContain("recover-pokemon");
    expect(resolved.players[0].discard.map((card) => card.uid)).not.toContain("recover-pokemon");
  });
});
