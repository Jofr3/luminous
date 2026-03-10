import { useEffect } from "react";
import { fetchCardById, fetchCards } from "~/lib/api";
import type { CardDetail, CardSummary } from "~/lib/types";
import { SimulatorBoard } from "./simulator/SimulatorBoard";
import { useSimulatorState } from "./simulator/useSimulatorState";
import type {
  CardInstance,
  DeckLine,
  DragPayload,
  PlayerBoard,
  PokemonInPlay,
  SimulatorStore,
} from "./simulator/types";

function createInitialStore(): SimulatorStore {
  return {
    phase: "idle",
    winner: null,
    coinFlipResult: null,
    deckInput1: DEFAULT_DECKLIST,
    deckInput2: DEFAULT_DECKLIST,
    loading: false,
    firstPlayer: 0,
    currentTurn: 0,
    turnNumber: 1,
    turnDrawDone: false,
    selectedHandUid: [null, null],
    selectedPrizeUid: [null, null],
    revealedPrizeUids: [[], []],
    nameQueryCache: {},
    logs: [
      "Loading decklists and setting up the game...",
    ],
    players: [createEmptyPlayer(), createEmptyPlayer()],
  };
}

const DEFAULT_DECKLIST = [
  "4 Pikachu",
  "4 Charmander",
  "4 Bulbasaur",
  "4 Squirtle",
  "4 Nest Ball",
  "4 Ultra Ball",
  "4 Potion",
  "4 Switch",
  "4 Professor's Research",
  "4 Boss's Orders",
  "12 Lightning Energy",
  "8 Fire Energy",
].join("\n");

let uidCounter = 0;

function nextUid(): string {
  uidCounter += 1;
  return `sim-${uidCounter}`;
}

function appendLog(store: SimulatorStore, message: string): void {
  store.logs = [message, ...store.logs].slice(0, 150);
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function drawFromDeck(player: PlayerBoard, count: number): CardInstance[] {
  const out: CardInstance[] = [];
  for (let i = 0; i < count && player.deck.length > 0; i += 1) {
    const card = player.deck.shift();
    if (card) out.push(card);
  }
  return out;
}

function isBasicPokemon(card: CardSummary): boolean {
  return card.category === "Pokemon" && card.stage === "Basic";
}

function makePokemonInPlay(instance: CardInstance): PokemonInPlay {
  return {
    uid: nextUid(),
    base: instance,
    damage: 0,
    attached: [],
  };
}

function createEmptyPlayer(): PlayerBoard {
  return {
    deck: [],
    hand: [],
    prizes: [],
    discard: [],
    active: null,
    bench: [],
    takenPrizes: 0,
    mulligans: 0,
    energyAttachedThisTurn: false,
  };
}

function parseDecklist(input: string): { lines: DeckLine[]; errors: string[] } {
  const lines: DeckLine[] = [];
  const errors: string[] = [];

  const rawLines = input
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("#") && !l.startsWith("//"));

  for (const raw of rawLines) {
    const m = raw.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (!m) {
      errors.push(`Could not parse line: \"${raw}\"`);
      continue;
    }

    const qty = parseInt(m[1], 10);
    const query = m[2].trim();

    if (!qty || qty < 1) {
      errors.push(`Invalid quantity in line: \"${raw}\"`);
      continue;
    }

    if (!query) {
      errors.push(`Missing card name/id in line: \"${raw}\"`);
      continue;
    }

    lines.push({ qty, query });
  }

  return { lines, errors };
}

function looksLikeCardId(query: string): boolean {
  return /^[a-z0-9.]+\-\d+[a-z]?$/i.test(query.trim());
}

function summaryFromDetail(detail: CardDetail): CardSummary {
  return {
    id: detail.id,
    local_id: detail.local_id,
    name: detail.name,
    image: detail.image,
    category: detail.category,
    rarity: detail.rarity,
    hp: detail.hp,
    stage: detail.stage ?? null,
    trainer_type: detail.trainer_type ?? null,
    energy_type: detail.energy_type ?? null,
    suffix: detail.suffix ?? null,
    set_id: detail.set_id,
    set_name: detail.set_name,
  };
}

function normalizeName(v: string): string {
  return v.toLowerCase().replace(/\s+/g, " ").trim();
}

