import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  applySettingsPatch,
  isProviderConfigured,
  parseSettings,
  resolveSettings,
  settingsSchema,
  type Settings,
} from '../../shared/contracts/settings';

describe('设置契约', () => {
  it('默认设置是完整、合法的快照', () => {
    expect(DEFAULT_SETTINGS.version).toBe(SETTINGS_VERSION);
    expect(DEFAULT_SETTINGS.sourceLanguage).toBe('auto');
    expect(DEFAULT_SETTINGS.targetLanguage).toBe('zh-CN');
    expect(DEFAULT_SETTINGS.provider.baseUrl).toBe('https://api.openai.com/v1');
    expect(DEFAULT_SETTINGS.provider.model).toBe('');
    expect(DEFAULT_SETTINGS.translation.concurrency).toBe(2);
    expect(DEFAULT_SETTINGS.translation.temperature).toBe(0.2);
    expect(DEFAULT_SETTINGS.detection.minImageEdge).toBe(280);
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });

  it('缺少的嵌套字段自动补默认值，未知字段被剥离', () => {
    const parsed = settingsSchema.parse({
      targetLanguage: 'ja',
      translation: { concurrency: 3 },
      unexpectedField: 'should-be-stripped',
    });

    expect(parsed.targetLanguage).toBe('ja');
    expect(parsed.translation.concurrency).toBe(3);
    // 同一段里未提及的字段保留默认值
    expect(parsed.translation.temperature).toBe(DEFAULT_SETTINGS.translation.temperature);
    expect(parsed.detection).toEqual(DEFAULT_SETTINGS.detection);
    expect(Object.keys(parsed)).not.toContain('unexpectedField');
  });

  it('applySettingsPatch 只覆盖 patch 中出现的字段', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, {
      sourceLanguage: 'ja',
      overlay: { fontScale: 1.25 },
    });

    expect(next.sourceLanguage).toBe('ja');
    expect(next.overlay.fontScale).toBe(1.25);
    expect(next.overlay.theme).toBe(DEFAULT_SETTINGS.overlay.theme);
    expect(next.targetLanguage).toBe(DEFAULT_SETTINGS.targetLanguage);
    expect(next.provider).toEqual(DEFAULT_SETTINGS.provider);
  });

  it('applySettingsPatch 不会修改入参', () => {
    const before = structuredClone(DEFAULT_SETTINGS);
    applySettingsPatch(DEFAULT_SETTINGS, { targetLanguage: 'ko' });

    expect(DEFAULT_SETTINGS).toEqual(before);
  });

  it('越界或类型错误的值在写入前被拒绝', () => {
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { translation: { concurrency: 99 } })).toThrow(
      /concurrency/,
    );
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { translation: { temperature: 3 } })).toThrow();
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { provider: { baseUrl: '不是网址' } })).toThrow();
    expect(
      settingsSchema.safeParse({ ...DEFAULT_SETTINGS, targetLanguage: 'klingon' }).success,
    ).toBe(false);
  });

  it('parseSettings 对非法数据抛错，resolveSettings 整体回退默认值', () => {
    const corrupted: unknown = { version: 999, translation: { concurrency: -1 } };

    expect(() => parseSettings(corrupted)).toThrow();
    expect(resolveSettings(corrupted)).toEqual(DEFAULT_SETTINGS);
    expect(resolveSettings({ targetLanguage: 'en' })).toEqual({
      ...DEFAULT_SETTINGS,
      targetLanguage: 'en',
    });
  });

  it('isProviderConfigured 要求模型名非空、服务地址有效', () => {
    const base: Settings = structuredClone(DEFAULT_SETTINGS);
    expect(isProviderConfigured(base)).toBe(false);

    const configured: Settings = {
      ...base,
      provider: { ...base.provider, model: 'vision-model' },
    };
    expect(isProviderConfigured(configured)).toBe(true);

    const blankModel: Settings = {
      ...base,
      provider: { ...base.provider, model: '   ' },
    };
    expect(isProviderConfigured(blankModel)).toBe(false);
  });
});
