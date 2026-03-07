import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { CSSProperties, ReactNode } from "react";
import { imageUrl } from "~/lib/api";
import { getCardAttacks } from "~/lib/simulator";
import type { DragPayload, SimulatorStore } from "./types";

interface SimulatorActions {
  useAttack: () => Promise<void>;
  toggleDecklists: () => Promise<void>;
  toggleGameLog: () => Promise<void>;
  setDeckInput1: (value: string) => Promise<void>;
  setDeckInput2: (value: string) => Promise<void>;
  selectPrize: (playerIdx: 0 | 1, uid: string) => Promise<void>;
  revealSelectedPrize: (playerIdx: 0 | 1) => Promise<void>;
  takeSelectedPrizeToHand: (playerIdx: 0 | 1) => Promise<void>;
  dropToActive: (payload: DragPayload, targetPlayerIdx: 0 | 1) => Promise<void>;
  dropToBench: (payload: DragPayload, targetPlayerIdx: 0 | 1) => Promise<void>;
  dropToBenchSlot: (payload: DragPayload, targetPlayerIdx: 0 | 1, benchIdx: number) => Promise<void>;
  dropToDiscard: (payload: DragPayload, targetPlayerIdx: 0 | 1) => Promise<void>;
  dropToHand: (payload: DragPayload, targetPlayerIdx: 0 | 1) => Promise<void>;
  changeDamage: (playerIdx: 0 | 1, target: "active" | number, delta: number) => Promise<void>;
  attachSelectedEnergyTo: (playerIdx: 0 | 1, target: "active" | number) => Promise<void>;
  switchWithBench: (playerIdx: 0 | 1, benchIdx: number) => Promise<void>;
  selectHandCard: (playerIdx: 0 | 1, uid: string) => Promise<void>;
  setSelectedActive: (playerIdx: 0 | 1) => Promise<void>;
  setSelectedBench: (playerIdx: 0 | 1) => Promise<void>;
  discardSelectedCard: (playerIdx: 0 | 1) => Promise<void>;
  confirmSetup: () => Promise<void>;
  loadCardDetail: (cardId: string) => Promise<void>;
  setAttackIndex: (playerIdx: 0 | 1, index: number) => Promise<void>;
  endTurn: () => Promise<void>;
}

interface SimulatorBoardProps {
  store: SimulatorStore;
  actions: SimulatorActions;
}

