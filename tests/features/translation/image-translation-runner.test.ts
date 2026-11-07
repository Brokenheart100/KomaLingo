import { describe, expect, it, vi } from 'vitest';

import { ok, err } from '../../../shared/lib/result';
import {
  ImageTranslationRunner,
  type CancelFn,
  type TranslateFn,
  type TranslationRunnerProgress,
} from '../../../features/translation/application/image-translation-runner';

describe('ImageTranslationRunner', () => {
  it('按并发上限翻译并汇总进度', async () => {
    let active = 0;
    let maxActive = 0;
    const translate: TranslateFn = async (request) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return ok({ regions: [{ id: `${request.imageKey}-r1` }, { id: `${request.imageKey}-r2` }] });
    };
    const cancel: CancelFn = async () => undefined;
    const progress: TranslationRunnerProgress[] = [];
    const runner = new ImageTranslationRunner({
      translate,
      cancel,
      concurrency: 2,
      createJobId: () => crypto.randomUUID(),
      onProgress: (value) => progress.push(value),
    });

    await runner.start([
      { key: 'a', url: 'https://example.test/a.jpg' },
      { key: 'b', url: 'https://example.test/b.jpg' },
      { key: 'c', url: 'https://example.test/c.jpg' },
    ]);

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(runner.progress.completed).toBe(3);
    expect(runner.progress.regions).toBe(6);
    expect(runner.progress.status).toBe('idle');
    expect(progress.at(-1)?.status).toBe('idle');
  });

  it('同一张图重复出现时只翻译一次', async () => {
    const translate = vi.fn<TranslateFn>(async () => ok({ regions: [{ id: 'r1' }] }));
    const runner = new ImageTranslationRunner({ translate, cancel: async () => undefined });

    await runner.start([
      { key: 'a', url: 'https://example.test/a.jpg' },
      { key: 'a', url: 'https://example.test/a.jpg' },
    ]);

    expect(translate).toHaveBeenCalledTimes(1);
    expect(runner.progress.completed).toBe(1);
  });

  it('失败会计入 failed 并保留最近一条错误', async () => {
    const translate: TranslateFn = async () =>
      err({ message: '模型返回 401', retryable: false });
    const runner = new ImageTranslationRunner({ translate, cancel: async () => undefined });

    await runner.start([{ key: 'a', url: 'https://example.test/a.jpg' }]);

    expect(runner.progress.failed).toBe(1);
    expect(runner.progress.lastError).toBe('模型返回 401');
  });

  it('抛出的异常也算失败，不中断其余任务', async () => {
    let calls = 0;
    const translate: TranslateFn = async (request) => {
      calls += 1;
      if (request.imageKey === 'bad') throw new Error('boom');
      return ok({ regions: [{ id: 'r1' }] });
    };
    const runner = new ImageTranslationRunner({ translate, cancel: async () => undefined });

    await runner.start([
      { key: 'bad', url: 'https://example.test/bad.jpg' },
      { key: 'good', url: 'https://example.test/good.jpg' },
    ]);

    expect(calls).toBe(2);
    expect(runner.progress.failed).toBe(1);
    expect(runner.progress.completed).toBe(1);
    expect(runner.progress.lastError).toBe('boom');
  });

  it('空结果给出"没有识别到文字"的提示', async () => {
    const translate: TranslateFn = async () => ok({ regions: [] });
    const runner = new ImageTranslationRunner({ translate, cancel: async () => undefined });

    await runner.start([{ key: 'a', url: 'https://example.test/a.jpg' }]);

    expect(runner.progress.lastError).toBe('这张图没有识别到文字');
  });

  it('cancelAll 取消在途任务并回到 idle', async () => {
    const cancel = vi.fn<CancelFn>(async () => undefined);
    const translate: TranslateFn = async () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(ok({ regions: [{ id: 'r1' }] })), 50);
      });
    const runner = new ImageTranslationRunner({ translate, cancel });

    const run = runner.start([{ key: 'a', url: 'https://example.test/a.jpg' }]);
    await vi.waitFor(() => expect(runner.progress.active).toBe(1));

    await runner.cancelAll();
    await run;

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(runner.progress.status).toBe('idle');
    expect(runner.progress.completed).toBe(0);
  });

  it('markDone 让已翻译过的图不再重复请求', async () => {
    const translate = vi.fn<TranslateFn>(async () => ok({ regions: [{ id: 'r1' }] }));
    const runner = new ImageTranslationRunner({ translate, cancel: async () => undefined });
    runner.markDone('a');

    await runner.start([{ key: 'a', url: 'https://example.test/a.jpg' }]);

    expect(translate).not.toHaveBeenCalled();
  });

  it('reset 清空统计', async () => {
    const translate: TranslateFn = async () => ok({ regions: [{ id: 'r1' }] });
    const runner = new ImageTranslationRunner({ translate, cancel: async () => undefined });

    await runner.start([{ key: 'a', url: 'https://example.test/a.jpg' }]);
    runner.reset();

    expect(runner.progress).toEqual({
      status: 'idle',
      total: 0,
      completed: 0,
      failed: 0,
      regions: 0,
      active: 0,
      lastError: null,
    });
  });
});
