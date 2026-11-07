/**
 * 翻译错误：带分类与"是否可重试"的领域错误。
 *
 * 为什么不用裸 Error + message 字符串：
 * - 重试策略依赖分类（429/5xx 重试，401/400 不重试）；
 * - 跨上下文时只把分类与文案序列化过去，堆栈留在本地日志里。
 */

import type { TranslationErrorKind } from './types';

export interface TranslationFailureOptions {
  readonly retryable?: boolean;
  readonly status?: number;
  /** 底层的原始错误，仅用于本地日志，不上消息边界。 */
  readonly cause?: unknown;
}

/** 默认重试策略：限流、服务端、网络、超时可重试。 */
export function isRetryableKind(kind: TranslationErrorKind): boolean {
  return kind === 'rate-limit' || kind === 'server' || kind === 'network' || kind === 'timeout';
}

export class TranslationFailure extends Error {
  readonly kind: TranslationErrorKind;

  readonly retryable: boolean;

  readonly status: number | null;

  constructor(kind: TranslationErrorKind, message: string, options: TranslationFailureOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'TranslationFailure';
    this.kind = kind;
    this.retryable = options.retryable ?? isRetryableKind(kind);
    this.status = options.status ?? null;
  }
}

/** 把任意抛出物收敛成领域错误，避免各层各写一份判断。 */
export function toTranslationFailure(cause: unknown): TranslationFailure {
  if (cause instanceof TranslationFailure) return cause;

  if (cause instanceof DOMException && cause.name === 'AbortError') {
    return new TranslationFailure('cancelled', '翻译已取消');
  }

  return new TranslationFailure('unknown', cause instanceof Error ? cause.message : '翻译失败', {
    cause,
  });
}
