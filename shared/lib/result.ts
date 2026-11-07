/**
 * Result —— 显式表达“可能失败”的返回值。
 *
 * 为什么不用 throw：
 * - 跨上下文（Content Script ↔ Background）无法传递异常对象，抛出的错误到对岸只剩字符串；
 * - 调用方容易漏掉 try/catch，而 `Result` 在类型上强迫分支处理；
 * - 消息协议可以稳定返回 `Result<T, AppError>`，错误码与文案一起过线。
 *
 * 该文件是纯函数模块：不依赖 Vue / WXT / chrome API，可被 domain、application、
 * infrastructure 与测试共同使用（见 docs/ARCHITECTURE.md §4.2）。
 */

/** 成功分支。 */
export interface Success<T> {
  readonly ok: true;
  readonly value: T;
}

/** 失败分支。 */
export interface Failure<E> {
  readonly ok: false;
  readonly error: E;
}

/**
 * 泛型默认 `E = Error`：调用方不关心错误类型时可省略第二个类型参数。
 * `Result<T, never>` 可以安全赋给任意 `Result<T, E>`，因此 `ok()` 的返回值不挑错误类型。
 */
export type Result<T, E = Error> = Success<T> | Failure<E>;

/** 构造成功结果。 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** 构造失败结果。 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** 类型守卫：之后可直接访问 `value`。 */
export function isOk<T, E>(result: Result<T, E>): result is Success<T> {
  return result.ok;
}

/** 类型守卫：之后可直接访问 `error`。 */
export function isErr<T, E>(result: Result<T, E>): result is Failure<E> {
  return !result.ok;
}

/** 映射成功值，失败原样透传（错误类型不丢失）。 */
export function mapResult<T, U, E>(result: Result<T, E>, transform: (value: T) => U): Result<U, E> {
  return result.ok ? ok(transform(result.value)) : result;
}

/** 映射错误值，成功原样透传。 */
export function mapErr<T, E, F>(result: Result<T, E>, transform: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(transform(result.error));
}

/** 取值，失败时返回兜底值。仅用于“失败无副作用”的场景，不要用它吞掉需要上报的错误。 */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/** 双分支收敛成一个值，避免调用处写 `if (result.ok)`。 */
export function foldResult<T, E, U>(
  result: Result<T, E>,
  onSuccess: (value: T) => U,
  onFailure: (error: E) => U,
): U {
  return result.ok ? onSuccess(result.value) : onFailure(result.error);
}

/**
 * 把可能抛异常的同步/异步动作收敛成 `Result`。
 *
 * `mapError` 必须显式提供：不同调用点需要把 `unknown` 映射成各自的错误码，
 * 这里不做“猜类型”的断言。
 */
export async function attempt<T, E>(
  action: () => T | Promise<T>,
  mapError: (cause: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await action());
  } catch (cause) {
    return err(mapError(cause));
  }
}
