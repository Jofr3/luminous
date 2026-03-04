import { $, component$, useStore } from "@builder.io/qwik";
import { type DocumentHead } from "@builder.io/qwik-city";
import { fetchCardById, fetchCards, imageUrl } from "~/lib/api";
import {
  calculateAttackDamage,
  canPayAttackCost,
  getCardAttacks,
  knockoutPrizeCount,
} from "~/lib/simulator";
import type { CardDetail, CardSummary } from "~/lib/types";

type RulesMode = "strict" | "manual";
type Phase = "idle" | "setup" | "playing";
type Zone = "hand" | "active" | "bench" | "prize";

interface DeckLine {
  qty: number;
  query: string;
}

interface CardInstance {
  uid: string;
  card: CardSummary;
}

interface PokemonInPlay {
  uid: string;
  base: CardInstance;
  damage: number;
  attached: CardInstance[];
}

interface DragPayload {
  playerIdx: 0 | 1;
  zone: Zone;
  uid: string;
}

interface PlayerBoard {
  name: string;
  deck: CardInstance[];
  hand: CardInstance[];
  prizes: CardInstance[];
  discard: CardInstance[];
  active: PokemonInPlay | null;
  bench: PokemonInPlay[];
  takenPrizes: number;
  mulligans: number;
  energyAttachedThisTurn: boolean;
}

