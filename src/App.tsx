import { useRef, useState } from "react";
import { POKEDEX } from "./data/pokedex";
import { useRanker } from "./state/useRanker";
import { Matchup } from "./ui/Matchup";
import { Rankings } from "./ui/Rankings";

export function App() {
  const [view, setView] = useState<"duel" | "board">("duel");
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ranker = useRanker(POKEDEX);
  const left = ranker.pair ? ranker.byId.get(ranker.pair.a) : undefined;
  const right = ranker.pair ? ranker.byId.get(ranker.pair.b) : undefined;
  const confidence = Math.round(ranker.summary.confidence * 100);
  const bound = Math.round(ranker.summary.lowerBoundBits).toLocaleString();

  const exportHistory = () => {
    const blob = new Blob([ranker.exportText()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "favordex-history.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app">
      <header>
        <div className="brand">
          <p className="eyebrow">National Dex, by affection</p>
          <h1>Favordex</h1>
        </div>
        <div className="progress">
          <p data-testid="matchup-count">
            {ranker.summary.matchups.toLocaleString()} {ranker.summary.matchups === 1 ? "matchup" : "matchups"}
          </p>
          <div className="meter" data-testid="confidence" title={`${confidence}% of prior uncertainty has been resolved`}>
            <span style={{ width: `${confidence}%` }} />
          </div>
          <p className="bound">
            {confidence}% confidence · noiseless sort needs about {bound} comparisons
          </p>
        </div>
        <nav>
          <button type="button" className={view === "duel" ? "on" : ""} onClick={() => setView("duel")}>
            Duel
          </button>
          <button type="button" className={view === "board" ? "on" : ""} onClick={() => setView("board")}>
            Rankings
          </button>
          <button type="button" onClick={exportHistory}>
            Export
          </button>
          <button type="button" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <button type="button" onClick={() => setConfirming(true)}>
            Reset
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="Import history"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              try {
                ranker.importText(await file.text());
              } catch (error) {
                ranker.setNotice(error instanceof Error ? error.message : "Could not import that file.");
              }
            }}
          />
        </nav>
      </header>
      {ranker.notice && (
        <p className="notice" role="status">
          {ranker.notice}
          <button type="button" onClick={() => ranker.setNotice(null)}>
            Dismiss
          </button>
        </p>
      )}
      {view === "board" ? (
        <Rankings rows={ranker.rows} leans={ranker.leans} species={ranker.summary.species} />
      ) : left && right ? (
        <Matchup
          left={left}
          right={right}
          onAnswer={ranker.answer}
          onUndo={ranker.undoLast}
          canUndo={ranker.history.length > 0}
        />
      ) : (
        <p className="empty">The dex needs at least two species before a duel can start.</p>
      )}
      {confirming && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="reset-title">
          <div>
            <h2 id="reset-title">Erase every answer?</h2>
            <p>This clears the ranking stored in this browser. Export first if you want a copy.</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setConfirming(false)}>
                Keep them
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  ranker.reset();
                  setConfirming(false);
                  setView("duel");
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
