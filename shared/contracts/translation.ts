/**
 * 翻译相关的跨上下文契约。
 *
 * 与 `settings.ts` 一样属于 shared 层：只依赖 zod 与 shared/lib 的纯常量，
 * 不引用 Vue / WXT / chrome API。所有"从消息或模型进来"的数据都必须先过这里。
 */

import { z } from 'zod';

import { MAX_IMAGE_URL_LENGTH, isHttpUrl } from '../lib/image-url';
import { MAX_REGION_TEXT_LENGTH, MAX_TRANSLATION_REGIONS } from '../lib/translation-limits';
import { languageSchema } from './settings';

/** 模型输出的坐标：只接受有限数字，真正的 clamp 在 domain 层做。 */
export const normalizedBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

/**
 * 单个区域的宽松 schema。
 *
 * 故意不在 schema 里卡 [0,1]：模型经常给像素坐标或轻微越界值，
 * 直接判失败会浪费一次已经付费的请求。这里只保证"形状正确、类型正确"，
 * 范围与长度交给 domain 的 `prepareRegions` 清洗。
 */
export const rawRegionSchema = z.object({
  id: z.string().max(64).optional(),
  sourceText: z.string().max(MAX_REGION_TEXT_LENGTH * 4),
  translatedText: z.string().max(MAX_REGION_TEXT_LENGTH * 4),
  box: normalizedBoxSchema,
});

/** 模型必须返回的顶层结构：`{ "regions": [...] }`。 */
export const providerResponseSchema = z.object({
  regions: z.array(rawRegionSchema).max(MAX_TRANSLATION_REGIONS * 2),
});

export type ProviderResponse = z.infer<typeof providerResponseSchema>;

/** 只允许 http(s)：`data:` / `blob:` / `file:` 一律拒绝。 */
export const imageUrlSchema = z
  .url()
  .max(MAX_IMAGE_URL_LENGTH)
  .refine(isHttpUrl, { message: '图片地址必须是 http(s)' });

/** `translate:image` 的载荷。 */
export const translateImagePayloadSchema = z.object({
  jobId: z.string().min(8).max(64),
  /** 页面内元素的稳定 key，参与缓存键。 */
  imageKey: z.string().min(1).max(256),
  imageUrl: imageUrlSchema,
  /** 允许覆盖设置里的目标语言（Popup 改了语言但页面还没刷新时有用）。 */
  targetLanguage: languageSchema.optional(),
});

export type TranslateImagePayload = z.infer<typeof translateImagePayloadSchema>;

/** `translate:cancel` 的载荷。 */
export const cancelTranslationPayloadSchema = z.object({
  jobId: z.string().min(8).max(64),
});

export type CancelTranslationPayload = z.infer<typeof cancelTranslationPayloadSchema>;

/** `credentials:set` 的载荷：密钥不 trim 以外的任何处理，也不写日志。 */
export const apiKeyPayloadSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(8, 'API Key 太短')
    .max(512, 'API Key 过长')
    .refine((value) => !/\s/.test(value), { message: 'API Key 不能包含空白字符' }),
});

export type ApiKeyPayload = z.infer<typeof apiKeyPayloadSchema>;
