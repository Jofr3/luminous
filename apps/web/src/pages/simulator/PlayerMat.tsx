import { imageUrl } from "~/lib/api";
import { getCardAttacks } from "~/lib/simulator";
import { Draggable, Droppable } from "./DndComponents";
import type { SimulatorActions, SimulatorStore } from "./types";

interface PlayerMatProps {
  pIdx: 0 | 1;
  isTop: boolean;
  store: SimulatorStore;
  actions: SimulatorActions;
}

export function PlayerMat({ pIdx, isTop, store, actions }: PlayerMatProps) {
  const player = store.players[pIdx];
  const selectedUid = store.selectedHandUid[pIdx];
  const selectedPrize = store.selectedPrizeUid[pIdx];

  return (
    <div
      key={`player-board-${pIdx}-${store.currentTurn}`}
      className={`mat-half ${isTop ? "mat-half--top" : "mat-half--bottom"}`}
    >
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
              <div className="play-card-wrapper" />
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
    </div>
  );
}
