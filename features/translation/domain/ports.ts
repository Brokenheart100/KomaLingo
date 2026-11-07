/**
 * 翻译特性的端口（Domain 只声明能力，不关心实现）。
 *
 * 实现位置见 docs/ARCHITECTURE.md §4.1：
 * - `TranslationProvider` → `features/translation/infrastructure/openai-compatible-provider.ts`
 * - `ImageLoader` → `features/translation/infrastructure/image-loader.ts`
 * - `TranslationCache` → `shared/storage/translation-cache.ts`
 */

import type { LanguageCode, SourceLanguage } from '../../../shared/lib/languages';
import type { NormalizedBox, TextRegion } from './types';

/** 已经下载并编码好的图片，可直接塞进模型请求。 */
export interface ProviderImage {
  /** `data:image/jpeg;base64,...` */
  readonly dataUrl: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
}

export interface ProviderTranslateInput {
  readonly image: ProviderImage;
  readonly sourceLanguage: SourceLanguage;
  readonly targetLanguage: LanguageCode;
  readonly signal?: AbortSignal;
}

/**
 * 模型返回的原始区域。`id` 可选、坐标未校验——校验与 clamp 在
 * `domain/validate.ts` 里做，Provider 只负责"把 JSON 变成类型"。
 */
export interface RawTranslatedRegion {
  readonly id?: string;
  readonly sourceText: string;
  readonly translatedText: string;
  readonly box: NormalizedBox;
}

/** OCR + 翻译合一的模型端口（第一版只做多模态直译，不单独跑 OCR）。 */
export interface TranslationProvider {
  readonly id: string;
  readonly model: string;
  translate(input: ProviderTranslateInput): Promise<readonly RawTranslatedRegion[]>;
}

/** 取图端口：Background 实现，负责下载、限流与预处理（降采样/转码）。 */
export interface ImageLoader {
  load(url: string, signal?: AbortSignal): Promise<ProviderImage>;
}

/** 缓存里存的内容：比 `ImageTranslation` 少 jobId / fromCache。 */
export interface CachedTranslation {
  readonly regions: readonly TextRegion[];
  readonly sourceLanguage: SourceLanguage;
  readonly targetLanguage: LanguageCode;
  readonly providerId: string;
  readonly model: string;
  readonly createdAt: number;
}

export interface TranslationCache {
  get(key: string): Promise<CachedTranslation | null>;
  set(key: string, value: CachedTranslation): Promise<void>;
}
