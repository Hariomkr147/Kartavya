import type { Database } from "./types";
import { createSeedData } from "./seed";

const STORAGE_KEY = "kartavya-mock-db-v1";

function loadFromStorage(): Database | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Database) : null;
  } catch {
    return null;
  }
}

function freshSeed(): Database {
  return structuredClone(createSeedData());
}

/**
 * The single mutable mock database. Reassigned (not mutated in place) by
 * `resetDatabase()` — every other module imports `db` as a live ES module
 * binding, so they automatically see the new reference after a reset.
 */
export let db: Database = loadFromStorage() ?? freshSeed();

/** Call after every mutation so a page refresh doesn't lose demo state. */
export function persist(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

/** Wipes all local state and reloads the original seed dataset. */
export function resetDatabase(): void {
  db = freshSeed();
  persist();
}

export function nextId(table: keyof Database["nextId"]): number {
  const id = (db.nextId[table] ?? 0) + 1;
  db.nextId[table] = id;
  return id;
}
