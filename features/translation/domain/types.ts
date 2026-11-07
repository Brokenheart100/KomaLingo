/**
 * 翻译特性的领域模型（纯类型，无框架、无 zod、无 IO）。
 */

import type { LanguageCode, SourceLanguage } from '../../../shared/lib/languages';

/** 失败语义分类。UI 依此决定提示文案，Application 依此决定是否重试。 */
export const TRANSLATION_ERROR_KINDS = [
  /** 用户还没填 baseUrl / model / API Key。 */
  'not-configured',
  /** 401/403：密钥错误或权限不足。 */
  'auth',
  /** 429：限流。 */
  'rate-limit',
  /** 其它 4xx：请求参数或模型名错误。 */
  'bad-request',
  /** 5xx：服务端故障。 */
  'server',
  /** 网络中断 / DNS / CORS。 */
  'network',
  /** 超时（含单次尝试与整体）。 */
  'timeout',
  /** 调用方主动取消。 */
  'cancelled',
  /** 模型返回的内容不是合法 schema。 */
  'invalid-response',
  /** 图片下载失败（权限、404、非图片）。 */
  'image-fetch',
  /** 未归类。 */
  'unknown',
] as const;

export type TranslationErrorKind = (typeof TRANSLATION_ERROR_KINDS)[number];

/** 归一化坐标（相对图片左上角，0–1）。 */
export interface NormalizedBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 一个气泡 / 旁白区域的翻译结果。 */
export interface TextRegion {
  readonly id: string;
  readonly sourceText: string;
  readonly translatedText: string;
  readonly box: NormalizedBox;
}

/** 单张图片的完整翻译产物（缓存与消息共用这一形状）。 */
export interface ImageTranslation {
  readonly jobId: string;
  readonly imageKey: string;
  readonly targetLanguage: LanguageCode;
  readonly sourceLanguage: SourceLanguage;
  readonly providerId: string;
  readonly model: string;
  readonly regions: readonly TextRegion[];
  readonly createdAt: number;
  /** true 表示本次没有调用模型，直接命中了缓存。 */
  readonly fromCache: boolean;
}

/** 一次翻译请求的业务输入（消息边界外的形态由 shared/contracts 校验）。 */
export interface TranslateImageInput {
  readonly jobId: string;
  /** 页面内元素的稳定 key（阶段二 `MangaImage.id`），参与缓存键计算。 */
  readonly imageKey: string;
  readonly imageUrl: string;
  /** 目标语言；省略时使用设置里的默认值。 */
  readonly targetLanguage?: LanguageCode;
}
