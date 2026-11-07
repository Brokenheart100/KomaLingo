/**
 * 翻译缓存（Background 独占写入，Content 只经消息拿结果）。
 *
 * 设计（Q2 决议：先用 `storage.local`，超限再上 IndexedDB）：
 * - 键 = SHA-256(图片 key + 目标语言 + Provider/模型)，由 Application 计算；
 * - 值是"区域列表 + 元信息"，不含图片，体积可控；
 * - 上限 60 条 / 14 天，按 `createdAt` 淘汰最旧；
 * - 损坏数据整体丢弃并重置，不阻塞翻译主流程。
 */

import { z } from 'zod';
import { storage } from 'wxt/utils/storage';

import type {
  CachedTranslation,
  TranslationCache,
} from '../../features/translation/domain/ports';
import { languageSchema, sourceLanguageSchema } from '../contracts/settings';

export const TRANSLATION_CACHE_STORAGE_KEY = 'local:translation-cache';

/** 条数上限。一条约几 KB，60 条远低于 storage.local 的 10MB 配额。 */
export const MAX_CACHE_ENTRIES = 60;

/** 过期时间：两周。 */
export const MAX_CACHE_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const cachedRegionSchema = z.object({
  id: z.string(),
  sourceText: z.string(),
  translatedText: z.string(),
  box: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
});

const cachedTranslationSchema = z.object({
  regions: z.array(cachedRegionSchema).max(200),
  sourceLanguage: sourceLanguageSchema,
  targetLanguage: languageSchema,
  providerId: z.string(),
  model: z.string(),
  createdAt: z.number(),
});

const cacheRecordSchema = z.record(z.string(), cachedTranslationSchema);

type CacheRecord = Record<string, CachedTranslation>;

const cacheItem = storage.defineItem<CacheRecord>(TRANSLATION_CACHE_STORAGE_KEY, {
  fallback: {},
});

/** 写操作串行化，避免并发 read-modify-write 互相覆盖。 */
let writeChain: Promise<unknown> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeChain.then(operation, operation);
  writeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readRecord(): Promise<CacheRecord> {
  const raw: unknown = await cacheItem.getValue();
  const parsed = cacheRecordSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  console.warn('[KomaLingo] 翻译缓存数据不合法，已重置');
  await cacheItem.setValue({});
  return {};
}

function prune(record: CacheRecord, now: number): CacheRecord {
  const alive = Object.entries(record)
    .filter(([, value]) => now - value.createdAt <= MAX_CACHE_AGE_MS)
    .sort(([, left], [, right]) => left.createdAt - right.createdAt);

  while (alive.length >= MAX_CACHE_ENTRIES) {
    alive.shift();
  }

  return Object.fromEntries(alive);
}

/** 读取一条缓存；过期或损坏返回 null。 */
export async function readCachedTranslation(cacheKey: string): Promise<CachedTranslation | null> {
  const record = await readRecord();
  const hit = record[cacheKey];
  if (hit === undefined) return null;

  if (Date.now() - hit.createdAt > MAX_CACHE_AGE_MS) return null;
  return hit;
}

/** 写入一条缓存（会顺带淘汰过期与最旧条目）。 */
export function writeCachedTranslation(
  cacheKey: string,
  value: CachedTranslation,
): Promise<void> {
  return serialized(async () => {
    const now = Date.now();
    const record = prune(await readRecord(), now);
    record[cacheKey] = value;
    await cacheItem.setValue(record);
  });
}

/** 清空缓存（设置页用）。 */
export function clearTranslationCache(): Promise<void> {
  return serialized(async () => {
    await cacheItem.setValue({});
  });
}

/** 当前缓存条数（设置页展示用）。 */
export async function countCachedTranslations(): Promise<number> {
  return Object.keys(await readRecord()).length;
}

/** 供 Application 注入的端口实现。 */
export const translationCache: TranslationCache = {
  get: readCachedTranslation,
  set: writeCachedTranslation,
};
