/**
 * 语言代码（纯常量 + 类型 + 守卫）。
 *
 * 为什么单独存在：
 * - `shared/contracts/settings.ts` 用 zod 基于这些常量构造 schema；
 * - `features/translation/domain` 需要 `LanguageCode` / `SourceLanguage`，
 *   但 domain 不允许依赖 zod（ADR-08），只能依赖 shared/lib 的纯模块。
 */

/** 目前支持识别/翻译的语言（BCP 47 子集）。 */
export const LANGUAGE_CODES = ['ja', 'ko', 'en', 'zh-CN', 'zh-TW'] as const;

export type LanguageCode = (typeof LANGUAGE_CODES)[number];

/** 源语言允许 auto（交给多模态模型自行判定）。 */
export type SourceLanguage = 'auto' | LanguageCode;

/** 运行时守卫：外部输入（消息、storage）在进入类型系统前先用它收窄。 */
export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && (LANGUAGE_CODES as readonly string[]).includes(value);
}

/** 目标语言不接受 auto。 */
export function isTargetLanguage(value: unknown): value is LanguageCode {
  return isLanguageCode(value);
}

/** 从源语言推断阅读方向：日文漫画默认从右到左，其它按从左到右。 */
export function readingDirectionOf(sourceLanguage: SourceLanguage): 'rtl' | 'ltr' {
  return sourceLanguage === 'ja' ? 'rtl' : 'ltr';
}
