import {
  parseHistory,
  serializeHistory,
  type Answer,
} from "../model/history";

const KEY = "favordex.history.v1";

export function loadHistory(): Answer[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return parseHistory(raw);
  } catch {
    return [];
  }
}

export function saveHistory(history: readonly Answer[]): void {
  localStorage.setItem(KEY, JSON.stringify(history));
}

export function historyFile(history: readonly Answer[]): string {
  return serializeHistory(history);
}
