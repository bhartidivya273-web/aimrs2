import "server-only";
import { Redis } from "@upstash/redis";
import { createStore, memoryBackend, type HashBackend, type PreferenceStore } from "./store-core";

export type { PreferenceStore } from "./store-core";

function redisBackend(redis: Redis): HashBackend {
  return {
    hgetall: (key) => redis.hgetall<Record<string, unknown>>(key),
    async hset(key, field, value) {
      await redis.hset(key, { [field]: value });
    },
    async hdel(key, field) {
      await redis.hdel(key, field);
    },
    async del(...keys) {
      await redis.del(...keys);
    },
  };
}

// Survives dev hot reloads; resets on server restart / new serverless instance.
const g = globalThis as unknown as { __tripMemory?: Map<string, Map<string, string>> };

/** Upstash via the Vercel Marketplace sets either UPSTASH_REDIS_REST_* or KV_REST_API_*. */
export function getStore(): PreferenceStore {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token
    ? createStore("redis", redisBackend(new Redis({ url, token })))
    : createStore("memory", memoryBackend((g.__tripMemory ??= new Map())));
}
