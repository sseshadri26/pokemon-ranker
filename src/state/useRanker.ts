import { useCallback, useMemo, useRef, useState } from "react";
import type { Pokemon } from "../data/types";
import { toTrait } from "../data/pokedex";
import { buildDesignMatrix, extendedExtractors } from "../model/features";
import { fitBradleyTerry, type Fit } from "../model/fit";
import {
  comparisonCounts,
  parseHistory,
  ratedComparisons,
  undo,
  type Answer,
  type AnswerOutcome,
} from "../model/history";
import { selectNextPair, type SelectedPair } from "../model/select";
import { rankingSummary, type RankingSummary } from "../model/summary";
import { historyFile, loadHistory, saveHistory } from "./storage";

export type RankedRow = {
  pokemon: Pokemon;
  score: number;
  sd: number;
  games: number;
  rank: number;
};

export function useRanker(pokemon: readonly Pokemon[]) {
  const [history, setHistory] = useState<Answer[]>(() => loadHistory());
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);

  const design = useMemo(
    () => buildDesignMatrix(pokemon.map(toTrait), extendedExtractors),
    [pokemon],
  );
  const rated = useMemo(() => ratedComparisons(history), [history]);
  const warm = useRef<{ w: Float64Array; b: Float64Array } | null>(null);

  const fit: Fit = useMemo(() => {
    const next = fitBradleyTerry(design, rated, {
      warm: warm.current ?? undefined,
      maxIter: 18,
    });
    warm.current = { w: Float64Array.from(next.weights), b: Float64Array.from(next.offset) };
    return next;
  }, [design, rated]);

  const games = useMemo(() => comparisonCounts(history, fit.ids), [history, fit.ids]);
  const summary: RankingSummary = useMemo(() => rankingSummary(fit, design), [fit, design]);
  const byId = useMemo(() => new Map(pokemon.map((p) => [p.id, p])), [pokemon]);

  const pair: SelectedPair | null = useMemo(() => {
    const last = history[history.length - 1];
    return selectNextPair(
      {
        ids: fit.ids,
        strength: fit.strength,
        offsetVar: fit.offsetVar,
        traitCoords: fit.traitCoords,
      },
      {
        explore: 0.12,
        games,
        avoid: last ? [last.a, last.b] : undefined,
      },
    );
  }, [fit, games, history]);

  const rows: RankedRow[] = useMemo(() => {
    const ranked = fit.ids.map((id, index) => ({
      pokemon: byId.get(id)!,
      score: fit.strength[index],
      sd: fit.sd[index],
      games: games[index] ?? 0,
    }));
    ranked.sort((a, b) => b.score - a.score || a.pokemon.id - b.pokemon.id);
    return ranked.map((row, index) => ({ ...row, rank: index + 1 }));
  }, [byId, fit, games]);

  const leans = useMemo(() => {
    return fit.featureNames
      .map((name, index) => ({ name, weight: fit.weights[index] }))
      .filter((trait) => trait.name.startsWith("type:"))
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
      .slice(0, 4);
  }, [fit]);

  const commit = useCallback((next: Answer[]) => {
    setHistory(next);
    try {
      saveHistory(next);
    } catch {
      setNotice("Could not save to this browser's storage.");
    }
  }, []);

  const answer = useCallback(
    (outcome: AnswerOutcome) => {
      if (!pair || lock.current) return;
      lock.current = true;
      commit([...history, { a: pair.a, b: pair.b, outcome, at: Date.now() }]);
    },
    [commit, history, pair],
  );

  const undoLast = useCallback(() => {
    if (history.length === 0) return;
    lock.current = true;
    commit(undo(history));
  }, [commit, history]);

  const reset = useCallback(() => {
    lock.current = true;
    commit([]);
    setNotice(null);
  }, [commit]);

  const importText = useCallback(
    (text: string) => {
      const next = parseHistory(text);
      lock.current = true;
      commit(next);
      setNotice(`Imported ${next.length.toLocaleString()} answers.`);
    },
    [commit],
  );

  const exportText = useCallback(() => historyFile(history), [history]);

  if (pair) lock.current = false;

  return {
    history,
    pair,
    rows,
    summary,
    leans,
    notice,
    setNotice,
    answer,
    undoLast,
    reset,
    importText,
    exportText,
    byId,
  };
}
