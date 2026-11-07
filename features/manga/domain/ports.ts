/**
 * 领域端口：应用层只依赖这些接口，基础设施层提供 DOM / 定时器等具体实现。
 *
 * 这样 `MangaDetector` 可以在 Node 中用假实现测试，不需要浏览器环境。
 */
import type { ImageGeometry, ImageSourceKind } from './types';

/** 扫描器看到的一张原始图片（尚未经过筛选规则）。 */
export interface ImageCandidate {
  /** 在页面生命周期内稳定的标识，由具体实现决定（DOM 实现用 WeakMap 分配）。 */
  readonly key: string;
  readonly url: string;
  readonly alt: string;
  readonly sourceKind: ImageSourceKind;
  readonly geometry: ImageGeometry;
  readonly nearViewport: boolean;
}

/** 同步扫描一次当前文档，返回全部原始图片（不做筛选）。 */
export interface ImageScanner {
  scan(): readonly ImageCandidate[];
}

/** 监听 DOM 变化并在需要重新扫描时回调（实现负责防抖 / 节流）。 */
export interface ImageWatcher {
  start(onChange: () => void): void;
  stop(): void;
}
