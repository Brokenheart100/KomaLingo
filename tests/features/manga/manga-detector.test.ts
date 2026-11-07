import { describe, expect, it, vi } from 'vitest';
import { MangaDetector } from '../../../features/manga/application/manga-detector';
import { DEFAULT_DETECTION_FILTERS } from '../../../features/manga/domain/filters';
import type { ImageCandidate, ImageScanner, ImageWatcher } from '../../../features/manga/domain/ports';
import type { MangaImage } from '../../../features/manga/domain/types';

class FakeScanner implements ImageScanner {
  candidates: ImageCandidate[] = [];
  scanCount = 0;

  scan(): readonly ImageCandidate[] {
    this.scanCount += 1;
    return this.candidates;
  }
}

class FakeWatcher implements ImageWatcher {
  onChange: (() => void) | null = null;
  started = false;

  start(onChange: () => void): void {
    this.started = true;
    this.onChange = onChange;
  }

  stop(): void {
    this.started = false;
    this.onChange = null;
  }

  trigger(): void {
    this.onChange?.();
  }
}

function candidate(overrides: Partial<ImageCandidate> = {}): ImageCandidate {
  return {
    key: 'img-0',
    url: 'https://example.com/1.jpg',
    alt: '',
    sourceKind: 'img',
    geometry: { naturalWidth: 800, naturalHeight: 1200, displayWidth: 400, displayHeight: 600 },
    nearViewport: true,
    ...overrides,
  };
}

function setup() {
  const scanner = new FakeScanner();
  const watcher = new FakeWatcher();
  const detector = new MangaDetector({
    scanner,
    watcher,
    filters: DEFAULT_DETECTION_FILTERS,
    now: () => 1_700_000_000_000,
  });
  return { scanner, watcher, detector };
}

describe('MangaDetector', () => {
  it('订阅时立即收到空快照', () => {
    const { detector } = setup();
    const listener = vi.fn();

    detector.subscribe(listener);

    expect(listener).toHaveBeenCalledTimes(1);
    const snapshot = listener.mock.calls[0]?.[0];
    expect(snapshot?.images).toEqual([]);
    expect(snapshot?.nearViewportCount).toBe(0);
  });

  it('start 会立即扫描一次并通知监听器', () => {
    const { scanner, watcher, detector } = setup();
    scanner.candidates = [candidate()];

    const listener = vi.fn();
    detector.subscribe(listener);
    detector.start();

    expect(watcher.started).toBe(true);
    expect(scanner.scanCount).toBe(1);
    expect(listener).toHaveBeenCalledTimes(2);
    const snapshot = listener.mock.calls[1]?.[0];
    expect(snapshot?.images).toHaveLength(1);
    expect(snapshot?.images[0]?.id).toBe('img-0');
    expect(snapshot?.nearViewportCount).toBe(1);
    expect(snapshot?.updatedAt).toBe(1_700_000_000_000);
  });

  it('过滤掉不满足尺寸规则的图片', () => {
    const { scanner, watcher, detector } = setup();
    scanner.candidates = [
      candidate({ key: 'img-0' }),
      candidate({
        key: 'img-1',
        url: 'https://example.com/icon.png',
        geometry: { naturalWidth: 32, naturalHeight: 32, displayWidth: 16, displayHeight: 16 },
      }),
    ];
    const listener = vi.fn();
    detector.subscribe(listener);
    detector.start();
    watcher.trigger();

    const snapshot = listener.mock.calls.at(-1)?.[0];
    expect(snapshot?.images.map((image: MangaImage) => image.id)).toEqual(['img-0']);
  });

  it('按 key 去重，只保留第一次出现的元素', () => {
    const { scanner, detector } = setup();
    scanner.candidates = [
      candidate({ key: 'same', url: 'https://example.com/first.jpg' }),
      candidate({ key: 'same', url: 'https://example.com/second.jpg' }),
    ];
    const listener = vi.fn();
    detector.subscribe(listener);
    detector.start();

    const snapshot = listener.mock.calls.at(-1)?.[0];
    expect(snapshot?.images).toHaveLength(1);
    expect(snapshot?.images[0]?.url).toBe('https://example.com/first.jpg');
  });

  it('watcher 回调触发重扫，图片地址变化会通知', () => {
    const { scanner, watcher, detector } = setup();
    scanner.candidates = [candidate()];
    const listener = vi.fn();
    detector.subscribe(listener);
    detector.start();

    scanner.candidates = [candidate({ url: 'https://example.com/lazy-loaded.jpg' })];
    watcher.trigger();

    const snapshot = listener.mock.calls.at(-1)?.[0];
    expect(snapshot?.images[0]?.url).toBe('https://example.com/lazy-loaded.jpg');
  });

  it('快照完全相同时不重复通知（避免无意义重渲染）', () => {
    const { scanner, watcher, detector } = setup();
    scanner.candidates = [candidate()];
    const listener = vi.fn();
    detector.subscribe(listener);
    detector.start();
    const callsAfterStart = listener.mock.calls.length;

    watcher.trigger();
    watcher.trigger();

    expect(listener.mock.calls.length).toBe(callsAfterStart);
  });

  it('stop 停止 watcher 并清空快照', () => {
    const { scanner, watcher, detector } = setup();
    scanner.candidates = [candidate()];
    const listener = vi.fn();
    detector.subscribe(listener);
    detector.start();
    detector.stop();

    expect(detector.running).toBe(false);
    expect(watcher.started).toBe(false);
    const snapshot = listener.mock.calls.at(-1)?.[0];
    expect(snapshot?.images).toEqual([]);
  });

  it('重复 start / stop 是幂等的', () => {
    const { scanner, watcher, detector } = setup();
    scanner.candidates = [candidate()];
    detector.start();
    detector.start();
    expect(scanner.scanCount).toBe(1);

    detector.stop();
    detector.stop();
    expect(watcher.started).toBe(false);
  });

  it('运行中 setFilters 会立即重扫', () => {
    const { scanner, detector } = setup();
    scanner.candidates = [candidate()];
    const listener = vi.fn();
    detector.subscribe(listener);
    detector.start();

    detector.setFilters({ ...DEFAULT_DETECTION_FILTERS, minImageEdge: 5000 });

    expect(listener.mock.calls.at(-1)?.[0].images).toEqual([]);

    detector.setFilters(DEFAULT_DETECTION_FILTERS);
    expect(listener.mock.calls.at(-1)?.[0].images).toHaveLength(1);
  });

  it('取消订阅后不再收到通知', () => {
    const { scanner, detector } = setup();
    scanner.candidates = [candidate()];
    const listener = vi.fn();
    const unsubscribe = detector.subscribe(listener);
    listener.mockClear();

    unsubscribe();
    detector.start();

    expect(listener).not.toHaveBeenCalled();
  });
});