async function resolveCardSummary(store: SimulatorStore, query: string): Promise<CardSummary | null> {
  const key = normalizeName(query);
  if (store.nameQueryCache[key] !== undefined) {
    return store.nameQueryCache[key];
  }

  if (looksLikeCardId(query)) {
    try {
      const detail = await fetchCardById(query.trim());
      const summary = summaryFromDetail(detail);
      store.nameQueryCache[key] = summary;
      return summary;
    } catch {
      store.nameQueryCache[key] = null;
      return null;
    }
  }

  const res = await fetchCards({ q: query, limit: 100 });
  if (res.data.length === 0) {
    store.nameQueryCache[key] = null;
    return null;
  }

  const exact = res.data.find((c) => normalizeName(c.name) === key) ?? res.data[0];
  store.nameQueryCache[key] = exact;
  return exact;
}

async function buildDeckFromInput(store: SimulatorStore, input: string, label: string): Promise<CardInstance[] | null> {
  const parsed = parseDecklist(input);
  if (parsed.errors.length > 0) {
    for (const err of parsed.errors) appendLog(store, `${label}: ${err}`);
    return null;
  }

  const deck: CardInstance[] = [];
  for (const line of parsed.lines) {
    const summary = await resolveCardSummary(store, line.query);
    if (!summary) {
      appendLog(store, `${label}: card not found for \"${line.query}\".`);
      return null;
    }

    for (let i = 0; i < line.qty; i += 1) {
      deck.push({ uid: nextUid(), card: summary });
    }
  }

  if (deck.length !== 60) {
    appendLog(store, `${label}: deck has ${deck.length} cards. It must have exactly 60.`);
    return null;
  }

  return shuffle(deck);
}

function removeHandCard(player: PlayerBoard, uid: string): CardInstance | null {
  const idx = player.hand.findIndex((c) => c.uid === uid);
  if (idx === -1) return null;
  const [card] = player.hand.splice(idx, 1);
  return card ?? null;
}

function removeBenchPokemon(player: PlayerBoard, uid: string): PokemonInPlay | null {
  const idx = player.bench.findIndex((p) => p.uid === uid);
  if (idx === -1) return null;
  const [slot] = player.bench.splice(idx, 1);
  return slot ?? null;
}

function removePrizeCard(player: PlayerBoard, uid: string): CardInstance | null {
  const idx = player.prizes.findIndex((c) => c.uid === uid);
  if (idx === -1) return null;
  const [card] = player.prizes.splice(idx, 1);
  return card ?? null;
}

function hasBasicInHand(hand: CardInstance[]): boolean {
  return hand.some((c) => isBasicPokemon(c.card));
}

function autoMulliganUntilBasic(player: PlayerBoard): void {
  while (!hasBasicInHand(player.hand)) {
    player.mulligans += 1;
    player.deck = shuffle([...player.deck, ...player.hand]);
    player.hand = drawFromDeck(player, 7);
  }
}

function canAct(store: SimulatorStore, playerIdx: 0 | 1, action: string): boolean {
  if (store.winner) return false;

  if (store.phase !== "playing") {
    appendLog(store, `Cannot ${action} before setup is finalized.`);
    return false;
  }

  if (store.currentTurn !== playerIdx) {
    appendLog(store, `only current player can ${action}.`);
    return false;
  }

  return true;
}

