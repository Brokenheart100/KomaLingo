/**
 * 基础设施：监听页面变化，在"可能多出/少了图片"时通知应用层重扫。
 *
 * 三类事件：
 * - DOM 结构 / 图片属性变化（懒加载替换 src、瀑布流插入节点）→ MutationObserver，防抖 150ms；
 * - 页面滚动（懒加载图片进入视口、`nearViewport` 统计变化）→ 捕获阶段监听，节流 200ms；
 * - 窗口尺寸变化（响应式布局改变显示尺寸）→ 与滚动同样节流。
 *
 * 注意：滚动监听挂在 document 的捕获阶段，能覆盖内部可滚动容器，而不只是 window。
 */
import type { ImageWatcher } from '../domain/ports';

export interface DomImageWatcherOptions {
  /** DOM 变化后的防抖时间（毫秒），默认 150。 */
  readonly debounceMs?: number;
  /** 滚动 / 尺寸变化的最小触发间隔（毫秒），默认 200。 */
  readonly scrollThrottleMs?: number;
}

export class DomImageWatcher implements ImageWatcher {
  readonly #document: Document;
  readonly #debounceMs: number;
  readonly #scrollThrottleMs: number;
  readonly #handleScroll = (): void => {
    const now = Date.now();
    const elapsed = now - this.#lastScrollRefresh;
    if (elapsed >= this.#scrollThrottleMs) {
      this.#lastScrollRefresh = now;
      this.#emit();
      return;
    }
    // 节流窗口内的滚动：安排在窗口结束时补一次，避免"滚动中数字永远不更新"。
    this.#schedule(this.#scrollThrottleMs - elapsed);
  };

  #observer: MutationObserver | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #onChange: (() => void) | null = null;
  #lastScrollRefresh = 0;
  #started = false;

  constructor(doc: Document = document, options: DomImageWatcherOptions = {}) {
    this.#document = doc;
    this.#debounceMs = options.debounceMs ?? 150;
    this.#scrollThrottleMs = options.scrollThrottleMs ?? 200;
  }

  get started(): boolean {
    return this.#started;
  }

  start(onChange: () => void): void {
    if (this.#started) {
      this.stop();
    }
    this.#onChange = onChange;
    this.#started = true;
    this.#lastScrollRefresh = Date.now();

    const root = this.#document.documentElement;
    if (root !== null) {
      this.#observer = new MutationObserver(() => {
        this.#schedule();
      });
      this.#observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'srcset', 'style', 'class', 'hidden'],
      });
    }

    this.#document.addEventListener('scroll', this.#handleScroll, {
      capture: true,
      passive: true,
    });
    this.#document.defaultView?.addEventListener('resize', this.#handleScroll, { passive: true });
  }

  stop(): void {
    if (!this.#started) {
      return;
    }
    this.#started = false;
    this.#onChange = null;

    this.#observer?.disconnect();
    this.#observer = null;

    this.#document.removeEventListener('scroll', this.#handleScroll, { capture: true });
    this.#document.defaultView?.removeEventListener('resize', this.#handleScroll);

    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #emit(): void {
    this.#onChange?.();
  }

  #schedule(delay: number = this.#debounceMs): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
    }
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#emit();
    }, delay);
  }
}