function Draggable({
  id,
  payload,
  className,
  children,
  style,
}: {
  id: string;
  payload: DragPayload;
  className?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id,
    data: payload,
  });

  const dragStyle: CSSProperties = {
    ...style,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    touchAction: "none",
  };

  return (
    <div
      ref={setNodeRef}
      className={className}
      style={dragStyle}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

function Droppable({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={className}>
      {children}
    </div>
  );
}

export function SimulatorBoard({ store, actions }: SimulatorBoardProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const payload = event.active.data.current as DragPayload | undefined;
    const overId = event.over?.id;
    if (!payload || !overId) return;

    const target = String(overId);
    if (target.startsWith("active:")) {
      const playerIdx = Number(target.split(":")[1]) as 0 | 1;
      void actions.dropToActive(payload, playerIdx);
      return;
    }
    if (target.startsWith("bench-slot:")) {
      const [, p, b] = target.split(":");
      void actions.dropToBenchSlot(payload, Number(p) as 0 | 1, Number(b));
      return;
    }
    if (target.startsWith("bench:")) {
      const playerIdx = Number(target.split(":")[1]) as 0 | 1;
      void actions.dropToBench(payload, playerIdx);
      return;
    }
    if (target.startsWith("discard:")) {
      const playerIdx = Number(target.split(":")[1]) as 0 | 1;
      void actions.dropToDiscard(payload, playerIdx);
      return;
    }
    if (target.startsWith("hand:")) {
      const playerIdx = Number(target.split(":")[1]) as 0 | 1;
      void actions.dropToHand(payload, playerIdx);
    }
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="simulator-page selfplay-page">
        <div className="mat-toolbar">
          <div className="mat-toolbar__left">
            <button className="sim-btn sim-btn--danger" disabled={store.phase !== "playing"} onClick={actions.useAttack}>
              Attack
            </button>
          </div>
          <div className="mat-toolbar__right">
            <button
              className={`sim-btn ${store.showDecklists ? "sim-btn--toggled" : ""}`}
              onClick={() => void actions.toggleDecklists()}
            >
              Decklists
            </button>
            <button
              className={`sim-btn ${store.showGameLog ? "sim-btn--toggled" : ""}`}
              onClick={() => void actions.toggleGameLog()}
            >
              Log
            </button>
          </div>
        </div>

        <div className="playmat-wrapper">
          <section className="playmat">
            {/* Shared Stadium */}
            <div className="zone-stadium shared-stadium">
              <div className="card-slot" data-label="Stadium" />
            </div>

            {([
              ((store.currentTurn === 0 ? 1 : 0) as 0 | 1),
              store.currentTurn,
            ] as [0 | 1, 0 | 1]).map((pIdx, orderIdx) => {
              const player = store.players[pIdx];
              const selectedUid = store.selectedHandUid[pIdx];
              const selectedPrize = store.selectedPrizeUid[pIdx];
              const isTop = orderIdx === 0;
              const seatLabel =
                store.phase === "playing"
                  ? (pIdx === store.firstPlayer ? "1st" : "2nd")
                  : (pIdx === 0 ? "P1" : "P2");

              return (
                <div
                  key={`player-board-${pIdx}-${store.currentTurn}`}
                  className={`mat-half ${isTop ? "mat-half--top" : "mat-half--bottom"}`}
                >
                  <div className="mat-half__header">
                    <span className="mat-half__name">{player.name} ({seatLabel})</span>
                  </div>

                  <div className="mat-grid">
                    <div className="zone-prizes">
                      <div className="prizes-container">
                        {Array.from({ length: 6 }).map((_, i) => {
                          const prize = player.prizes[i];
                          if (!prize) return <div key={`empty-prize-${i}`} className="card-slot" data-label="Prize" />;
                          const revealed = store.revealedPrizeUids[pIdx].includes(prize.uid);
                          return (
                            <button
                              key={prize.uid}
                              className={`card-slot card-slot--filled ${selectedPrize === prize.uid ? "card-slot--selected" : ""}`}
                              onClick={() => void actions.selectPrize(pIdx, prize.uid)}
                            >
                              {revealed ? (
                                <Draggable
                                  id={`prize:${pIdx}:${prize.uid}`}
                                  payload={{ playerIdx: pIdx, zone: "prize", uid: prize.uid }}
                                  className="play-card-wrapper"
                                  style={{ width: "100%", height: "100%" }}
                                >
                                  <img src={imageUrl(prize.card.image) ?? ""} alt={prize.card.name} className="play-card-img" />
                                </Draggable>
                              ) : (
                                <div className="card-back-icon">?</div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <div className="attack-panel">
                        <button className="sim-btn" onClick={() => void actions.revealSelectedPrize(pIdx)}>Reveal</button>
                        <button className="sim-btn" onClick={() => void actions.takeSelectedPrizeToHand(pIdx)}>Take</button>
                      </div>
                    </div>

                    <Droppable id={`active:${pIdx}`} className="zone-active">
                      {player.active ? (
                        <div className="card-slot card-slot--active">
                          <div className="play-card-wrapper">
                            <img src={imageUrl(player.active.base.card.image) ?? ""} alt={player.active.base.card.name} className="play-card-img" />
                            <div className="card-overlay card-overlay--damage">-{player.active.damage}</div>
                            <div className="card-overlay">Energy: {player.active.attached.length}</div>
                          </div>
                          <div className="attack-panel">
                            <button className="sim-btn" onClick={() => void actions.changeDamage(pIdx, "active", 10)}>+10</button>
                            <button className="sim-btn" onClick={() => void actions.changeDamage(pIdx, "active", -10)}>-10</button>
                            <button className="sim-btn" onClick={() => void actions.attachSelectedEnergyTo(pIdx, "active")}>Attach</button>
                          </div>
                        </div>
                      ) : (
                        <div className="card-slot card-slot--active" data-label="Active" />
                      )}
                    </Droppable>

                    <Droppable id={`bench:${pIdx}`} className="zone-bench">
                      <div className="bench-container">
                        {Array.from({ length: 5 }).map((_, i) => {
                          const bench = player.bench[i];
                          if (!bench) return <div key={`empty-bench-${i}`} className="card-slot" data-label="Bench" />;
                          return (
                            <Droppable key={bench.uid} id={`bench-slot:${pIdx}:${i}`} className="card-slot card-slot--filled">
                              <Draggable
                                id={`bench:${pIdx}:${bench.uid}`}
                                payload={{ playerIdx: pIdx, zone: "bench", uid: bench.uid }}
                                className="play-card-wrapper"
                                style={{ width: "100%", height: "100%" }}
                              >
                                <img src={imageUrl(bench.base.card.image) ?? ""} alt={bench.base.card.name} className="play-card-img" />
                                <div className="card-overlay card-overlay--damage">-{bench.damage}</div>
                                {bench.attached.length > 0 && (
                                  <div className="card-overlay">Energy: {bench.attached.length}</div>
                                )}
                              </Draggable>
                              <div className="attack-panel">
                                <button className="sim-btn" onClick={() => void actions.switchWithBench(pIdx, i)}>Swap</button>
                                <button className="sim-btn" onClick={() => void actions.attachSelectedEnergyTo(pIdx, i)}>Attach</button>
                                <button className="sim-btn" onClick={() => void actions.changeDamage(pIdx, i, 10)}>+10</button>
                              </div>
                            </Droppable>
                          );
                        })}
                      </div>
                    </Droppable>

                    <div className="zone-deck">
                      <div className="card-slot" data-label="Deck">
                        {player.deck.length > 0 && (
                          <div className="play-card-wrapper">
                            <div className="stack-count">{player.deck.length}</div>
                          </div>
                        )}
                      </div>
                    </div>

                    <Droppable id={`discard:${pIdx}`} className="zone-discard">
                      <div className="card-slot" data-label="Discard">
                        {player.discard.length > 0 && (
                          <div className="play-card-wrapper">
                            <img src={imageUrl(player.discard[player.discard.length - 1].card.image) ?? ""} alt="Discard" className="play-card-img" />
                            <div className="stack-count">{player.discard.length}</div>
                          </div>
                        )}
                      </div>
                    </Droppable>
                  </div>

                  {!isTop && (
                    <Droppable id={`hand:${pIdx}`} className="hand-container">
                      <div className="hand-row">
                        {player.hand.map((card) => (
                          <button
                            key={card.uid}
                            className={`hand-card-btn ${selectedUid === card.uid ? "hand-card-btn--selected" : ""}`}
                            onClick={() => void actions.selectHandCard(pIdx, card.uid)}
                          >
                            <Draggable
                              id={`hand:${pIdx}:${card.uid}`}
                              payload={{ playerIdx: pIdx, zone: "hand", uid: card.uid }}
                              className="play-card-wrapper"
                              style={{ width: "100%", height: "100%" }}
                            >
                              <img src={imageUrl(card.card.image) ?? ""} alt={card.card.name} />
                            </Draggable>
                          </button>
                        ))}
                      </div>
                      <div className="attack-panel">
                        <button className="sim-btn" onClick={() => void actions.setSelectedActive(pIdx)}>To Active</button>
                        <button className="sim-btn" onClick={() => void actions.setSelectedBench(pIdx)}>To Bench</button>
                        <button className="sim-btn sim-btn--danger" onClick={() => void actions.discardSelectedCard(pIdx)}>Discard</button>
                      </div>
                    </Droppable>
                  )}

                  {!isTop && store.phase === "setup" && store.currentTurn === pIdx && (
                    <div className="mat-panel setup-ready-panel">
                      <button className="sim-btn sim-btn--primary" onClick={actions.confirmSetup}>
                        Ready
                      </button>
                    </div>
                  )}

                  {!isTop && store.phase === "playing" && store.currentTurn === pIdx && player.active && (
                    <div className="mat-panel attack-panel-main">
                      {!store.detailCache[player.active.base.card.id] ? (
                        <button className="sim-btn sim-btn--primary" onClick={() => void actions.loadCardDetail(player.active!.base.card.id)}>
                          Load attacks
                        </button>
                      ) : (
                        <div className="attack-controls">
                          <select
                            className="attack-select"
                            value={String(store.selectedAttackIndex[pIdx])}
                            onChange={(ev) => void actions.setAttackIndex(pIdx, parseInt((ev.target as HTMLSelectElement).value, 10) || 0)}
                          >
                            {getCardAttacks(store.detailCache[player.active.base.card.id]).map((atk, aIdx) => (
                              <option key={`${player.active!.base.card.id}-${atk.name}-${aIdx}`} value={aIdx}>
                                {`${atk.name ?? "Attack"}${atk.damage ? ` (${String(atk.damage)})` : ""}`}
                              </option>
                            ))}
                          </select>
                          <button className="sim-btn sim-btn--danger" onClick={actions.useAttack}>Use Attack</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
          <div className="playmat-side-actions">
            <button className="sim-btn sim-btn--end-turn" disabled={store.phase !== "playing"} onClick={actions.endTurn}>
              End Turn
            </button>
          </div>
        </div>

        {store.showGameLog && (
          <section className="mat-panel mat-panel--log">
            <h3>Game Log</h3>
            <ul>
              {store.logs.map((line, idx) => (
                <li key={`log-${idx}-${line}`}>{line}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </DndContext>
  );
}
