/**
 * 基础设施：从真实 DOM 中扫描候选图片。
 *
 * 覆盖四种承载方式：`<img>`、`<picture>` 内的 `<img>`、`<canvas>`、内联样式的背景图。
 * 不做任何"是不是漫画"的判断 —— 那是领域层 filter 的职责，这里只负责如实汇报。
 */
import type { ImageCandidate, ImageScanner } from '../domain/ports';
import type { ImageGeometry, ImageSourceKind } from '../domain/types';

export interface DomImageScannerOptions {
  /** 视口上下各扩展多少屏算"附近"，默认 1 屏。 */
  readonly viewportMarginRatio?: number;
  /** 单次扫描的候选上限，避免极端页面拖慢主线程，默认 600。 */
  readonly maxCandidates?: number;
}

const URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

function isNearViewport(rect: DOMRect, viewportHeight: number, marginRatio: number): boolean {
  if (viewportHeight <= 0) {
    // 无法获知视口（如无头环境）时不武断排除，交给上层统计。
    return true;
  }
  const margin = viewportHeight * marginRatio;
  return rect.bottom >= -margin && rect.top <= viewportHeight + margin;
}

function toAbsoluteUrl(raw: string, baseUri: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return '';
  }
  try {
    return new URL(trimmed, baseUri).href;
  } catch {
    return '';
  }
}

/** 收集元素内联样式里声明的所有背景图 URL（含多重背景）。 */
function collectBackgroundUrls(element: HTMLElement): string[] {
  const declarations = [element.style.backgroundImage, element.style.background];
  const urls: string[] = [];
  for (const declaration of declarations) {
    if (declaration === '') {
      continue;
    }
    for (const match of declaration.matchAll(URL_PATTERN)) {
      const raw = match[2];
      if (raw !== undefined && raw !== '') {
        urls.push(raw);
      }
    }
  }
  return urls;
}

function geometryOf(element: Element, rect: DOMRect): ImageGeometry {
  let naturalWidth = 0;
  let naturalHeight = 0;

  if (element instanceof HTMLImageElement) {
    naturalWidth = element.naturalWidth;
    naturalHeight = element.naturalHeight;
  } else if (element instanceof HTMLCanvasElement) {
    naturalWidth = element.width;
    naturalHeight = element.height;
  }

  return {
    naturalWidth,
    naturalHeight,
    displayWidth: rect.width,
    displayHeight: rect.height,
  };
}

export class DomImageScanner implements ImageScanner {
  readonly #root: ParentNode;
  readonly #document: Document;
  readonly #viewportMarginRatio: number;
  readonly #maxCandidates: number;
  readonly #keys = new WeakMap<Element, string>();
  #sequence = 0;

  constructor(root: Document | Element = document, options: DomImageScannerOptions = {}) {
    this.#root = root;
    this.#document = root.ownerDocument ?? document;
    this.#viewportMarginRatio = options.viewportMarginRatio ?? 1;
    this.#maxCandidates = options.maxCandidates ?? 600;
  }

  scan(): ImageCandidate[] {
    const viewportHeight = this.#document.defaultView?.innerHeight ?? 0;
    const baseUri = this.#document.baseURI;
    const results: ImageCandidate[] = [];
    const seen = new Set<Element>();

    const push = (element: Element, url: string, alt: string, sourceKind: ImageSourceKind): void => {
      if (results.length >= this.#maxCandidates || seen.has(element)) {
        return;
      }
      if (element.closest('[data-koma-lingo-ignore]') !== null) {
        return;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        // display:none、折叠容器、尚未布局的元素：暂时不可见，等 MutationObserver 再扫。
        return;
      }

      seen.add(element);
      results.push({
        key: this.#keyFor(element),
        url,
        alt,
        sourceKind,
        geometry: geometryOf(element, rect),
        nearViewport: isNearViewport(rect, viewportHeight, this.#viewportMarginRatio),
      });
    };

    for (const element of this.#root.querySelectorAll<HTMLImageElement>('img')) {
      const url = element.currentSrc !== '' ? element.currentSrc : element.src;
      const sourceKind: ImageSourceKind =
        element.closest('picture') === null ? 'img' : 'picture';
      push(element, toAbsoluteUrl(url, baseUri), element.alt, sourceKind);
    }

    for (const element of this.#root.querySelectorAll<HTMLCanvasElement>('canvas')) {
      push(element, '', '', 'canvas');
    }

    for (const element of this.#root.querySelectorAll<HTMLElement>('[style*="url("]')) {
      const urls = collectBackgroundUrls(element);
      const firstUrl = urls[0];
      if (firstUrl === undefined) {
        continue;
      }
      const alt = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? '';
      push(element, toAbsoluteUrl(firstUrl, baseUri), alt, 'background');
    }

    return results;
  }

  #keyFor(element: Element): string {
    const existing = this.#keys.get(element);
    if (existing !== undefined) {
      return existing;
    }
    const key = `${element.tagName.toLowerCase()}-${this.#sequence}`;
    this.#sequence += 1;
    this.#keys.set(element, key);
    return key;
  }
}
