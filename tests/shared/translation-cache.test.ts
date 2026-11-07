import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import type { CachedTranslation } from '../../features/translation/domain/ports';
import {
  MAX_CACHE_AGE_MS,
  MAX_CACHE_ENTRIES,
  TRANSLATION_CACHE_STORAGE_KEY,
  clearTranslationCache,
  countCachedTranslations,
  readCachedTranslation,
  writeCachedTranslation,
} from '../../shared/storage/translation-cache';

/** WXT 的 `local:` 前缀在底层 storage 里会被去掉。 */
const RAW_KEY = 'translation-cache';

function cached(createdAt = Date.now()): CachedTranslation {
  return {
    regions: [
      {
        id: 'r1',
        sourceText: 'こんにちは',
        translatedText: '你好',
        box: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
      },
    ],
    sourceLanguage: 'ja',
    targetLanguage: 'zh-CN',
    providerId: 'openai-compatible',
    model: 'vision-model',
    createdAt,
  };
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('翻译缓存', () => {
  it('写入后可按同样的键读回', async () => {
    const value = cached();
    await writeCachedTranslation('key-a', value);

    await expect(readCachedTranslation('key-a')).resolves.toEqual(value);
    await expect(readCachedTranslation('key-b')).resolves.toBeNull();
    await expect(countCachedTranslations()).resolves.toBe(1);
    expect(TRANSLATION_CACHE_STORAGE_KEY).toBe('local:translation-cache');
  });

  it('超过 14 天的条目视为过期', async () => {
    const old = Date.now() - MAX_CACHE_AGE_MS - 1000;
    await writeCachedTranslation('key-old', cached(old));

    await expect(readCachedTranslation('key-old')).resolves.toBeNull();
  });

  it('写满上限后淘汰最旧条目', async () => {
    const base = Date.now() - 100_000;
    for (let index = 0; index < MAX_CACHE_ENTRIES + 5; index += 1) {
      await writeCachedTranslation(`key-${index}`, cached(base + index));
    }

    await expect(countCachedTranslations()).resolves.toBe(MAX_CACHE_ENTRIES);
    await expect(readCachedTranslation('key-0')).resolves.toBeNull();
    await expect(readCachedTranslation(`key-${MAX_CACHE_ENTRIES + 4}`)).resolves.not.toBeNull();
  });

  it('并发写入不会互相覆盖', async () => {
    await Promise.all([
      writeCachedTranslation('key-1', cached()),
      writeCachedTranslation('key-2', cached()),
      writeCachedTranslation('key-3', cached()),
    ]);

    await expect(countCachedTranslations()).resolves.toBe(3);
  });

  it('数据损坏时重置并继续工作', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await fakeBrowser.storage.local.set({ [RAW_KEY]: 'not-an-object' });

    await expect(countCachedTranslations()).resolves.toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it('clearTranslationCache 清空全部', async () => {
    await writeCachedTranslation('key-1', cached());
    await clearTranslationCache();

    await expect(countCachedTranslations()).resolves.toBe(0);
  });
});