export function SimulatorPage() {
  const { store, withStore } = useSimulatorState(createInitialStore);

  const autoSetup = withStore(async (store) => {
    store.loading = true;
    try {
      const deck1 = await buildDeckFromInput(store, store.deckInput1, "Deck 1");
      const deck2 = await buildDeckFromInput(store, store.deckInput2, "Deck 2");
      if (!deck1 || !deck2) return;

      const p1 = createEmptyPlayer();
      const p2 = createEmptyPlayer();
      p1.deck = deck1;
      p2.deck = deck2;

      p1.hand = drawFromDeck(p1, 7);
      p2.hand = drawFromDeck(p2, 7);

      autoMulliganUntilBasic(p1);
      autoMulliganUntilBasic(p2);

      const shared = Math.min(p1.mulligans, p2.mulligans);
      const bonus1 = Math.max(0, p2.mulligans - shared);
      const bonus2 = Math.max(0, p1.mulligans - shared);
      p1.hand.push(...drawFromDeck(p1, bonus1));
      p2.hand.push(...drawFromDeck(p2, bonus2));

      store.players = [p1, p2];
      store.winner = null;
      store.coinFlipResult = null;
      store.revealedPrizeUids = [[], []];
      store.selectedPrizeUid = [null, null];
      store.selectedHandUid = [null, null];
      store.currentTurn = 0;
      store.phase = "setup";

      appendLog(store, `Mulligans -> P1: ${p1.mulligans}, P2: ${p2.mulligans}.`);
      appendLog(store, `P1: place your Active Pokemon (required) and Bench, then click Ready.`);
    } finally {
      store.loading = false;
    }
  });

  useEffect(() => {
    void autoSetup();
    // Initial one-time setup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectHandCard = withStore((store, playerIdx: 0 | 1, uid: string) => {
    store.selectedHandUid[playerIdx] = uid;
  });

  const endTurn = withStore((store) => {
    if (store.phase === "setup") {
      const player = store.players[store.currentTurn];
      if (!player.active) {
        appendLog(store, `P${store.currentTurn + 1} must place an Active Pokemon before continuing.`);
        return;
      }

      if (store.currentTurn === 0) {
        store.currentTurn = 1;
        appendLog(store, `P1 is ready.`);
        appendLog(store, `P2: place your Active Pokemon (required) and Bench, then click End Turn.`);
        return;
      }

      // Both players ready — finalize setup
      for (const p of store.players) {
        p.prizes = drawFromDeck(p, 6);
        p.energyAttachedThisTurn = false;
      }

      store.coinFlipResult = Math.random() < 0.5 ? "Heads" : "Tails";
      store.firstPlayer = store.coinFlipResult === "Heads" ? 0 : 1;
      store.currentTurn = store.firstPlayer;
      store.turnNumber = 1;
      store.turnDrawDone = false;
      store.phase = "playing";

      appendLog(store, `Coin flip: ${store.coinFlipResult}. P${store.firstPlayer + 1} goes first.`);
      appendLog(store, "First player cannot attack on turn 1.");

      // Auto-draw for first player
      const firstP = store.players[store.firstPlayer];
      const drawn = drawFromDeck(firstP, 1);
      if (drawn.length > 0) {
        firstP.hand.push(...drawn);
        store.turnDrawDone = true;
        appendLog(store, `P${store.firstPlayer + 1} drew a card.`);
      }
      return;
    }

    if (store.phase !== "playing") return;
    if (!canAct(store, store.currentTurn, "end turn")) return;

    const next = (store.currentTurn === 0 ? 1 : 0) as 0 | 1;
    store.currentTurn = next;
    store.turnNumber += 1;
    store.turnDrawDone = false;
    store.players[next].energyAttachedThisTurn = false;
    appendLog(store, `P${next + 1} turn.`);

    const player = store.players[next];
    const drawn = drawFromDeck(player, 1);
    if (drawn.length === 0) {
      store.winner = (next === 0 ? 1 : 0);
      appendLog(store, `P${next + 1} cannot draw at turn start and loses.`);
      return;
    }
    player.hand.push(...drawn);
    store.turnDrawDone = true;
    appendLog(store, `P${next + 1} drew a card.`);
  });

  const selectPrize = withStore((store, playerIdx: 0 | 1, uid: string) => {
    store.selectedPrizeUid[playerIdx] = uid;
  });


  const dropToActive = withStore((store, payload: DragPayload, targetPlayerIdx: 0 | 1) => {
    const sourcePlayer = store.players[payload.playerIdx];
    const targetPlayer = store.players[targetPlayerIdx];

    if (payload.zone === "bench" && payload.playerIdx === targetPlayerIdx) {
      const benchSlot = removeBenchPokemon(sourcePlayer, payload.uid);
      if (!benchSlot) return;

      if (!targetPlayer.active) {
        targetPlayer.active = benchSlot;
      } else {
        const oldActive = targetPlayer.active;
        targetPlayer.active = benchSlot;
        targetPlayer.bench.push(oldActive);
      }
      appendLog(store, `P${targetPlayerIdx + 1} switched Active via drag-and-drop.`);
      return;
    }

    if (payload.zone !== "hand" || payload.playerIdx !== targetPlayerIdx) return;

    const card = removeHandCard(sourcePlayer, payload.uid);
    if (!card) return;

    if (card.card.category === "Energy") {
      if (!targetPlayer.active) {
        sourcePlayer.hand.push(card);
        return;
      }
      if (store.phase === "playing" && !canAct(store, targetPlayerIdx, "attach Energy")) {
        sourcePlayer.hand.push(card);
        return;
      }
      if (store.phase === "playing" && targetPlayer.energyAttachedThisTurn) {
        sourcePlayer.hand.push(card);
        appendLog(store, `P${targetPlayerIdx + 1} already attached Energy this turn.`);
        return;
      }
      targetPlayer.active.attached.push(card);
      if (store.phase === "playing") targetPlayer.energyAttachedThisTurn = true;
      appendLog(store, `P${targetPlayerIdx + 1} attached ${card.card.name} to Active via drag-and-drop.`);
      return;
    }

    if (!isBasicPokemon(card.card)) {
      sourcePlayer.hand.push(card);
      return;
    }

    if (!targetPlayer.active) {
      targetPlayer.active = makePokemonInPlay(card);
      appendLog(store, `P${targetPlayerIdx + 1} set Active via drag-and-drop.`);
    } else {
      sourcePlayer.hand.push(card);
    }
  });

  const dropToBench = withStore((store, payload: DragPayload, targetPlayerIdx: 0 | 1) => {
    if (payload.zone !== "hand" || payload.playerIdx !== targetPlayerIdx) return;

    const targetPlayer = store.players[targetPlayerIdx];
    if (targetPlayer.bench.length >= 5) return;

    if (store.phase === "playing" && !canAct(store, targetPlayerIdx, "bench a Pokemon")) return;

    const card = removeHandCard(targetPlayer, payload.uid);
    if (!card) return;

    if (!isBasicPokemon(card.card)) {
      targetPlayer.hand.push(card);
      return;
    }

    targetPlayer.bench.push(makePokemonInPlay(card));
    appendLog(store, `P${targetPlayerIdx + 1} benched ${card.card.name} via drag-and-drop.`);
  });

  const dropToBenchSlot = withStore((
    store,
    payload: DragPayload,
    targetPlayerIdx: 0 | 1,
    benchIdx: number,
  ) => {
    if (payload.playerIdx !== targetPlayerIdx) return;

    const targetPlayer = store.players[targetPlayerIdx];
    const benchSlot = targetPlayer.bench[benchIdx];
    if (!benchSlot) return;

    // Hand → bench slot
    if (payload.zone === "hand") {
      const card = removeHandCard(targetPlayer, payload.uid);
      if (!card) return;

      // Energy attachment
      if (card.card.category === "Energy") {
        if (store.phase === "playing" && !canAct(store, targetPlayerIdx, "attach Energy")) {
          targetPlayer.hand.push(card);
          return;
        }
        if (store.phase === "playing" && targetPlayer.energyAttachedThisTurn) {
          targetPlayer.hand.push(card);
          appendLog(store, `P${targetPlayerIdx + 1} already attached Energy this turn.`);
          return;
        }
        benchSlot.attached.push(card);
        if (store.phase === "playing") targetPlayer.energyAttachedThisTurn = true;
        store.selectedHandUid[targetPlayerIdx] = null;
        appendLog(store, `P${targetPlayerIdx + 1} attached ${card.card.name} to Benched ${benchSlot.base.card.name}.`);
        return;
      }

      // Not energy — put it back
      targetPlayer.hand.push(card);
      return;
    }

    // Bench → bench slot: swap positions
    if (payload.zone === "bench" && payload.uid !== benchSlot.uid) {
      const draggedIdx = targetPlayer.bench.findIndex((b) => b.uid === payload.uid);
      if (draggedIdx === -1) return;
      const temp = targetPlayer.bench[draggedIdx];
      targetPlayer.bench[draggedIdx] = benchSlot;
      targetPlayer.bench[benchIdx] = temp;
      appendLog(store, `P${targetPlayerIdx + 1} rearranged bench.`);
    }
  });

  const dropToDiscard = withStore((store, payload: DragPayload, targetPlayerIdx: 0 | 1) => {
    if (payload.playerIdx !== targetPlayerIdx || payload.zone !== "hand") return;

    const targetPlayer = store.players[targetPlayerIdx];
    const card = removeHandCard(targetPlayer, payload.uid);
    if (!card) return;
    targetPlayer.discard.push(card);
    appendLog(store, `P${targetPlayerIdx + 1} discarded ${card.card.name} via drag-and-drop.`);
  });

  const dropToHand = withStore((store, payload: DragPayload, targetPlayerIdx: 0 | 1) => {
    if (payload.playerIdx !== targetPlayerIdx || payload.zone !== "prize") return;

    const player = store.players[targetPlayerIdx];
    const card = removePrizeCard(player, payload.uid);
    if (!card) return;
    player.hand.push(card);

    store.revealedPrizeUids[targetPlayerIdx] = store.revealedPrizeUids[targetPlayerIdx].filter((x) => x !== payload.uid);
    appendLog(store, `P${targetPlayerIdx + 1} moved a revealed Prize to hand via drag-and-drop.`);
  });

  const actions = {
    selectPrize,
    dropToActive,
    dropToBench,
    dropToBenchSlot,
    dropToDiscard,
    dropToHand,
    selectHandCard,
    endTurn,
  };

  return <SimulatorBoard store={store} actions={actions} />;
}
