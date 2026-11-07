import { describe, expect, it, vi } from 'vitest';

import {
  attempt,
  err,
  foldResult,
  isErr,
  isOk,
  mapErr,
  mapResult,
  ok,
  unwrapOr,
} from '../../shared/lib/result';

describe('Result', () => {
  it('用 ok / err 构造，并且类型守卫能收窄分支', () => {
    const success = ok(42);
    const failure = err('boom');

    expect(isOk(success)).toBe(true);
    expect(isErr(success)).toBe(false);
    expect(isOk(failure)).toBe(false);
    expect(isErr(failure)).toBe(true);

    if (isOk(success)) expect(success.value).toBe(42);
    if (isErr(failure)) expect(failure.error).toBe('boom');
  });

  it('mapResult 只映射成功值，失败原样透传错误对象', () => {
    const error = new Error('失败');
    expect(mapResult(ok(2), (v) => v * 3)).toEqual({ ok: true, value: 6 });

    const mapped = mapResult(err(error), (v: number) => v * 3);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.error).toBe(error);
  });

  it('mapErr 只映射错误，成功原样透传', () => {
    expect(mapErr(ok(7), String)).toEqual({ ok: true, value: 7 });

    const mapped = mapErr(err(new Error('x')), (cause) => cause.message);
    expect(mapped).toEqual({ ok: false, error: 'x' });
  });

  it('unwrapOr 在失败时返回兜底值', () => {
    expect(unwrapOr(ok('a'), 'fallback')).toBe('a');
    expect(unwrapOr(err('e'), 'fallback')).toBe('fallback');
  });

  it('foldResult 把两个分支收敛成同一个值', () => {
    const render = (result: ReturnType<typeof ok<number>> | ReturnType<typeof err<string>>) =>
      foldResult(
        result,
        (value) => `ok:${value}`,
        (error) => `err:${error}`,
      );

    expect(render(ok(1))).toBe('ok:1');
    expect(render(err('bad'))).toBe('err:bad');
  });

  it('attempt 把同步异常收敛成失败分支', async () => {
    const result = await attempt(
      () => {
        throw new Error('同步爆炸');
      },
      (cause) => (cause instanceof Error ? cause.message : '未知'),
    );

    expect(result).toEqual({ ok: false, error: '同步爆炸' });
  });

  it('attempt 把异步异常收敛成失败分支，并保留非 Error 抛出值', async () => {
    const mapped = vi.fn((cause: unknown) => `mapped:${String(cause)}`);
    const result = await attempt(async () => {
      await Promise.resolve();
      throw '字符串错误';
    }, mapped);

    expect(result).toEqual({ ok: false, error: 'mapped:字符串错误' });
    expect(mapped).toHaveBeenCalledTimes(1);
  });

  it('attempt 在成功时不会调用 mapError', async () => {
    const mapped = vi.fn((cause: unknown) => String(cause));
    const result = await attempt(async () => 5, mapped);

    expect(result).toEqual({ ok: true, value: 5 });
    expect(mapped).not.toHaveBeenCalled();
  });
});
