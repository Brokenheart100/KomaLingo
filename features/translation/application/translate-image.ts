/**
 * 用例：翻译一张图片（Application 层）。
 *
 * 职责边界：
 * - 这里只做编排：读设置 → 算缓存键 → 查缓存 → 取图 → 调 Provider → 清洗结果 → 回写缓存；
 * - 不碰 DOM、不发消息、不直接 new 具体 Provider（通过 `createProvider` 注入）；
 * - 同一张图 + 同一目标语言 + 同一引擎/模型的并发请求合并成一次付费调用。
 *
 * 取消语义：`cancel(jobId)` 会中止底层共享请求。若两个 jobId 命中同一个在途任务，
 * 取消其中一个会同时取消另一个——这是刻意的，因为 Content Script 侧本来就按图去重。
 */

import type { LanguageCode, SourceLanguage } from '../../../shared/lib/languages';
import { readingDirectionOf } from '../../../shared/lib/languages';
import { sha256Hex } from '../../../shared/lib/hash';
import type { Settings } from '../../../shared/contracts/settings';
import type {
  CachedTranslation,
  ImageLoader,
  ProviderTranslateInput,
  TranslationCache,
  TranslationProvider,
} from '../domain/ports';
import { TranslationFailure, toTranslationFailure } from '../domain/errors';
import { prepareRegions } from '../domain/validate';
import type { ImageTranslation, TranslateImageInput } from '../domain/types';

/** 构造 Provider 所需的配置（不含传输细节，由 Infrastructure 解释）。 */
export interface ProviderConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly temperature: number;
  readonly requestTimeoutMs: number;
  readonly maxAttempts: number;
}

export interface ImageTranslationServiceOptions {
  readonly imageLoader: ImageLoader;
  readonly cache: TranslationCache;
  /** 每次调用都重新读，保证设置变更立即生效。 */
  readonly getSettings: () => Promise<Settings>;
  /** API Key 只在 Background 存在；这里按需读取。 */
  readonly getApiKey: () => Promise<string | null>;
  readonly createProvider: (config: ProviderConfig) => TranslationProvider;
  readonly hash?: (input: string) => Promise<string>;
  readonly now?: () => number;
}

interface InflightTask {
  readonly controller: AbortController;
  readonly jobIds: Set<string>;
  readonly promise: Promise<ImageTranslation>;
}

interface RunContext {
  readonly settings: Settings;
  readonly targetLanguage: LanguageCode;
  readonly sourceLanguage: SourceLanguage;
  readonly cacheKey: string;
  readonly signal: AbortSignal;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // 共享 promise 可能暂时没有消费者（调用方已取消），避免 Node 报未处理拒绝。
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function assertProviderConfigured(settings: Settings): void {
  if (settings.provider.baseUrl.trim() === '') {
    throw new TranslationFailure('not-configured', '请先在设置中填写服务地址');
  }
  if (settings.provider.model.trim() === '') {
    throw new TranslationFailure('not-configured', '请先在设置中选择模型');
  }
}

function toTranslation(
  cached: CachedTranslation,
  input: TranslateImageInput,
  now: number,
  fromCache: boolean,
): ImageTranslation {
  return {
    jobId: input.jobId,
    imageKey: input.imageKey,
    targetLanguage: cached.targetLanguage,
    sourceLanguage: cached.sourceLanguage,
    providerId: cached.providerId,
    model: cached.model,
    regions: cached.regions,
    createdAt: now,
    fromCache,
  };
}

export class ImageTranslationService {
  readonly #imageLoader: ImageLoader;

  readonly #cache: TranslationCache;

  readonly #getSettings: () => Promise<Settings>;

  readonly #getApiKey: () => Promise<string | null>;

  readonly #createProvider: (config: ProviderConfig) => TranslationProvider;

  readonly #hash: (input: string) => Promise<string>;

  readonly #now: () => number;

  readonly #inflight = new Map<string, InflightTask>();

  readonly #jobControllers = new Map<string, AbortController>();

  constructor(options: ImageTranslationServiceOptions) {
    this.#imageLoader = options.imageLoader;
    this.#cache = options.cache;
    this.#getSettings = options.getSettings;
    this.#getApiKey = options.getApiKey;
    this.#createProvider = options.createProvider;
    this.#hash = options.hash ?? sha256Hex;
    this.#now = options.now ?? Date.now;
  }

