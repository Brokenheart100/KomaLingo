/**
 * JSON over HTTP 的最小组合工具：单次超时 + 有选择的重试 + 取消传播。
 *
 * 边界：
 * - 只负责"发请求 → 拿 JSON"，不关心业务语义（状态码含义由调用方解释）；
 * - 不重试 4xx（鉴权/参数错误重试只会继续失败并浪费配额）；
 * - 429 / 5xx / 网络中断 / 超时可重试，指数退避 + 抖动；
 * - 调用方 `signal` 触发的取消**不**重试，立即返回 `aborted`。
 *
 * 依赖 `Result` 而不是 throw：这个函数被 Provider 与用例调用，
 * 错误必须带"是否可重试"的信息，异常没有这个字段。
 */

import { err, ok, type Result } from './result';

export type FetchJsonErrorKind = 'timeout' | 'network' | 'http' | 'parse' | 'aborted';

export interface FetchJsonError {
  readonly kind: FetchJsonErrorKind;
  readonly message: string;
  /** HTTP 状态码，仅在 `kind === 'http'` 时存在。 */
  readonly status?: number;
  readonly retryable: boolean;
}

export interface FetchJsonOptions {
  readonly method?: 'GET' | 'POST';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** 调用方的取消信号（任务取消 / 组件卸载）。 */
  readonly signal?: AbortSignal;
  /** 单次尝试的超时，默认 45s。 */
  readonly timeoutMs?: number;
  /** 总尝试次数（含首次），默认 2。 */
  readonly maxAttempts?: number;
  /** 指数退避基数，默认 400ms。 */
  readonly retryBaseDelayMs?: number;
  /** 便于测试注入。 */
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly onRetry?: (attempt: number, error: FetchJsonError) => void;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 400;
const MAX_RETRY_AFTER_MS = 10_000;
const BODY_PREVIEW_LIMIT = 300;

/** 429 与 5xx 值得重试；其余 4xx 是确定性失败。 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function parseRetryAfterMs(header: string | null): number | null {
  if (header === null) return null;

  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }

  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;

  return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_AFTER_MS);
}

function backoffDelay(attempt: number, baseDelayMs: number): number {
  // 指数退避 + 0–50% 抖动，避免多标签页同时重试形成尖峰。
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  return Math.round(exponential * (1 + Math.random() * 0.5));
}

function preview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > BODY_PREVIEW_LIMIT
    ? `${normalized.slice(0, BODY_PREVIEW_LIMIT)}…`
    : normalized;
}

interface AttemptOutcome {
  readonly result: Result<unknown, FetchJsonError>;
  /** 服务端建议的等待时间（Retry-After）。 */
  readonly retryAfterMs: number | null;
}

async function runAttempt(
  url: string,
  options: Required<Pick<FetchJsonOptions, 'timeoutMs' | 'method'>> & FetchJsonOptions,
  fetchImpl: typeof fetch,
): Promise<AttemptOutcome> {
  const callerSignal = options.signal;
  if (callerSignal?.aborted === true) {
    return {
      result: err({ kind: 'aborted', message: '请求已取消', retryable: false }),
      retryAfterMs: null,
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  let callerAborted = false;

  const onCallerAbort = (): void => {
    callerAborted = true;
    controller.abort(callerSignal?.reason);
  };
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('请求超时', 'TimeoutError'));
  }, options.timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });

    if (!response.ok) {
      let body = '';
      try {
        body = preview(await response.text());
      } catch {
        body = '<响应体不可读>';
      }
      return {
        result: err({
          kind: 'http',
          status: response.status,
          message: `HTTP ${response.status}${body === '' ? '' : `：${body}`}`,
          retryable: isRetryableStatus(response.status),
        }),
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
      };
    }

    try {
      return { result: ok(await response.json()), retryAfterMs: null };
    } catch {
      return {
        result: err({ kind: 'parse', message: '响应不是合法 JSON', retryable: false }),
        retryAfterMs: null,
      };
    }
  } catch (cause) {
    if (callerAborted) {
      return {
        result: err({ kind: 'aborted', message: '请求已取消', retryable: false }),
        retryAfterMs: null,
      };
    }
    if (timedOut) {
      return {
        result: err({
          kind: 'timeout',
          message: `请求超时（${options.timeoutMs}ms）`,
          retryable: true,
        }),
        retryAfterMs: null,
      };
    }
    return {
      result: err({
        kind: 'network',
        message: cause instanceof Error ? cause.message : '网络请求失败',
        retryable: true,
      }),
      retryAfterMs: null,
    };
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * 发起 JSON 请求并解析。
 *
 * 返回 `Result`：失败时 `error.retryable` 已经过判断，调用方可直接决定
 * 是提示用户重试，还是展示终态错误。
 */
export async function fetchJson(
  url: string,
  options: FetchJsonOptions = {},
): Promise<Result<unknown, FetchJsonError>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const resolved: Required<Pick<FetchJsonOptions, 'timeoutMs' | 'method'>> & FetchJsonOptions = {
    ...options,
    method: options.method ?? 'GET',
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };

  let lastError: FetchJsonError = { kind: 'network', message: '请求未执行', retryable: false };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const outcome = await runAttempt(url, resolved, fetchImpl);

    if (outcome.result.ok) return outcome.result;

    lastError = outcome.result.error;

    const isLastAttempt = attempt === maxAttempts;
    if (!lastError.retryable || isLastAttempt) return outcome.result;

    options.onRetry?.(attempt, lastError);

    const delay = outcome.retryAfterMs ?? backoffDelay(attempt, options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS);
    await sleep(delay);
  }

  return err(lastError);
}
