import { describe, expect, it } from 'vitest';

import { AbortTaskError, ConcurrencyLimiter } from '../../shared/lib/concurrency-limiter';

/** 手动结算的 Promise，用来精确控制“任务何时结束”。 */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 等待微任务清空，让 #pump 的 finally 链跑完。 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('ConcurrencyLimiter', () => {
  it('拒绝非法的并发数', () => {
    expect(() => new ConcurrencyLimiter({ concurrency: 0 })).toThrow(RangeError);
    expect(() => new ConcurrencyLimiter({ concurrency: 1.5 })).toThrow(RangeError);
  });

  it('同时执行数不超过上限，超出的排队等待', async () => {
    const limiter = new ConcurrencyLimiter({ concurrency: 2, name: 'test' });
    const gates = [deferred(), deferred(), deferred()];
    let active = 0;
    let maxActive = 0;

    const runs = gates.map((gate) =>
      limiter.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate.promise;
        active -= 1;
      }),
    );

    expect(limiter.active).toBe(2);
    expect(limiter.pending).toBe(1);

    gates[0]?.resolve();
    await flush();
    expect(limiter.active).toBe(2);
    expect(limiter.pending).toBe(0);

    gates[1]?.resolve();
    gates[2]?.resolve();
    await Promise.all(runs);

    expect(maxActive).toBe(2);
    expect(limiter.idle).toBe(true);
  });

  it('按 FIFO 顺序开始执行', async () => {
    const limiter = new ConcurrencyLimiter({ concurrency: 1 });
    const started: number[] = [];
    const gates = [deferred(), deferred(), deferred()];

    const runs = gates.map((gate, index) =>
      limiter.run(async () => {
        started.push(index);
        await gate.promise;
      }),
    );

    for (const gate of gates) {
      gate.resolve();
      await flush();
    }
    await Promise.all(runs);

    expect(started).toEqual([0, 1, 2]);
  });

  it('排队期间取消：任务体不会被执行，且收到 AbortTaskError', async () => {
    const limiter = new ConcurrencyLimiter({ concurrency: 1, name: 'queue' });
    const firstGate = deferred();
    const controller = new AbortController();

    const first = limiter.run(() => firstGate.promise);
    const second = limiter.run(() => 'should-never-run', { signal: controller.signal });

    controller.abort();

    await expect(second).rejects.toBeInstanceOf(AbortTaskError);
    await expect(second).rejects.toThrow('排队时被取消');
    expect(limiter.pending).toBe(0);

    firstGate.resolve();
    await first;
    await flush();
    expect(limiter.idle).toBe(true);
  });

  it('执行期间取消：任务的 signal 被 abort，调用方收到任务自己的错误', async () => {
    const limiter = new ConcurrencyLimiter({ concurrency: 1 });
    const controller = new AbortController();

    const run = limiter.run(
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new AbortTaskError('任务内部感知到取消'));
          });
        }),
      { signal: controller.signal },
    );

    controller.abort();
    await expect(run).rejects.toThrow('任务内部感知到取消');
    await flush();
    expect(limiter.idle).toBe(true);
  });

  it('传入已取消的 signal 时直接拒绝，不进入队列', async () => {
    const limiter = new ConcurrencyLimiter({ concurrency: 1, name: 'pre-aborted' });
    const controller = new AbortController();
    controller.abort();

    await expect(limiter.run(() => 'nope', { signal: controller.signal })).rejects.toThrow(
      '入队前已被取消',
    );
    expect(limiter.pending).toBe(0);
  });

  it('clear() 拒绝排队任务、中止执行中任务，之后仍可复用', async () => {
    const limiter = new ConcurrencyLimiter({ concurrency: 1, name: 'clearable' });
    const running = limiter.run(
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason instanceof Error ? signal.reason : new AbortTaskError());
          });
        }),
    );
    const queued = limiter.run(() => 'queued');

    limiter.clear();

    await expect(running).rejects.toThrow('已清空');
    await expect(queued).rejects.toBeInstanceOf(AbortTaskError);
    expect(limiter.idle).toBe(true);

    await expect(limiter.run(() => 42)).resolves.toBe(42);
  });

  it('drain() 等待所有任务结算（含失败任务）', async () => {
    const limiter = new ConcurrencyLimiter({ concurrency: 2 });
    const slow = deferred();

    const slowTask = limiter.run(() => slow.promise);
    const failingTask = limiter.run(async () => {
      throw new Error('预期失败');
    });
    // 立即挂上断言，避免拒绝在断言前被判定为 unhandled。
    const failingCheck = expect(failingTask).rejects.toThrow('预期失败');

    const drained = limiter.drain().then(() => 'drained');
    await failingCheck;
    expect(limiter.idle).toBe(false);

    slow.resolve();
    await slowTask;
    await expect(drained).resolves.toBe('drained');
  });

  it('drain() 在空闲时立即 resolve', async () => {
    const limiter = new ConcurrencyLimiter({ concurrency: 3 });
    await expect(limiter.drain()).resolves.toBeUndefined();
  });
});
