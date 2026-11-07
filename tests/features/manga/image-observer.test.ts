import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DomImageWatcher } from '../../../features/manga/infrastructure/image-observer';

describe('DomImageWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('把短时间内的多次 DOM 变化合并为一次回调', async () => {
    const watcher = new DomImageWatcher(document, { debounceMs: 50 });
    const onChange = vi.fn();
    watcher.start(onChange);

    document.body.appendChild(document.createElement('div'));
    document.body.appendChild(document.createElement('div'));
    // 先让 MutationObserver 的微任务回调执行，才会真正安排防抖定时器
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(49);
    expect(onChange).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onChange).toHaveBeenCalledTimes(1);

    watcher.stop();
  });

  it('滚动事件在节流窗口内只触发一次，并在窗口结束时补一次', async () => {
    const watcher = new DomImageWatcher(document, { scrollThrottleMs: 100 });
    const onChange = vi.fn();
    watcher.start(onChange);

    document.dispatchEvent(new Event('scroll'));
    // 首次滚动距 start 不足 100ms，会被安排到窗口结束
    expect(onChange).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onChange).toHaveBeenCalledTimes(2);

    watcher.stop();
  });

  it('stop 之后不再响应 DOM 变化，且可以重新 start', async () => {
    const watcher = new DomImageWatcher(document, { debounceMs: 10 });
    const first = vi.fn();
    watcher.start(first);

    watcher.stop();
    expect(watcher.started).toBe(false);

    document.body.appendChild(document.createElement('section'));
    await vi.advanceTimersByTimeAsync(50);
    expect(first).not.toHaveBeenCalled();

    const second = vi.fn();
    watcher.start(second);
    document.body.appendChild(document.createElement('article'));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(second).toHaveBeenCalledTimes(1);

    watcher.stop();
  });

  it('重复 start 会先解绑旧监听，旧回调不再被调用', async () => {
    const watcher = new DomImageWatcher(document, { debounceMs: 10 });
    const oldCallback = vi.fn();
    const newCallback = vi.fn();

    watcher.start(oldCallback);
    watcher.start(newCallback);

    document.body.appendChild(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10);

    expect(oldCallback).not.toHaveBeenCalled();
    expect(newCallback).toHaveBeenCalledTimes(1);

    watcher.stop();
  });
});
