import "server-only";
import { Redis } from "@upstash/redis";
import { PEOPLE, type PersonName, type PersonPreference, type StorageKind } from "./types";

export interface PreferenceStore {
  kind: StorageKind;
  getAll(): Promise<PersonPreference[]>;
  /** Upsert one person's record (keyed by name). Other people's records are untouched. */
  put(pref: PersonPreference): Promise<void>;
  clear(): Promise<void>;
}

const HASH_KEY = "group-trip:preferences";

function sortByPeople(prefs: PersonPreference[]): PersonPreference[] {
  return prefs.sort((a, b) => PEOPLE.indexOf(a.name) - PEOPLE.indexOf(b.name));
}

/** One hash field per person, so concurrent writes by different people never clobber. */
function redisStore(redis: Redis): PreferenceStore {
  return {
    kind: "redis",
    async getAll() {
      const all = (await redis.hgetall<Record<string, unknown>>(HASH_KEY)) ?? {};
      return sortByPeople(
        Object.values(all).map((v) => (typeof v === "string" ? JSON.parse(v) : v) as PersonPreference),
      );
    },
    async put(pref) {
      await redis.hset(HASH_KEY, { [pref.name]: JSON.stringify(pref) });
    },
    async clear() {
      await redis.del(HASH_KEY);
    },
  };
}

// Survives dev hot reloads; resets on server restart / new serverless instance.
const g = globalThis as unknown as { __tripMemory?: Map<PersonName, PersonPreference> };
function memoryStore(): PreferenceStore {
  const map = (g.__tripMemory ??= new Map());
  return {
    kind: "memory",
    async getAll() {
      return sortByPeople([...map.values()].map((p) => structuredClone(p)));
    },
    async put(pref) {
      map.set(pref.name, structuredClone(pref));
    },
    async clear() {
      map.clear();
    },
  };
}

/** Upstash via the Vercel Marketplace sets either UPSTASH_REDIS_REST_* or KV_REST_API_*. */
export function getStore(): PreferenceStore {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? redisStore(new Redis({ url, token })) : memoryStore();
}
