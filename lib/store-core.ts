import { PEOPLE, type PersonName, type PersonPreference, type StorageKind } from "./types";

/**
 * Storage layout (Redis hashes, or the same shape in memory):
 *   group-trip:preferences   field = name -> PersonPreference JSON (never includes confirmedOptionId)
 *   group-trip:confirmations field = name -> { optionId, version } JSON
 *
 * A confirmation counts only while its `version` equals the person's current
 * `updatedAt`. Confirm never writes the preference record, and saving preferences
 * bumps `updatedAt`, so an edit that races a confirm can neither be lost nor leave a
 * stale "I'm in" behind. Every write touches only one person's field.
 */
const PREFS_KEY = "group-trip:preferences";
const CONFIRMS_KEY = "group-trip:confirmations";

interface StoredConfirmation {
  optionId: string;
  version: string;
}

/** The handful of hash operations the store needs; implemented by Redis and by memory. */
export interface HashBackend {
  hgetall(key: string): Promise<Record<string, unknown> | null>;
  hset(key: string, field: string, value: string): Promise<void>;
  hdel(key: string, field: string): Promise<void>;
  del(...keys: string[]): Promise<void>;
}

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

// Upstash auto-parses JSON values on read; memory returns strings. Accept both.
function parse<T>(v: unknown): T | null {
  if (typeof v !== "string") return (v ?? null) as T | null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

export const versionOf = (p: PersonPreference) => p.updatedAt ?? "";

export function createStore(kind: StorageKind, db: HashBackend): PreferenceStore {
  return {
    kind,
    async getAll() {
      const [prefsRaw, confirmsRaw] = await Promise.all([db.hgetall(PREFS_KEY), db.hgetall(CONFIRMS_KEY)]);
      const out: PersonPreference[] = [];
      for (const name of PEOPLE) {
        const pref = parse<PersonPreference>(prefsRaw?.[name]);
        if (!pref || pref.name !== name) continue;
        delete pref.confirmedOptionId; // ignore any legacy inline value
        const c = parse<StoredConfirmation>(confirmsRaw?.[name]);
        if (c && typeof c.optionId === "string" && c.version === versionOf(pref)) {
          pref.confirmedOptionId = c.optionId;
        }
        out.push(pref);
      }
      return out;
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
