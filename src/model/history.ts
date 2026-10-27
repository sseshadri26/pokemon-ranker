import type { Comparison, Outcome } from "./fit";

/** A stored answer. Skips stay in the log so they can be undone and exported. */
export type AnswerOutcome = Outcome | "skip";

export type Answer = {
  a: number;
  b: number;
  outcome: AnswerOutcome;
  at: number;
};

export const EXPORT_VERSION = 1;

export type HistoryExport = {
  version: number;
  exportedAt: string;
  history: Answer[];
};

const OUTCOMES = new Set<AnswerOutcome>(["a", "b", "tie", "skip"]);

/** Comparisons that enter the Bradley–Terry fit. Skips record nothing. */
export function ratedComparisons(history: readonly Answer[]): Comparison[] {
  const rated: Comparison[] = [];
  for (const answer of history) {
    if (answer.outcome === "skip" || answer.a === answer.b) continue;
    rated.push({ a: answer.a, b: answer.b, outcome: answer.outcome });
  }
  return rated;
}

export function undo(history: readonly Answer[]): Answer[] {
  return history.slice(0, -1);
}

export function comparisonCounts(history: readonly Answer[], ids: readonly number[]): Int32Array {
  const index = new Map(ids.map((id, i) => [id, i]));
  const counts = new Int32Array(ids.length);
  for (const answer of history) {
    if (answer.outcome === "skip") continue;
    const ai = index.get(answer.a);
    const bi = index.get(answer.b);
    if (ai !== undefined) counts[ai] += 1;
    if (bi !== undefined) counts[bi] += 1;
  }
  return counts;
}

export function serializeHistory(history: readonly Answer[], now = new Date()): string {
  const payload: HistoryExport = {
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    history: history.map((answer) => ({
      a: answer.a,
      b: answer.b,
      outcome: answer.outcome,
      at: answer.at,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export function parseHistory(text: string): Answer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("History file is not valid JSON.");
  }
  const records = extractRecords(parsed);
  return records.map((record, index) => {
    if (!record || typeof record !== "object") {
      throw new Error(`History entry ${index + 1} is not an object.`);
    }
    const row = record as Record<string, unknown>;
    const a = row.a;
    const b = row.b;
    const outcome = row.outcome;
    const at = row.at;
    if (typeof a !== "number" || !Number.isInteger(a) || typeof b !== "number" || !Number.isInteger(b)) {
      throw new Error(`History entry ${index + 1} needs integer species ids.`);
    }
    if (a === b) throw new Error(`History entry ${index + 1} compares a species with itself.`);
    if (typeof outcome !== "string" || !OUTCOMES.has(outcome as AnswerOutcome)) {
      throw new Error(`History entry ${index + 1} has an unknown outcome.`);
    }
    const stamp = typeof at === "number" && Number.isFinite(at) ? at : Date.now();
    return { a, b, outcome: outcome as AnswerOutcome, at: stamp };
  });
}

function extractRecords(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { history?: unknown }).history)) {
    const version = (parsed as { version?: unknown }).version;
    if (version !== undefined && version !== EXPORT_VERSION) {
      throw new Error(`Unsupported history version ${String(version)}.`);
    }
    return (parsed as { history: unknown[] }).history;
  }
  throw new Error("History file needs a history array.");
}
