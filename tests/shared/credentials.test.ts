import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  CREDENTIALS_STORAGE_KEY,
  clearApiKey,
  getCredentialStatus,
  maskApiKey,
  readApiKey,
  saveApiKey,
} from '../../shared/storage/credentials';

/** WXT 的 `local:` 前缀在底层 storage 里会被去掉。 */
const RAW_KEY = 'credentials';

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('maskApiKey', () => {
  it('只保留前 3 位与后 4 位', () => {
    expect(maskApiKey('sk-abcdefghijklmnop')).toBe('sk-…mnop');
  });

  it('太短的密钥完全隐藏', () => {
    expect(maskApiKey('short')).toBe('••••••');
  });
});

describe('API Key 存储', () => {
  it('空存储时状态为未配置', async () => {
    await expect(getCredentialStatus()).resolves.toEqual({ configured: false, maskedHint: null });
    await expect(readApiKey()).resolves.toBeNull();
  });

  it('保存后只回状态，不回明文', async () => {
    const status = await saveApiKey('sk-abcdefghijklmnop');

    expect(status).toEqual({ configured: true, maskedHint: 'sk-…mnop' });
    await expect(getCredentialStatus()).resolves.toEqual(status);
    await expect(readApiKey()).resolves.toBe('sk-abcdefghijklmnop');

    const raw = await fakeBrowser.storage.local.get(RAW_KEY);
    expect(raw[RAW_KEY]).toMatchObject({ apiKey: 'sk-abcdefghijklmnop' });
  });

  it('拒绝过短、过长与含空白的密钥，错误消息不含明文', async () => {
    await expect(saveApiKey('short')).rejects.toThrow('API Key 太短');
    await expect(saveApiKey(`sk-${'a'.repeat(600)}`)).rejects.toThrow('API Key 过长');

    const withSpace = 'sk-abcdefg hijklmnop';
    await expect(saveApiKey(withSpace)).rejects.toThrow('API Key 不能包含空白字符');

    await expect(getCredentialStatus()).resolves.toEqual({ configured: false, maskedHint: null });
  });

  it('clearApiKey 之后回到未配置', async () => {
    await saveApiKey('sk-abcdefghijklmnop');
    await expect(clearApiKey()).resolves.toEqual({ configured: false, maskedHint: null });
    await expect(readApiKey()).resolves.toBeNull();
  });

  it('存储被改坏时自愈为未配置', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await fakeBrowser.storage.local.set({ [RAW_KEY]: { apiKey: 42 } });

    await expect(readApiKey()).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    // WXT 把 `setValue(null)` 视为删除（fallback 为 null），因此底层键会消失。
    const raw = await fakeBrowser.storage.local.get(RAW_KEY);
    expect(raw[RAW_KEY]).toBeUndefined();
  });

  it('存储键与底层键一致', async () => {
    expect(CREDENTIALS_STORAGE_KEY).toBe('local:credentials');
    await saveApiKey('sk-abcdefghijklmnop');
    const raw = await fakeBrowser.storage.local.get(null);
    expect(Object.keys(raw)).toContain(RAW_KEY);
  });
});
