import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { imageUrl } from "~/lib/api";
import { PlayerMat } from "./PlayerMat";
import { Draggable, Droppable } from "./DndComponents";
import type { DragPayload, SimulatorStore, SimulatorActions } from "./types";

interface SimulatorBoardProps {
  store: SimulatorStore;
  actions: SimulatorActions;
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

  const otherPlayerIdx = (store.currentTurn === 0 ? 1 : 0) as 0 | 1;
  const currentPlayer = store.players[store.currentTurn];
  const selectedUid = store.selectedHandUid[store.currentTurn];
  const active = currentPlayer.active;
  const attacks = active?.base.card.attacks ?? [];
  const abilities = active?.base.card.abilities ?? [];
  const isPlaying = store.phase === "playing";
  const isCurrentTurn = true; // controls always show current player
  const canAttackThisTurn = isPlaying && isCurrentTurn
    && !(store.turnNumber === 1 && store.currentTurn === store.firstPlayer);

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="sim">
        <div className="play-area">
          <div className="board">
            <section className="mat">
              <PlayerMat
                pIdx={otherPlayerIdx}
                isTop={true}
                store={store}
                actions={actions}
              />

              <div className="stadium">
                <div className="slot" data-label="STADIUM">
                  {store.stadium && (
                    <div className="card-wrap">
                      <img
                        src={imageUrl(store.stadium.card.card.image) ?? ""}
                        alt={store.stadium.card.card.name}
                        className="card-img"
                      />
                    </div>
                  )}
                </div>
              </div>

              <PlayerMat
                pIdx={store.currentTurn}
                isTop={false}
                store={store}
                actions={actions}
              />
            </section>
            <div className="side">
              <button
                className="btn new-game"
                disabled={store.loading}
                onClick={actions.newGame}
                title="Create a new game from the current decklists"
              >
                New Game
              </button>
              <button
                className={`btn end-turn ${store.phase === "setup" && !currentPlayer.active ? "needs-active" : ""}`}
                disabled={store.phase === "idle" || (store.phase === "setup" && !currentPlayer.active)}
                onClick={actions.endTurn}
                title="End Turn"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                  <path d="M21 3v5h-5"/>
                </svg>
              </button>
            </div>
          </div>

          <div className="controls">
            {/* Action panel: attacks, abilities, retreat */}
            {isPlaying && active && (
              <div className="action-panel">
                {/* Attacks */}
                {attacks.length > 0 && (
                  <div className="action-group">
                    <span className="action-label">Attacks</span>
                    {attacks.map((atk, i) => (
                      <button
                        key={`atk-${i}`}
                        className="action-btn attack-btn"
                        disabled={!canAttackThisTurn}
                        onClick={() => void actions.useAttack(i)}
                        title={atk.effect ?? atk.name}
                      >
                        <span className="action-name">{atk.name}</span>
                        {atk.damage != null && atk.damage !== 0 && (
                          <span className="action-damage">{atk.damage}</span>
                        )}
                        {atk.cost && atk.cost.length > 0 && (
                          <span className="action-cost">
                            {atk.cost.map((c, j) => (
                              <span key={j} className={`energy-pip ${c.toLowerCase()}`} title={c} />
                            ))}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Abilities */}
                {abilities.length > 0 && (
                  <div className="action-group">
                    <span className="action-label">Abilities</span>
                    {abilities.map((ab, i) => (
                      <button
                        key={`ab-${i}`}
                        className="action-btn ability-btn"
                        disabled={active.usedAbilityThisTurn}
                        onClick={() => void actions.useAbility(active.uid, i)}
                        title={ab.effect}
                      >
                        <span className="action-type">{ab.type}</span>
                        <span className="action-name">{ab.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Retreat */}
                {currentPlayer.bench.length > 0 && (
                  <div className="action-group">
                    <span className="action-label">
                      Retreat ({active.base.card.retreat ?? 0})
                    </span>
                    {currentPlayer.bench.map((bp) => (
                      <button
                        key={bp.uid}
                        className="action-btn retreat-btn"
                        disabled={currentPlayer.retreatedThisTurn}
                        onClick={() => void actions.retreat(bp.uid)}
                        title={`Switch to ${bp.base.card.name}`}
                      >
                        {bp.base.card.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* Special Conditions indicator */}
                {(active.specialConditions?.length ?? 0) > 0 && (
                  <div className="action-group conditions">
                    <span className="action-label">Conditions</span>
                    {active.specialConditions.map((c) => (
                      <span key={c} className={`condition-badge ${c.toLowerCase()}`}>{c}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Droppable id={`hand:${store.currentTurn}`} className="hand">
              <div className="row">
                {currentPlayer.hand.map((card) => (
                  <button
                    key={card.uid}
                    className={`hand-card ${selectedUid === card.uid ? "selected" : ""}`}
                    onClick={() => void actions.selectHandCard(store.currentTurn, card.uid)}
                    onDoubleClick={() => {
                      if (card.card.category === "Trainer" && isPlaying) {
                        void actions.playTrainerCard(card.uid);
                      }
                    }}
                  >
                    <Draggable
                      id={`hand:${store.currentTurn}:${card.uid}`}
                      payload={{ playerIdx: store.currentTurn, zone: "hand", uid: card.uid }}
                      className="card-wrap"
                      style={{ width: "100%", height: "100%" }}
                    >
                      <img src={imageUrl(card.card.image) ?? ""} alt={card.card.name} />
                    </Draggable>
                  </button>
                ))}
              </div>
            </Droppable>
          </div>
        </div>

        <aside className="logs-sidebar" aria-label="Game logs">
          <div className="logs-header">
            <div>
              <p className="logs-eyebrow">Match Feed</p>
              <h2>Game Logs</h2>
            </div>
            <span className="logs-count">{store.logs.length}</span>
          </div>
          <div className="logs-list">
            {store.logs.length === 0 ? (
              <p className="log-empty">No actions yet.</p>
            ) : (
              store.logs.map((log, index) => (
                <div key={`${index}-${log}`} className="log-entry">
                  <span className="log-index">{String(store.logs.length - index).padStart(2, "0")}</span>
                  <p>{log}</p>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </DndContext>
  );
}
