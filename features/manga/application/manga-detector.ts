/**
 * 应用层：编排"扫描页面 → 过滤 → 去重 → 通知 UI"。
 *
 * 依赖通过构造函数注入（{@link ImageScanner} / {@link ImageWatcher}），
 * 因此本文件不 import 任何浏览器 API，可在 Node 中直接测试。
 */
import { countNearViewport, filterMangaImages } from '../domain/filters';
import type { ImageScanner, ImageWatcher } from '../domain/ports';
import type { DetectionFilters, DetectionSnapshot, MangaImage } from '../domain/types';

export interface MangaDetectorDependencies {
  readonly scanner: ImageScanner;
  readonly watcher: ImageWatcher;
  readonly filters: DetectionFilters;
  /** 注入时钟便于测试，默认 `Date.now`。 */
  readonly now?: () => number;
}

export type DetectionListener = (snapshot: DetectionSnapshot) => void;

function sameGeometry(a: MangaImage['geometry'], b: MangaImage['geometry']): boolean {
  return (
    a.naturalWidth === b.naturalWidth &&
    a.naturalHeight === b.naturalHeight &&
    a.displayWidth === b.displayWidth &&
    a.displayHeight === b.displayHeight
  );
}

function sameImages(a: readonly MangaImage[], b: readonly MangaImage[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined || right === undefined) {
      return false;
    }
    if (
      left.id !== right.id ||
      left.url !== right.url ||
      left.alt !== right.alt ||
      left.sourceKind !== right.sourceKind ||
      left.nearViewport !== right.nearViewport ||
      !sameGeometry(left.geometry, right.geometry)
    ) {
      return false;
    }
  }
  return true;
}

export class MangaDetector {
  readonly #scanner: ImageScanner;
  readonly #watcher: ImageWatcher;
  readonly #now: () => number;
  readonly #listeners = new Set<DetectionListener>();

  #filters: DetectionFilters;
  #images: readonly MangaImage[] = [];
  #snapshot: DetectionSnapshot = { images: [], nearViewportCount: 0, updatedAt: 0 };
  #running = false;
  #hasSnapshot = false;

  constructor(dependencies: MangaDetectorDependencies) {
    this.#scanner = dependencies.scanner;
    this.#watcher = dependencies.watcher;
    this.#filters = dependencies.filters;
    this.#now = dependencies.now ?? Date.now;
  }

  get running(): boolean {
    return this.#running;
  }

  get filters(): DetectionFilters {
    return this.#filters;
  }

  getSnapshot(): DetectionSnapshot {
    return this.#snapshot;
  }

  /**
   * 订阅快照变化；订阅瞬间会立即收到当前快照（便于 UI 直接渲染）。
   * 返回取消订阅函数。
   */
  subscribe(listener: DetectionListener): () => void {
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** 运行中修改筛选参数会立即触发一次重扫。 */
  setFilters(filters: DetectionFilters): void {
    this.#filters = filters;
    if (this.#running) {
      this.refresh();
    }
  }

  start(): void {
    if (this.#running) {
      return;
    }
    this.#running = true;
    this.#watcher.start(() => {
      this.refresh();
    });
    this.refresh();
  }

  stop(): void {
    if (!this.#running) {
      return;
    }
    this.#running = false;
    this.#watcher.stop();
    this.#commit([]);
  }

  /** 重新扫描一次；监听器触发的自动重扫也走这里。 */
  refresh(): void {
    const candidates = this.#scanner.scan();
    const seen = new Set<string>();
    const images: MangaImage[] = [];

    for (const candidate of candidates) {
      if (seen.has(candidate.key)) {
        continue;
      }
      seen.add(candidate.key);
      images.push({
        id: candidate.key,
        url: candidate.url,
        alt: candidate.alt,
        sourceKind: candidate.sourceKind,
        geometry: candidate.geometry,
        nearViewport: candidate.nearViewport,
      });
    }

    this.#commit(filterMangaImages(images, this.#filters));
  }

  #commit(next: readonly MangaImage[]): void {
    if (this.#hasSnapshot && sameImages(this.#images, next)) {
      return;
    }
    this.#hasSnapshot = true;
    this.#images = next;
    this.#snapshot = {
      images: next,
      nearViewportCount: countNearViewport(next),
      updatedAt: this.#now(),
    };
    for (const listener of [...this.#listeners]) {
      listener(this.#snapshot);
    }
  }
}
