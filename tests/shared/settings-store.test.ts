import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { DEFAULT_SETTINGS, type Settings } from '../../shared/contracts/settings';
import {
  SETTINGS_STORAGE_KEY,
  patchSettings,
  readSettings,
  resetSettings,
  watchSettings,
  writeSettings,
} from '../../shared/storage/settings-store';

/** WXT 的 `local:` 前缀在底层 storage 里会被去掉。 */
const RAW_KEY = 'settings';

const corrupted: Settings = {
  ...structuredClone(DEFAULT_SETTINGS),
  translation: { ...DEFAULT_SETTINGS.translation, concurrency: 99 },
};

beforeEach(() => {
  fakeBrowser.reset();
});

describe('设置存储层', () => {
  it('空存储时返回默认设置', async () => {
    await expect(readSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('writeSettings 校验后持久化，readSettings 能读回同样的值', async () => {
    const next: Settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      targetLanguage: 'ja',
      provider: { ...DEFAULT_SETTINGS.provider, model: 'vision-model' },
    };

    await expect(writeSettings(next)).resolves.toEqual(next);
    await expect(readSettings()).resolves.toEqual(next);
    await expect(fakeBrowser.storage.local.get(RAW_KEY)).resolves.toEqual({ [RAW_KEY]: next });
  });

  it('writeSettings 拒绝非法值，存储保持不变', async () => {
    await expect(writeSettings(corrupted)).rejects.toThrow(/concurrency/);
    await expect(readSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('patchSettings 保留未涉及的字段并落库', async () => {
    const next = await patchSettings({
      sourceLanguage: 'ja',
      overlay: { fontScale: 1.3 },
    });

    expect(next.sourceLanguage).toBe('ja');
    expect(next.overlay.fontScale).toBe(1.3);
    expect(next.targetLanguage).toBe(DEFAULT_SETTINGS.targetLanguage);
    expect(next.provider).toEqual(DEFAULT_SETTINGS.provider);
    await expect(readSettings()).resolves.toEqual(next);
  });

  it('并发 patch 被串行化，不会互相覆盖', async () => {
    const [first, second] = await Promise.all([
      patchSettings({ targetLanguage: 'ko' }),
      patchSettings({ sourceLanguage: 'en' }),
    ]);

    const stored = await readSettings();
    expect(stored.targetLanguage).toBe('ko');
    expect(stored.sourceLanguage).toBe('en');
    expect(first.targetLanguage).toBe('ko');
    expect(second.sourceLanguage).toBe('en');
  });

  it('存储数据损坏时回退默认值并写回修复', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await fakeBrowser.storage.local.set({ [RAW_KEY]: corrupted });

    await expect(readSettings()).resolves.toEqual(DEFAULT_SETTINGS);
    await expect(fakeBrowser.storage.local.get(RAW_KEY)).resolves.toEqual({
      [RAW_KEY]: DEFAULT_SETTINGS,
    });
    expect(warn).toHaveBeenCalled();
  });

  it('resetSettings 回到出厂设置', async () => {
    await patchSettings({ targetLanguage: 'zh-TW', detection: { autoTranslate: false } });

    await expect(resetSettings()).resolves.toEqual(DEFAULT_SETTINGS);
    await expect(readSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('watchSettings 收到经过校验的快照，取消后不再回调', async () => {
    const received: Settings[] = [];
    const stop = watchSettings((settings) => {
      received.push(settings);
    });

    try {
      await patchSettings({ targetLanguage: 'en' });
      await vi.waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]?.targetLanguage).toBe('en');

      stop();
      await patchSettings({ targetLanguage: 'ja' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(received).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it('watchSettings 对非法变更回退默认值', async () => {
    const received: Settings[] = [];
    const stop = watchSettings((settings) => {
      received.push(settings);
    });

    try {
      await fakeBrowser.storage.local.set({ [RAW_KEY]: corrupted });
      await vi.waitFor(() => expect(received.length).toBeGreaterThan(0));
      expect(received[0]).toEqual(DEFAULT_SETTINGS);
    } finally {
      stop();
    }
  });

  it('存储键常量与底层键一致', () => {
    expect(SETTINGS_STORAGE_KEY).toBe(`local:${RAW_KEY}`);
  });
});
