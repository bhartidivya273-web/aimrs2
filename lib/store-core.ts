import { PEOPLE, type PersonName, type PersonPreference, type StorageKind } from "./types";

/**
 * Storage model shared by every backend (Supabase tables, or the in-memory fallback):
 *   preferences:   one record per person (never includes confirmedOptionId), with a version
 *   confirmations: one { optionId, version } per person
 *
 * A confirmation counts only while its `version` equals the person's current preferences
 * version (`updatedAt`). Confirm never writes the preference record, and saving preferences
 * bumps the version, so an edit that races a confirm can neither be lost nor leave a
 * stale "I'm in" behind. Every write touches only one person's rows.
 */
export interface PreferenceStore {
  kind: StorageKind;
  /** Records sorted in PEOPLE order, with confirmedOptionId merged in when still valid. */
  getAll(): Promise<PersonPreference[]>;
  /** Upsert one person's record and clear their confirmation. */
  putPreference(pref: PersonPreference): Promise<void>;
  /** Set (optionId) or clear (null) a confirmation made against preferences `version`. */
  setConfirmation(name: PersonName, optionId: string | null, version: string): Promise<void>;
  clear(): Promise<void>;
}

export interface StoredConfirmation {
  optionId: string;
  version: string;
}

export const versionOf = (p: PersonPreference) => p.updatedAt ?? "";

/**
 * Builds the app's view from raw stored rows: unknown names and malformed rows are
 * dropped, and a confirmation is attached only if its version matches.
 */
export function mergeRecords(
  prefs: Partial<Record<string, PersonPreference | null>>,
  confirms: Partial<Record<string, StoredConfirmation | null>>,
): PersonPreference[] {
  const out: PersonPreference[] = [];
  for (const name of PEOPLE) {
    const raw = prefs[name];
    if (!raw || typeof raw !== "object" || raw.name !== name) continue;
    const pref: PersonPreference = { ...raw };
    delete pref.confirmedOptionId; // ignore any legacy inline value
    const c = confirms[name];
    if (c && typeof c.optionId === "string" && c.version === versionOf(pref)) {
      pref.confirmedOptionId = c.optionId;
    }
    out.push(pref);
  }
  return out;
}

// ---------- In-memory fallback (also the test double for store logic) ----------

/** Minimal async hash operations, so tests can inject latency or pause writes. */
export interface HashBackend {
  hgetall(key: string): Promise<Record<string, unknown> | null>;
  hset(key: string, field: string, value: string): Promise<void>;
  hdel(key: string, field: string): Promise<void>;
  del(...keys: string[]): Promise<void>;
}

const PREFS_KEY = "group-trip:preferences";
const CONFIRMS_KEY = "group-trip:confirmations";

function parse<T>(v: unknown): T | null {
  if (typeof v !== "string") return (v ?? null) as T | null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

const parseAll = <T,>(h: Record<string, unknown> | null) =>
  Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k, parse<T>(v)]));

export function createStore(kind: StorageKind, db: HashBackend): PreferenceStore {
  return {
    kind,
    async getAll() {
      const [prefsRaw, confirmsRaw] = await Promise.all([db.hgetall(PREFS_KEY), db.hgetall(CONFIRMS_KEY)]);
      return mergeRecords(parseAll<PersonPreference>(prefsRaw), parseAll<StoredConfirmation>(confirmsRaw));
    },
    async putPreference(pref) {
      const { confirmedOptionId: _drop, ...record } = pref;
      await db.hset(PREFS_KEY, pref.name, JSON.stringify(record));
      await db.hdel(CONFIRMS_KEY, pref.name);
    },
    async setConfirmation(name, optionId, version) {
      if (optionId === null) await db.hdel(CONFIRMS_KEY, name);
      else await db.hset(CONFIRMS_KEY, name, JSON.stringify({ optionId, version } satisfies StoredConfirmation));
    },
    async clear() {
      await db.del(PREFS_KEY, CONFIRMS_KEY);
    },
  };
}

export function memoryBackend(data = new Map<string, Map<string, string>>()): HashBackend {
  return {
    async hgetall(key) {
      const h = data.get(key);
      return h ? Object.fromEntries(h) : null;
    },
    async hset(key, field, value) {
      if (!data.has(key)) data.set(key, new Map());
      data.get(key)!.set(field, value);
    },
    async hdel(key, field) {
      data.get(key)?.delete(field);
    },
    async del(...keys) {
      for (const k of keys) data.delete(k);
    },
  };
}