interface SimulatorStore {
  rulesMode: RulesMode;
  phase: Phase;
  winner: string | null;
  coinFlipResult: "Heads" | "Tails" | null;
  deckInput1: string;
  deckInput2: string;
  loading: boolean;
  firstPlayer: 0 | 1;
  currentTurn: 0 | 1;
  turnNumber: number;
  turnDrawDone: boolean;
  selectedHandUid: [string | null, string | null];
  selectedPrizeUid: [string | null, string | null];
  selectedAttackIndex: [number, number];
  revealedPrizeUids: [string[], string[]];
  detailCache: Record<string, CardDetail>;
  nameQueryCache: Record<string, CardSummary | null>;
  logs: string[];
  players: [PlayerBoard, PlayerBoard];
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

function createEmptyPlayer(name: string): PlayerBoard {
  return {
    name,
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

function cardTitle(card: CardSummary): string {
  const hp = card.hp ? ` (${card.hp} HP)` : "";
  return `${card.name}${hp}`;
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

function getSelectedHandCard(player: PlayerBoard, selectedUid: string | null): CardInstance | null {
  if (!selectedUid) return null;
  return player.hand.find((c) => c.uid === selectedUid) ?? null;
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

function takePrizeCards(attacker: PlayerBoard, amount: number): number {
  const toTake = Math.min(amount, attacker.prizes.length);
  const cards = attacker.prizes.splice(0, toTake);
  attacker.hand.push(...cards);
  attacker.takenPrizes += toTake;
  return toTake;
}

function promoteBench(player: PlayerBoard): void {
  if (player.active || player.bench.length === 0) return;
  const next = player.bench.shift();
  player.active = next ?? null;
}

function applyAutoKnockoutCheck(store: SimulatorStore): void {
  for (let defenderIdx = 0; defenderIdx < 2; defenderIdx += 1) {
    const defender = store.players[defenderIdx as 0 | 1];
    const attacker = store.players[(defenderIdx === 0 ? 1 : 0) as 0 | 1];

    const active = defender.active;
    if (!active) continue;

    const hp = Number(active.base.card.hp ?? 0);
    if (hp <= 0 || active.damage < hp) continue;

    defender.discard.push(active.base, ...active.attached);
    defender.active = null;

    const prizeAmount = knockoutPrizeCount(active.base.card.name);
    const taken = takePrizeCards(attacker, prizeAmount);

    appendLog(
      store,
      `${defender.name}'s ${active.base.card.name} was Knocked Out. ${attacker.name} took ${taken} Prize card(s).`,
    );

    promoteBench(defender);

    if (!defender.active && defender.bench.length === 0) {
      store.winner = attacker.name;
      appendLog(store, `${attacker.name} wins (opponent has no Pokemon in play).`);
    }

    if (attacker.prizes.length === 0) {
      store.winner = attacker.name;
      appendLog(store, `${attacker.name} wins (all Prize cards taken).`);
    }
  }
}

function canAct(store: SimulatorStore, playerIdx: 0 | 1, action: string): boolean {
  if (store.winner) return false;

  if (store.rulesMode === "manual") return true;

  if (store.phase !== "playing") {
    appendLog(store, `Cannot ${action} before setup is finalized.`);
    return false;
  }

  if (store.currentTurn !== playerIdx) {
    appendLog(store, `Strict mode: only current player can ${action}.`);
    return false;
  }

  return true;
}

function readDragPayload(ev: DragEvent): DragPayload | null {
  const dt = ev.dataTransfer;
  if (!dt) return null;
  const raw = dt.getData("application/x-sim-card");
  if (!raw) return null;

  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

function canDropToSetupBench(store: SimulatorStore, playerIdx: 0 | 1): boolean {
  if (store.phase !== "setup" && store.phase !== "playing") return false;
  return store.players[playerIdx].bench.length < 5;
}

async function fetchDetailCached(store: SimulatorStore, id: string): Promise<CardDetail> {
  if (!store.detailCache[id]) {
    store.detailCache[id] = await fetchCardById(id);
  }
  return store.detailCache[id];
}

export default component$(() => {
  const store = useStore<SimulatorStore>({
    rulesMode: "strict",
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
    selectedAttackIndex: [0, 0],
    revealedPrizeUids: [[], []],
    detailCache: {},
    nameQueryCache: {},
    logs: [
      "Load two 60-card decklists (format: '4 Card Name' per line).",
      "Run setup (with mulligans), place Active/Bench, then start playing.",
    ],
    players: [createEmptyPlayer("Player 1"), createEmptyPlayer("Player 2")],
  });

  const startSetup = $(async () => {
    store.loading = true;
    try {
      const deck1 = await buildDeckFromInput(store, store.deckInput1, "Player 1 Deck");
      const deck2 = await buildDeckFromInput(store, store.deckInput2, "Player 2 Deck");
      if (!deck1 || !deck2) return;

      const p1 = createEmptyPlayer("Player 1");
      const p2 = createEmptyPlayer("Player 2");
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
      store.phase = "setup";
      store.winner = null;
      store.coinFlipResult = null;
      store.currentTurn = 0;
      store.turnNumber = 1;
      store.turnDrawDone = false;
      store.revealedPrizeUids = [[], []];
      store.selectedPrizeUid = [null, null];
      store.selectedHandUid = [null, null];

      appendLog(store, `Setup created. Mulligans -> P1: ${p1.mulligans}, P2: ${p2.mulligans}.`);
      appendLog(store, "Choose Active and Bench for each player, then click Finalize Setup.");
    } finally {
      store.loading = false;
    }
  });

  const finalizeSetup = $(() => {
    if (store.phase !== "setup") return;

    if (!store.players[0].active || !store.players[1].active) {
      appendLog(store, "Both players must have an Active Pokemon before finalizing setup.");
      return;
    }

    for (const p of store.players) {
      p.prizes = drawFromDeck(p, 6);
      if (p.prizes.length < 6) {
        appendLog(store, `${p.name} does not have enough cards to set 6 Prize cards.`);
      }
      p.energyAttachedThisTurn = false;
    }

    store.coinFlipResult = Math.random() < 0.5 ? "Heads" : "Tails";
    store.firstPlayer = store.coinFlipResult === "Heads" ? 0 : 1;
    store.currentTurn = store.firstPlayer;
    store.turnNumber = 1;
    store.turnDrawDone = false;
    store.phase = "playing";

    appendLog(
      store,
      `Coin flip: ${store.coinFlipResult}. ${store.players[store.firstPlayer].name} goes first.`,
    );
    appendLog(store, "Strict mode reminder: first player cannot attack on turn 1.");
  });

  const toggleRulesMode = $(() => {
    store.rulesMode = store.rulesMode === "strict" ? "manual" : "strict";
    appendLog(store, `Rules mode switched to ${store.rulesMode}.`);
  });

  const selectHandCard = $((playerIdx: 0 | 1, uid: string) => {
    store.selectedHandUid[playerIdx] = uid;
  });

  const setSelectedActive = $((playerIdx: 0 | 1) => {
    const player = store.players[playerIdx];
    if (player.active) {
      appendLog(store, `${player.name} already has an Active Pokemon.`);
      return;
    }

    const selected = getSelectedHandCard(player, store.selectedHandUid[playerIdx]);
    if (!selected || !isBasicPokemon(selected.card)) {
      appendLog(store, `${player.name}: select a Basic Pokemon from hand.`);
      return;
    }

    const card = removeHandCard(player, selected.uid);
    if (!card) return;
    player.active = makePokemonInPlay(card);
    store.selectedHandUid[playerIdx] = null;
    appendLog(store, `${player.name} set Active: ${card.card.name}.`);
  });

  const setSelectedBench = $((playerIdx: 0 | 1) => {
    const player = store.players[playerIdx];
    if (!canDropToSetupBench(store, playerIdx)) {
      appendLog(store, `${player.name} Bench is full.`);
      return;
    }

    if (store.phase === "playing" && !canAct(store, playerIdx, "bench a Pokemon")) return;
    if (store.rulesMode === "strict" && store.phase === "playing" && !store.turnDrawDone) {
      appendLog(store, "Strict mode: draw first before actions.");
      return;
    }

    const selected = getSelectedHandCard(player, store.selectedHandUid[playerIdx]);
    if (!selected || !isBasicPokemon(selected.card)) {
      appendLog(store, `${player.name}: select a Basic Pokemon from hand.`);
      return;
    }

    const card = removeHandCard(player, selected.uid);
    if (!card) return;
    player.bench.push(makePokemonInPlay(card));
    store.selectedHandUid[playerIdx] = null;
    appendLog(store, `${player.name} benched ${card.card.name}.`);
  });

  const discardSelectedCard = $((playerIdx: 0 | 1) => {
    const player = store.players[playerIdx];
    const selectedUid = store.selectedHandUid[playerIdx];
    if (!selectedUid) return;

    const card = removeHandCard(player, selectedUid);
    if (!card) return;
    player.discard.push(card);
    store.selectedHandUid[playerIdx] = null;
    appendLog(store, `${player.name} discarded ${card.card.name}.`);
  });

  const drawCard = $((playerIdx: 0 | 1) => {
    if (store.phase !== "playing") {
      appendLog(store, "Draw is available during playing phase.");
      return;
    }

    if (!canAct(store, playerIdx, "draw")) return;

    const player = store.players[playerIdx];

    if (store.rulesMode === "strict" && store.turnDrawDone) {
      appendLog(store, "Strict mode: you already drew this turn.");
      return;
    }

    const drawn = drawFromDeck(player, 1);
    if (drawn.length === 0) {
      store.winner = store.players[(playerIdx === 0 ? 1 : 0) as 0 | 1].name;
      appendLog(store, `${player.name} cannot draw at turn start and loses.`);
      return;
    }

    store.turnDrawDone = true;
    appendLog(store, `${player.name} drew ${drawn[0].card.name}.`);
  });

  const attachSelectedEnergyTo = $((playerIdx: 0 | 1, target: "active" | number) => {
    if (store.phase !== "playing") return;
    if (!canAct(store, playerIdx, "attach Energy")) return;

    if (store.rulesMode === "strict" && !store.turnDrawDone) {
      appendLog(store, "Strict mode: draw first before actions.");
      return;
    }

    const player = store.players[playerIdx];
    if (store.rulesMode === "strict" && player.energyAttachedThisTurn) {
      appendLog(store, `${player.name} already manually attached Energy this turn.`);
      return;
    }

    const selected = getSelectedHandCard(player, store.selectedHandUid[playerIdx]);
    if (!selected || selected.card.category !== "Energy") {
      appendLog(store, `${player.name}: select an Energy card from hand.`);
      return;
    }

    const energy = removeHandCard(player, selected.uid);
    if (!energy) return;

    if (target === "active") {
      if (!player.active) {
        player.hand.push(energy);
        appendLog(store, `${player.name} has no Active Pokemon.`);
        return;
      }
      player.active.attached.push(energy);
      appendLog(store, `${player.name} attached ${energy.card.name} to Active ${player.active.base.card.name}.`);
    } else {
      const bench = player.bench[target];
      if (!bench) {
        player.hand.push(energy);
        return;
      }
      bench.attached.push(energy);
      appendLog(store, `${player.name} attached ${energy.card.name} to Benched ${bench.base.card.name}.`);
    }

    player.energyAttachedThisTurn = true;
    store.selectedHandUid[playerIdx] = null;
  });

  const switchWithBench = $((playerIdx: 0 | 1, benchIdx: number) => {
    if (store.phase !== "playing") return;
    if (!canAct(store, playerIdx, "switch")) return;

    const player = store.players[playerIdx];
    if (!player.active) return;
    const bench = player.bench[benchIdx];
    if (!bench) return;

    const oldActive = player.active;
    player.active = bench;
    player.bench[benchIdx] = oldActive;
    appendLog(store, `${player.name} switched Active with a Benched Pokemon.`);
  });

  const changeDamage = $((playerIdx: 0 | 1, target: "active" | number, delta: number) => {
    const player = store.players[playerIdx];
    const slot = target === "active" ? player.active : player.bench[target];
    if (!slot) return;

    slot.damage = Math.max(0, slot.damage + delta);
    applyAutoKnockoutCheck(store);
  });

  const setAttackIndex = $((playerIdx: 0 | 1, index: number) => {
    store.selectedAttackIndex[playerIdx] = index;
  });

  const loadCardDetail = $(async (cardId: string) => {
    await fetchDetailCached(store, cardId);
  });

  const useAttack = $(async () => {
    if (store.phase !== "playing") {
      appendLog(store, "Attack is available during playing phase.");
      return;
    }

    const attackerIdx = store.currentTurn;
    const defenderIdx = (attackerIdx === 0 ? 1 : 0) as 0 | 1;

    if (!canAct(store, attackerIdx, "attack")) return;

    if (store.rulesMode === "strict") {
      if (!store.turnDrawDone) {
        appendLog(store, "Strict mode: draw first before attacking.");
        return;
      }
      if (store.turnNumber === 1 && attackerIdx === store.firstPlayer) {
        appendLog(store, "Strict mode: first player cannot attack on turn 1.");
        return;
      }
    }

    const attacker = store.players[attackerIdx];
    const defender = store.players[defenderIdx];

    if (!attacker.active || !defender.active) {
      appendLog(store, "Both sides need an Active Pokemon to attack.");
      return;
    }

    const attackerDetail = await fetchDetailCached(store, attacker.active.base.card.id);
    const defenderDetail = await fetchDetailCached(store, defender.active.base.card.id);

    const attacks = getCardAttacks(attackerDetail);
    const attackIdx = store.selectedAttackIndex[attackerIdx] ?? 0;
    const attack = attacks[attackIdx];

    if (!attack) {
      appendLog(store, `${attacker.active.base.card.name} has no selected attack.`);
      return;
    }

    if (!canPayAttackCost(attack, attacker.active.attached)) {
      appendLog(store, `${attacker.name} cannot pay the attack cost for ${attack.name ?? "attack"}.`);
      return;
    }

    const damage = calculateAttackDamage({
      attack,
      attacker: attackerDetail,
      defender: defenderDetail,
    });

    defender.active.damage += damage;
    appendLog(store, `${attacker.name} used ${attack.name ?? "attack"} for ${damage} damage.`);

    applyAutoKnockoutCheck(store);
  });

  const endTurn = $(() => {
    if (store.phase !== "playing") return;
    if (!canAct(store, store.currentTurn, "end turn")) return;

    const next = (store.currentTurn === 0 ? 1 : 0) as 0 | 1;
    store.currentTurn = next;
    store.turnNumber += 1;
    store.turnDrawDone = false;
    store.players[next].energyAttachedThisTurn = false;
    appendLog(store, `${store.players[next].name} turn.`);
  });

  const selectPrize = $((playerIdx: 0 | 1, uid: string) => {
    store.selectedPrizeUid[playerIdx] = uid;
  });

  const revealSelectedPrize = $((playerIdx: 0 | 1) => {
    const uid = store.selectedPrizeUid[playerIdx];
    if (!uid) return;
    if (!store.revealedPrizeUids[playerIdx].includes(uid)) {
      store.revealedPrizeUids[playerIdx] = [...store.revealedPrizeUids[playerIdx], uid];
    }
  });

  const takeSelectedPrizeToHand = $((playerIdx: 0 | 1) => {
    const player = store.players[playerIdx];
    const uid = store.selectedPrizeUid[playerIdx];
    if (!uid) return;

    const card = removePrizeCard(player, uid);
    if (!card) return;

    player.hand.push(card);
    store.revealedPrizeUids[playerIdx] = store.revealedPrizeUids[playerIdx].filter((x) => x !== uid);
    store.selectedPrizeUid[playerIdx] = null;
    appendLog(store, `${player.name} took a selected Prize card to hand.`);
  });

  const onDragStart = $((ev: DragEvent, payload: DragPayload) => {
    const dt = ev.dataTransfer;
    if (!dt) return;
    dt.effectAllowed = "move";
    dt.setData("application/x-sim-card", JSON.stringify(payload));
  });

  const allowDrop = $((ev: DragEvent) => {
    ev.preventDefault();
  });

  const onDropActive = $((ev: DragEvent, targetPlayerIdx: 0 | 1) => {
    ev.preventDefault();
    const payload = readDragPayload(ev);
    if (!payload) return;

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
      appendLog(store, `${targetPlayer.name} switched Active via drag-and-drop.`);
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
      if (store.rulesMode === "strict" && store.phase === "playing" && targetPlayer.energyAttachedThisTurn) {
        sourcePlayer.hand.push(card);
        appendLog(store, `${targetPlayer.name} already attached Energy this turn.`);
        return;
      }
      targetPlayer.active.attached.push(card);
      if (store.phase === "playing") targetPlayer.energyAttachedThisTurn = true;
      appendLog(store, `${targetPlayer.name} attached ${card.card.name} to Active via drag-and-drop.`);
      return;
    }

    if (!isBasicPokemon(card.card)) {
      sourcePlayer.hand.push(card);
      return;
    }

    if (!targetPlayer.active) {
      targetPlayer.active = makePokemonInPlay(card);
      appendLog(store, `${targetPlayer.name} set Active via drag-and-drop.`);
    } else {
      sourcePlayer.hand.push(card);
    }
  });

  const onDropBench = $((ev: DragEvent, targetPlayerIdx: 0 | 1) => {
    ev.preventDefault();
    const payload = readDragPayload(ev);
    if (!payload || payload.zone !== "hand" || payload.playerIdx !== targetPlayerIdx) return;

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
    appendLog(store, `${targetPlayer.name} benched ${card.card.name} via drag-and-drop.`);
  });

  const onDropDiscard = $((ev: DragEvent, targetPlayerIdx: 0 | 1) => {
    ev.preventDefault();
    const payload = readDragPayload(ev);
    if (!payload || payload.playerIdx !== targetPlayerIdx || payload.zone !== "hand") return;

    const targetPlayer = store.players[targetPlayerIdx];
    const card = removeHandCard(targetPlayer, payload.uid);
    if (!card) return;
    targetPlayer.discard.push(card);
    appendLog(store, `${targetPlayer.name} discarded ${card.card.name} via drag-and-drop.`);
  });

  const onDropHand = $((ev: DragEvent, targetPlayerIdx: 0 | 1) => {
    ev.preventDefault();
    const payload = readDragPayload(ev);
    if (!payload || payload.playerIdx !== targetPlayerIdx || payload.zone !== "prize") return;

    const player = store.players[targetPlayerIdx];
    const card = removePrizeCard(player, payload.uid);
    if (!card) return;
    player.hand.push(card);

    store.revealedPrizeUids[targetPlayerIdx] = store.revealedPrizeUids[targetPlayerIdx].filter((x) => x !== payload.uid);
    appendLog(store, `${player.name} moved a revealed Prize to hand via drag-and-drop.`);
  });

  const currentPlayer = store.players[store.currentTurn];
  const topPlayerIdx = store.phase === "playing" ? ((store.currentTurn === 0 ? 1 : 0) as 0 | 1) : 1;
  const bottomPlayerIdx = store.phase === "playing" ? store.currentTurn : 0;
  const boardOrder: [0 | 1, 0 | 1] = [topPlayerIdx, bottomPlayerIdx];

  return (
    <div class="simulator-page selfplay-page">
      <section class="simulator-header">
        <h1>Pokemon TCG Self-Play Simulator</h1>
        <p>
          Two-deck self-play board with setup flow, drag-and-drop zones, prize controls,
          and strict/manual turn enforcement.
        </p>
      </section>

      <section class="simulator-controls">
        <button class="sim-btn sim-btn--primary" disabled={store.loading} onClick$={startSetup}>
          {store.loading ? "Loading decks..." : "Run Setup (Load Decks + Mulligans)"}
        </button>
        <button class="sim-btn" disabled={store.phase !== "setup"} onClick$={finalizeSetup}>
          Finalize Setup
        </button>
        <button class="sim-btn" onClick$={toggleRulesMode}>
          Rules: {store.rulesMode === "strict" ? "Strict" : "Manual"}
        </button>
        <button class="sim-btn" disabled={store.phase !== "playing"} onClick$={() => drawCard(store.currentTurn)}>
          Draw (Current)
        </button>
        <button class="sim-btn sim-btn--danger" disabled={store.phase !== "playing"} onClick$={useAttack}>
          Attack
        </button>
        <button class="sim-btn" disabled={store.phase !== "playing"} onClick$={endTurn}>
          End Turn
        </button>
        <span class="turn-indicator">
          Phase: {store.phase} | Turn: {currentPlayer.name} | Turn #{store.turnNumber}
          {store.coinFlipResult ? ` | Coin: ${store.coinFlipResult}` : ""}
          {store.winner ? ` | Winner: ${store.winner}` : ""}
        </span>
      </section>

      <section class="deck-import-grid">
        <article class="sim-card">
          <h2>Player 1 Deck (60)</h2>
          <textarea
            class="deck-input"
            value={store.deckInput1}
            onInput$={(ev) => {
              store.deckInput1 = (ev.target as HTMLTextAreaElement).value;
            }}
          />
        </article>

        <article class="sim-card">
          <h2>Player 2 Deck (60)</h2>
          <textarea
            class="deck-input"
            value={store.deckInput2}
            onInput$={(ev) => {
              store.deckInput2 = (ev.target as HTMLTextAreaElement).value;
            }}
          />
        </article>
      </section>

      <section class={{ "board-layout": true, "board-layout--flipped": store.phase === "playing" && store.currentTurn === 1 }}>
        {boardOrder.map((pIdx, orderIdx) => {
          const player = store.players[pIdx];
          const selectedUid = store.selectedHandUid[pIdx];
          const selectedPrize = store.selectedPrizeUid[pIdx];
          const isTop = orderIdx === 0;
          const seatLabel =
            store.phase === "playing"
              ? (pIdx === store.firstPlayer ? "First Player" : "Second Player")
              : (pIdx === 0 ? "Player 1" : "Player 2");

          return (
            <div key={`player-board-${pIdx}-${store.currentTurn}`} class="board-slot">
              <article class={{ "sim-card": true, "board-player": true, "board-player--top": isTop, "board-player--bottom": !isTop }}>
              <div class="board-player__header">
                <h2>
                  {player.name} ({seatLabel})
                </h2>
                <p>
                  Deck {player.deck.length} | Hand {player.hand.length} | Prizes {player.prizes.length} | Discard {player.discard.length} | Mulligans {player.mulligans}
                </p>
              </div>

              <div class="mat-layout">
                <div class="mat-left zone-block zone-block--stack">
                  <strong>Prize Cards</strong>
                  <div class="prize-grid prize-grid--stack">
                    {player.prizes.map((prize) => {
                      const revealed = store.revealedPrizeUids[pIdx].includes(prize.uid);
                      return (
                        <button
                          key={prize.uid}
                          class={{
                            "prize-card": true,
                            "prize-card--selected": selectedPrize === prize.uid,
                          }}
                          onClick$={() => selectPrize(pIdx, prize.uid)}
                          draggable={revealed}
                          onDragStart$={(ev) => onDragStart(ev, { playerIdx: pIdx, zone: "prize", uid: prize.uid })}
                        >
                          {revealed ? (
                            <img src={imageUrl(prize.card.image) ?? ""} alt={prize.card.name} />
                          ) : (
                            <span>Hidden</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div class="btn-row">
                    <button class="sim-btn" onClick$={() => revealSelectedPrize(pIdx)}>Reveal Selected</button>
                    <button class="sim-btn" onClick$={() => takeSelectedPrizeToHand(pIdx)}>Take Selected</button>
                  </div>
                </div>

                <div class="mat-center">
                  <div
                    class="active-zone"
                    onDragOver$={allowDrop}
                    onDrop$={(ev) => onDropActive(ev, pIdx)}
                  >
                    <h3>Active Pokemon</h3>
                    {player.active ? (
                      <div class="play-card">
                        <img src={imageUrl(player.active.base.card.image) ?? ""} alt={player.active.base.card.name} />
                        <div class="play-card__meta">
                          <p>{cardTitle(player.active.base.card)}</p>
                          <p>Damage: {player.active.damage}</p>
                          <p>Energy: {player.active.attached.length}</p>
                          <div class="btn-row">
                            <button class="sim-btn" onClick$={() => changeDamage(pIdx, "active", 10)}>+10</button>
                            <button class="sim-btn" onClick$={() => changeDamage(pIdx, "active", -10)}>-10</button>
                            <button class="sim-btn" onClick$={() => attachSelectedEnergyTo(pIdx, "active")}>Attach Selected Energy</button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div class="slot-empty">No Active Pokemon</div>
                    )}
                  </div>

                  <div class="stadium-zone">
                    <span>Stadium Zone</span>
                  </div>

                  <div
                    class="bench-zone"
                    onDragOver$={allowDrop}
                    onDrop$={(ev) => onDropBench(ev, pIdx)}
                  >
                    <h3>Bench</h3>
                    <div class="bench-grid">
                      {player.bench.map((bench, bIdx) => (
                        <div
                          key={bench.uid}
                          class="bench-card"
                          draggable={true}
                          onDragStart$={(ev) => onDragStart(ev, { playerIdx: pIdx, zone: "bench", uid: bench.uid })}
                        >
                          <img src={imageUrl(bench.base.card.image) ?? ""} alt={bench.base.card.name} />
                          <p>{bench.base.card.name}</p>
                          <p>Dmg {bench.damage} | E {bench.attached.length}</p>
                          <div class="btn-row">
                            <button class="sim-btn" onClick$={() => switchWithBench(pIdx, bIdx)}>Make Active</button>
                            <button class="sim-btn" onClick$={() => attachSelectedEnergyTo(pIdx, bIdx)}>Attach Energy</button>
                            <button class="sim-btn" onClick$={() => changeDamage(pIdx, bIdx, 10)}>+10</button>
                            <button class="sim-btn" onClick$={() => changeDamage(pIdx, bIdx, -10)}>-10</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {store.phase === "playing" && store.currentTurn === pIdx && player.active && (
                    <div class="attack-panel">
                      <h3>Selected Attack</h3>
                      {!store.detailCache[player.active.base.card.id] && (
                        <button class="sim-btn" onClick$={() => loadCardDetail(player.active!.base.card.id)}>
                          Load attacks
                        </button>
                      )}
                      {store.detailCache[player.active.base.card.id] && (
                        <select
                          class="attack-select"
                          value={String(store.selectedAttackIndex[pIdx])}
                          onChange$={(ev) => setAttackIndex(pIdx, parseInt((ev.target as HTMLSelectElement).value, 10) || 0)}
                        >
                          {getCardAttacks(store.detailCache[player.active.base.card.id]).map((atk, aIdx) => (
                            <option key={`${player.active!.base.card.id}-${atk.name}-${aIdx}`} value={aIdx}>
                              {`${atk.name ?? "Attack"}${atk.damage ? ` (${String(atk.damage)})` : ""}`}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>

                <div class="mat-right">
                  <div class="zone-block zone-block--stack">
                    <strong>Discard Pile</strong>
                    <div
                      class="discard-drop"
                      onDragOver$={allowDrop}
                      onDrop$={(ev) => onDropDiscard(ev, pIdx)}
                    >
                      {player.discard.length} cards
                    </div>
                  </div>
                  <div class="zone-block zone-block--stack">
                    <strong>Deck</strong>
                    <span>{player.deck.length} cards</span>
                    <button class="sim-btn" onClick$={() => drawCard(pIdx)}>Draw</button>
                  </div>
                </div>
              </div>

              <div
                class="hand-zone"
                onDragOver$={allowDrop}
                onDrop$={(ev) => onDropHand(ev, pIdx)}
              >
                <h3>Hand (drop revealed Prize here)</h3>
                <div class="hand-row">
                  {player.hand.map((card) => (
                    <button
                      key={card.uid}
                      class={{
                        "hand-card": true,
                        "hand-card--selected": selectedUid === card.uid,
                      }}
                      onClick$={() => selectHandCard(pIdx, card.uid)}
                      draggable={true}
                      onDragStart$={(ev) => onDragStart(ev, { playerIdx: pIdx, zone: "hand", uid: card.uid })}
                    >
                      <img src={imageUrl(card.card.image) ?? ""} alt={card.card.name} />
                      <span>{card.card.name}</span>
                    </button>
                  ))}
                </div>
                <div class="btn-row">
                  <button class="sim-btn" onClick$={() => setSelectedActive(pIdx)}>Play Selected to Active</button>
                  <button class="sim-btn" onClick$={() => setSelectedBench(pIdx)}>Play Selected to Bench</button>
                  <button class="sim-btn" onClick$={() => discardSelectedCard(pIdx)}>Discard Selected</button>
                </div>
              </div>
              </article>
              {orderIdx === 0 && (
                <div class="board-divider">
                  <span>BATTLEFIELD</span>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section class="sim-card sim-card--log">
        <h2>Game Log</h2>
        <ul>
          {store.logs.map((line, idx) => (
            <li key={`log-${idx}-${line}`}>{line}</li>
          ))}
        </ul>
      </section>
    </div>
  );
});

export const head: DocumentHead = {
  title: "Luminous — Self-Play Simulator",
  meta: [
    {
      name: "description",
      content:
        "Play both sides of a Pokemon TCG match with setup, drag-and-drop board zones, and strict/manual rules.",
    },
  ],
};
