import { z } from 'zod';

import { LANGUAGE_CODES, type LanguageCode, type SourceLanguage } from '../lib/languages';

/**
 * 全局设置契约。
 *
 * 该文件属于 shared 层，只依赖 zod：不引用 Vue / WXT / chrome API，
 * 因此可以被 Popup、Options、Content Script、Background 与单元测试共同使用。
 *
 * 约定：
 * - 所有字段都有默认值，`settingsSchema.parse({})` 一定产出完整对象；
 * - 读取持久化数据时统一走 `parseSettings`，绝不信任存储里的历史数据；
 * - 设置由 Background 作为唯一写入方，其它上下文只读取快照并发起 patch。
 */

// 语言常量的唯一事实来源在 shared/lib/languages.ts（domain 也要用，且不能依赖 zod）。
export { LANGUAGE_CODES, type LanguageCode, type SourceLanguage };

export const languageSchema = z.enum(LANGUAGE_CODES);

/** 源语言允许 auto（交给多模态模型判定）。 */
export const sourceLanguageSchema = z.union([languageSchema, z.literal('auto')]);

/** 翻译服务商标识；新增实现时在此追加，Application 层只认这个联合类型。 */
export const PROVIDER_IDS = ['openai-compatible'] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

/**
 * 服务商配置。注意：这里不存在 apiKey。
 * 密钥存放于 background 独占的 credentials 存储项，永远不下发给 Content Script，
 * 也不出现在任何消息返回值中。
 */
const providerSchema = z.object({
  id: z.enum(PROVIDER_IDS).default('openai-compatible'),
  /** OpenAI 兼容的 baseUrl，例如 https://api.openai.com/v1 或本地代理。 */
  baseUrl: z.url().default('https://api.openai.com/v1'),
  /** 负责 OCR + 翻译的多模态模型名，由用户填写，不预设具体型号。 */
  model: z.string().trim().max(128).default(''),
});

const translationSchema = z.object({
  /** 同时进行的图片翻译任务数上限。 */
  concurrency: z.number().int().min(1).max(4).default(2),
  /** 单次服务商请求超时时间（毫秒）。 */
  requestTimeoutMs: z.number().int().min(5_000).max(120_000).default(45_000),
  /** 单张图片的失败重试次数（不含首次请求）。 */
  maxAttempts: z.number().int().min(1).max(3).default(2),
  /** 采样温度；漫画对白需要稳定措辞，默认偏低。 */
  temperature: z.number().min(0).max(1).default(0.2),
});

const overlaySchema = z.object({
  theme: z.enum(['auto', 'light', 'dark']).default('auto'),
  /** 译文相对气泡区域的字号缩放系数。 */
  fontScale: z.number().min(0.6).max(1.8).default(1),
  /** 是否在控制栏提供“原文/译文”切换。 */
  showOriginalToggle: z.boolean().default(true),
  /** 悬浮控制栏显示策略。 */
  controlBar: z.enum(['auto', 'always', 'hidden']).default('auto'),
});

const detectionSchema = z.object({
  /** 进入视口后自动翻译，还是等用户手动触发。 */
  autoTranslate: z.boolean().default(false),
  /** 短边小于该值的元素按图标/表情处理，不进入翻译队列。 */
  minImageEdge: z.number().int().min(64).default(280),
  /** 解码上限，超过则先降采样，避免长图撑爆内存。 */
  maxDecodedPixels: z.number().int().min(1_000_000).default(24_000_000),
});

/** 设置结构版本号；字段含义发生不兼容变化时 +1 并补迁移函数。 */
export const SETTINGS_VERSION = 1;

export const settingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION).default(SETTINGS_VERSION),
  sourceLanguage: sourceLanguageSchema.default('auto'),
  targetLanguage: languageSchema.default('zh-CN'),
  provider: providerSchema.prefault({}),
  translation: translationSchema.prefault({}),
  overlay: overlaySchema.prefault({}),
  detection: detectionSchema.prefault({}),
});

export type Settings = z.infer<typeof settingsSchema>;

/** 完整默认设置；由 schema 推导，避免与默认值两处维护。 */
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 解析任意来源的设置数据（storage、消息、未来导入的备份文件）。
 * 失败时抛 ZodError，调用方必须显式处理，不做静默兜底。
 */
export function parseSettings(input: unknown): Settings {
  return settingsSchema.parse(input);
}

/**
 * 从持久化数据恢复设置：结构不合法就整体回退默认值。
 * Background 在读取 storage 时使用，保证单个字段损坏不会让扩展崩溃。
 */
export function resolveSettings(input: unknown): Settings {
  const result = settingsSchema.safeParse(input);
  return result.success ? result.data : DEFAULT_SETTINGS;
}

/** 一层深局部更新：顶层标量直接覆盖，顶层对象做浅合并。 */
export type SettingsPatch = {
  [K in keyof Omit<Settings, 'version'>]?: Settings[K] extends PlainObject
    ? Partial<Settings[K]>
    : Settings[K];
};

/**
 * 应用局部更新并重新校验。
 * 这里不是“组件里随手合并”，而是唯一的写入路径：合并结果必定通过 schema，
 * 因此非法值（越界并发数、非 http 地址）在写库前就会被拒绝。
 */
export function applySettingsPatch(current: Settings, patch: SettingsPatch): Settings {
  const merged: PlainObject = { ...current };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const previous = merged[key];
    merged[key] = isPlainObject(previous) && isPlainObject(value) ? { ...previous, ...value } : value;
  }

  return settingsSchema.parse(merged);
}

/** 服务商是否已配置完整，Popup 用它决定“开始翻译”是否可点。 */
export function isProviderConfigured(settings: Settings): boolean {
  return settings.provider.model.trim().length > 0 && settings.provider.baseUrl.length > 0;
}