  /** 当前在途的 jobId（调试与测试用）。 */
  get activeJobIds(): readonly string[] {
    return [...this.#jobControllers.keys()];
  }

  async translate(input: TranslateImageInput): Promise<ImageTranslation> {
    const settings = await this.#getSettings();
    assertProviderConfigured(settings);

    const targetLanguage: LanguageCode = input.targetLanguage ?? settings.targetLanguage;
    const sourceLanguage: SourceLanguage = settings.sourceLanguage;
    const providerId = settings.provider.id;
    const model = settings.provider.model.trim();

    const cacheKey = await this.#hash(
      [input.imageKey, targetLanguage, providerId, model].join('\n'),
    );

    const existing = this.#inflight.get(cacheKey);
    if (existing !== undefined) {
      existing.jobIds.add(input.jobId);
      this.#jobControllers.set(input.jobId, existing.controller);
      try {
        const shared = await existing.promise;
        return { ...shared, jobId: input.jobId };
      } catch (cause) {
        this.#jobControllers.delete(input.jobId);
        throw cause;
      }
    }

    const controller = new AbortController();
    const jobIds = new Set([input.jobId]);
    const deferred = createDeferred<ImageTranslation>();

    // 先登记再 await：否则两个并发请求会在查缓存的空档里各发起一次付费调用。
    this.#inflight.set(cacheKey, { controller, jobIds, promise: deferred.promise });
    this.#jobControllers.set(input.jobId, controller);

    const runContext: RunContext = {
      settings,
      targetLanguage,
      sourceLanguage,
      cacheKey,
      signal: controller.signal,
    };

    try {
      const cached = await this.#cache.get(cacheKey);
      if (cached !== null) {
        const hit = toTranslation(cached, input, this.#now(), true);
        deferred.resolve(hit);
        return hit;
      }

      const translation = await this.#run(input, runContext);
      deferred.resolve(translation);
      return translation;
    } catch (cause) {
      deferred.reject(cause);
      throw cause;
    } finally {
      this.#inflight.delete(cacheKey);
      for (const jobId of jobIds) {
        if (this.#jobControllers.get(jobId) === controller) {
          this.#jobControllers.delete(jobId);
        }
      }
    }
  }

  /** 取消一个任务；返回是否找到了对应在途请求。 */
  cancel(jobId: string): boolean {
    const controller = this.#jobControllers.get(jobId);
    if (controller === undefined) return false;
    controller.abort();
    return true;
  }

  /** 页面卸载/插件失效时全部取消。 */
  cancelAll(reason = '翻译已取消'): void {
    for (const controller of this.#jobControllers.values()) {
      controller.abort(reason);
    }
    this.#jobControllers.clear();
    this.#inflight.clear();
  }

  async #run(input: TranslateImageInput, context: RunContext): Promise<ImageTranslation> {
    const { settings, targetLanguage, sourceLanguage, cacheKey, signal } = context;

    try {
      const apiKey = await this.#getApiKey();
      if (apiKey === null || apiKey.trim() === '') {
        throw new TranslationFailure('not-configured', '请先在设置中填写 API Key');
      }

      const provider = this.#createProvider({
        baseUrl: settings.provider.baseUrl,
        apiKey,
        model: settings.provider.model.trim(),
        temperature: settings.translation.temperature,
        requestTimeoutMs: settings.translation.requestTimeoutMs,
        maxAttempts: settings.translation.maxAttempts,
      });

      const image = await this.#imageLoader.load(input.imageUrl, signal);

      const providerInput: ProviderTranslateInput = {
        image,
        sourceLanguage,
        targetLanguage,
        signal,
      };
      const raw = await provider.translate(providerInput);
      const regions = prepareRegions(raw, readingDirectionOf(sourceLanguage));

      const createdAt = this.#now();
      const record: CachedTranslation = {
        regions,
        sourceLanguage,
        targetLanguage,
        providerId: provider.id,
        model: provider.model,
        createdAt,
      };

      // 空结果不缓存：若模型偶发失败或漏读，用户重试还有机会。
      if (regions.length > 0) {
        try {
          await this.#cache.set(cacheKey, record);
        } catch (cause) {
          console.warn('[KomaLingo] 翻译结果写入缓存失败', cause);
        }
      }

      return { ...record, jobId: input.jobId, imageKey: input.imageKey, fromCache: false };
    } catch (cause) {
      if (signal.aborted) {
        throw new TranslationFailure('cancelled', '翻译已取消');
      }
      throw toTranslationFailure(cause);
    }
  }
}
