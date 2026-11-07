import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type Settings } from '../../../shared/contracts/settings';
import { ImageTranslationService } from '../../../features/translation/application/translate-image';
import type {
  CachedTranslation,
  ImageLoader,
  ProviderImage,
  ProviderTranslateInput,
  RawTranslatedRegion,
  TranslationCache,
  TranslationProvider,
} from '../../../features/translation/domain/ports';
import type { TranslateImageInput } from '../../../features/translation/domain/types';

const IMAGE: ProviderImage = {
  dataUrl: 'data:image/jpeg;base64,AAAA',
  mimeType: 'image/jpeg',
  width: 800,
  height: 600,
};

function configuredSettings(model = 'vision-model'): Settings {
  return {
    ...DEFAULT_SETTINGS,
    provider: {
      ...DEFAULT_SETTINGS.provider,
      baseUrl: 'https://api.example.test/v1',
      model,
    },
  };
}

function input(overrides: Partial<TranslateImageInput> = {}): TranslateImageInput {
  return {
    jobId: 'job-00000001',
    imageKey: 'img-key-1',
    imageUrl: 'https://example.test/page.jpg',
    ...overrides,
  };
}

function rawRegion(text = 'こんにちは'): RawTranslatedRegion {
  return {
    sourceText: text,
    translatedText: '你好',
    box: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
  };
}

interface Harness {
  readonly service: ImageTranslationService;
  readonly loaderCalls: () => number;
  readonly providerCalls: () => number;
  readonly cacheStore: Map<string, CachedTranslation>;
}

function createHarness(options: {
  settings?: Settings;
  apiKey?: string | null;
  regions?: readonly RawTranslatedRegion[];
  provider?: TranslationProvider;
  cache?: TranslationCache;
} = {}): Harness {
  let loadCount = 0;
  let providerCount = 0;
  const cacheStore = new Map<string, CachedTranslation>();

  const loader: ImageLoader = {
    load: async () => {
      loadCount += 1;
      return IMAGE;
    },
  };

  const defaultProvider: TranslationProvider = {
    id: 'openai-compatible',
    model: 'vision-model',
    translate: async (_input: ProviderTranslateInput) => {
      providerCount += 1;
      return options.regions ?? [rawRegion()];
    },
  };

  const cache: TranslationCache = options.cache ?? {
    get: async (key) => cacheStore.get(key) ?? null,
    set: async (key, value) => {
      cacheStore.set(key, value);
    },
  };

  const service = new ImageTranslationService({
    imageLoader: loader,
    cache,
    getSettings: async () => options.settings ?? configuredSettings(),
    getApiKey: async () => (options.apiKey === undefined ? 'sk-test-123456789' : options.apiKey),
    createProvider: () => options.provider ?? defaultProvider,
    hash: async (value) => `hash:${value}`,
    now: () => 1_700_000_000_000,
  });

  return {
    service,
    loaderCalls: () => loadCount,
    providerCalls: () => providerCount,
    cacheStore,
  };
}

describe('ImageTranslationService', () => {
  it('编排取图、调用 Provider、清洗并写入缓存', async () => {
    const harness = createHarness();

    const translation = await harness.service.translate(input());

    expect(translation.regions).toHaveLength(1);
    expect(translation.regions[0]?.id).toBe('r1');
    expect(translation.fromCache).toBe(false);
    expect(translation.createdAt).toBe(1_700_000_000_000);
    expect(harness.loaderCalls()).toBe(1);
    expect(harness.providerCalls()).toBe(1);
    expect(harness.cacheStore.size).toBe(1);
  });

  it('相同图片与语言第二次调用命中缓存，不再调用 Provider', async () => {
    const harness = createHarness();

    const first = await harness.service.translate(input({ jobId: 'job-00000001' }));
    const second = await harness.service.translate(input({ jobId: 'job-00000002' }));

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.jobId).toBe('job-00000002');
    expect(harness.providerCalls()).toBe(1);
    expect(harness.loaderCalls()).toBe(1);
  });

  it('缓存键包含目标语言与模型，切换后不会误用缓存', async () => {
    const harness = createHarness();

    await harness.service.translate(input());
    await harness.service.translate(input({ jobId: 'job-00000003', targetLanguage: 'en' }));

    expect(harness.providerCalls()).toBe(2);
    expect(harness.cacheStore.size).toBe(2);
  });

  it('同一图片的并发请求合并为一次付费调用', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: TranslationProvider = {
      id: 'openai-compatible',
      model: 'vision-model',
      translate: async () => {
        await gate;
        return [rawRegion()];
      },
    };
    const harness = createHarness({ provider });

    const first = harness.service.translate(input({ jobId: 'job-00000001' }));
    await vi.waitFor(() => expect(harness.loaderCalls()).toBe(1));
    const second = harness.service.translate(input({ jobId: 'job-00000002' }));
    release();

    const [a, b] = await Promise.all([first, second]);

    expect(harness.loaderCalls()).toBe(1);
    expect(a.jobId).toBe('job-00000001');
    expect(b.jobId).toBe('job-00000002');
    expect(b.regions).toHaveLength(1);
  });

  it('空结果不写缓存，允许用户重试', async () => {
    const harness = createHarness({ regions: [] });

    const translation = await harness.service.translate(input());

    expect(translation.regions).toHaveLength(0);
    expect(harness.cacheStore.size).toBe(0);
  });

  it('未配置模型时抛 not-configured', async () => {
    const harness = createHarness({ settings: configuredSettings('') });

    await expect(harness.service.translate(input())).rejects.toMatchObject({ kind: 'not-configured' });
    expect(harness.loaderCalls()).toBe(0);
  });

  it('缺少 API Key 时抛 not-configured', async () => {
    const harness = createHarness({ apiKey: null });

    await expect(harness.service.translate(input())).rejects.toMatchObject({ kind: 'not-configured' });
  });

  it('取消 job 会中止底层请求并抛 cancelled', async () => {
    const provider: TranslationProvider = {
      id: 'openai-compatible',
      model: 'vision-model',
      translate: async (providerInput) =>
        new Promise<readonly RawTranslatedRegion[]>((_resolve, reject) => {
          providerInput.signal?.addEventListener('abort', () => {
            reject(new DOMException('已取消', 'AbortError'));
          });
        }),
    };
    const harness = createHarness({ provider });

    const pending = harness.service.translate(input({ jobId: 'job-00000009' }));
    await vi.waitFor(() => expect(harness.service.activeJobIds).toEqual(['job-00000009']));

    expect(harness.service.cancel('job-00000009')).toBe(true);
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
    expect(harness.service.cancel('job-unknown')).toBe(false);
  });
});
